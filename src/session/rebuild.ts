/**
 * rebuild.ts — logbook rebuild 实现（v0.9，specs v1.4.0 §5.9 载体重建）
 *
 * 语义（Ship of Theseus）：载体可重建、SESSION.md（轨迹身体）不动、轨迹连续。
 *
 * 实现路径（opencode 宿主 = 借道原生压缩，S156 logbook-rebuild-research.md 2B 定稿）：
 *   logbook rebuild = 触发宿主压缩（session.summarize = compactSvc.create + prompt loop）
 *   + experimental.session.compacting hook 注入"读 SESSION.md 从检查点继续 <note>"
 *   + autocontinue → 模型自动续跑。全程同会话 → 用户无感。
 *
 * 本模块只做触发编排（纯 TS 可测）；client 由 index.ts 经闭包注入（plugin input.client）。
 * 依赖注入接口设计为最小面：只需 { summarize } 方法，便于单测 mock。
 */

// ── 类型 ──

/** rebuild 所需的最小 client 面（便于测试 mock + 与 opencode SDK 解耦） */
export interface RebuildClient {
  session: {
    summarize(options: {
      path: { id: string };
      body: { providerID: string; modelID: string };
      query?: { directory?: string };
    }): Promise<unknown>;
    /** 读会话消息——用于解析最后 user message 的 model（压缩需 providerID/modelID） */
    messages?(options: {
      path: { id: string };
      query?: { limit?: number; directory?: string };
    }): Promise<Array<{
      info?: {
        role?: string;
        model?: { providerID?: string; modelID?: string };
      };
    }>>;
  };
}

export interface RebuildResult {
  ok: boolean;
  message: string;
}

export interface RebuildInput {
  sessionID: string;
  providerID: string;
  modelID: string;
  /** 新阶段内容概括（≤20 字，specs 约定） */
  summary: string;
  /** 任务焦点（≤200 字，注入给压缩后继续的 agent） */
  note?: string;
  /** opencode session 的工作目录（query.directory） */
  directory?: string;
}

// ── 实现 ──

/**
 * 触发一次"载体重建"（= 宿主压缩 + 定向继续）。
 *
 * 前置条件（由调用方 logbook rebuild 子命令校验）：
 *   - 活跃会话存在（S### + SESSION.md）
 *   - providerID/modelID 从活跃会话最后 user message 的 model 解析
 *
 * 压缩过程中 experimental.session.compacting hook（compacting.ts）会检测到本次
 * rebuild 意图（经模块级 pendingRebuild 标志），向压缩 prompt 注入：
 *   "This is a logbook rebuild for S###: read SESSION.md 进度记录/未决问题 and
 *    continue the work from the last checkpoint. Task focus: <note>"
 * 摘要完成后宿主 autocontinue（默认 true）→ 模型自动读 SESSION.md 续作。
 */
export async function triggerRebuild(client: RebuildClient, input: RebuildInput): Promise<RebuildResult> {
  if (!client?.session?.summarize) {
    return { ok: false, message: 'rebuild: client.session.summarize unavailable (host does not expose compaction trigger)' };
  }
  try {
    // 记录 rebuild 意图（compacting.ts 的 session.compacting hook 读取注入继续指令）
    setPendingRebuild(input);
    await client.session.summarize({
      path: { id: input.sessionID },
      body: {
        providerID: input.providerID,
        modelID: input.modelID,
      },
      query: input.directory ? { directory: input.directory } : undefined,
    });
    return {
      ok: true,
      message:
        `queued logbook rebuild for session ${input.sessionID}: context will be compacted and the agent ` +
        `auto-continues from SESSION.md (task focus: ${input.note ?? '(none)'}). This is same-session — no manual switch needed.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `rebuild: compaction trigger failed — ${msg}` };
  } finally {
    // summarize 返回即压缩任务已排队（宿主 prompt loop 驱动）；意图在压缩实际发生时仍须保留，
    // 由 compacting.ts hook 消费后清除（clearPendingRebuild）。此处不立即清——hook 端消费。
  }
}

// ── rebuild 意图传递（模块级，compacting.ts hook 消费）──

export interface PendingRebuild {
  sessionID: string;
  summary: string;
  note?: string;
}

let pending: PendingRebuild | null = null;

/** 记录 pending rebuild（triggerRebuild 调用前设置） */
export function setPendingRebuild(input: RebuildInput): void {
  pending = { sessionID: input.sessionID, summary: input.summary, note: input.note };
}

/** 读取并清除 pending rebuild（compacting.ts 的 experimental.session.compacting hook 消费） */
export function consumePendingRebuild(sessionID: string): PendingRebuild | null {
  if (!pending || pending.sessionID !== sessionID) return null;
  const p = pending;
  pending = null;
  return p;
}

/** 测试用：清空 pending */
export function resetPendingRebuild(): void {
  pending = null;
}

/** 当前 pending 快照（诊断/测试） */
export function peekPendingRebuild(): PendingRebuild | null {
  return pending;
}

// ── 模型解析 ──

export interface ResolvedModel {
  providerID: string;
  modelID: string;
}

/**
 * 从会话消息中解析"最后一条 user message 的 model"（压缩触发需指定 providerID/modelID；
 * opencode prompt.ts 同款取法：lastUser.model）。
 * 无 messages 能力或解析失败 → null（调用方报错提示）。
 */
export async function resolveCurrentModel(
  client: RebuildClient,
  sessionID: string,
  directory?: string,
): Promise<ResolvedModel | null> {
  if (!client.session.messages) return null;
  try {
    const msgs = await client.session.messages({
      path: { id: sessionID },
      query: { limit: 50, ...(directory ? { directory } : {}) },
    });
    for (let i = msgs.length - 1; i >= 0; i--) {
      const info = msgs[i]?.info;
      if (info?.role !== 'user') continue;
      const pid = info.model?.providerID;
      const mid = info.model?.modelID;
      if (pid && mid) return { providerID: pid, modelID: mid };
    }
    return null;
  } catch {
    return null;
  }
}
