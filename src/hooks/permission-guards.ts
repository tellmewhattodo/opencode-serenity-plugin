/**
 * Permission Guards Hook 工厂
 *
 * 包含：tool.execute.before hook
 * 职责（RR5 + v1.6 补全）：
 * 1. read / edit / write 工具的 path 字段强制在 cwdRoot 内（RR5 hard block；v1.6 加 edit/write）
 * 2. symlink 防御（v1.6 扩展 v1-1 msm-schema 的 realpath 逻辑到 tool.execute.before）
 *
 * 注意：bash 禁令于 2026-06-08 移除（旧 RR3），改用运行时开关：
 *   TUI slash command /serenity-bash-on|off|status 控制，通过文件 IPC 通信，
 *   在 tool.execute.before 中做静默拒绝。默认 bash 启用。
 *
 * 设计：v1.6 RR5 补全 = plugin **接管**权限管理（不再依赖 opencode.json 静态 allow）
 * - 主仓 opencode.json 已复原 read/edit = "ask"（commit fe19b5e）
 * - LLM 在 cwdRoot 内时：v1.3-v2 auto-reply 仍处理 "ask" 弹窗
 * - LLM 在 cwdRoot 外时：plugin hard block 早于 opencode 弹窗生效
 *
 * L3 验证：单 hook 抛错会中断整条 Effect 链（plugin/index.ts:286-299），
 * 所以抛错已被 safeHook 包装为 silent（util.ts）
 */

import type { Hooks } from '@opencode-ai/plugin';
import { resolve as pathResolve } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
import { isPathInside } from '../util/git.js';
import { getState, ensureReady } from '../state.js';
import { isHookEnabled, type HookConfig } from './util.js';
import { log } from '../util/log.js';
import { isSafeModeOn, readBlacklist, matchBlacklistEntry } from '../safe-mode.js';
import { captureOcSessionId } from '../session/active-state.js';
import { addToolWeight } from '../session/session-keeper.js';

/**
 * v0.9 registry 写保护判定（specs §4.3）：目标路径命中 mech-registry.json 或其 references/ 父目录
 * （写 deny 读 allow）。返回命中路径（需阻断），未命中返回 null。
 * 注册表管理走 container_admin msm register/deregister（内部豁免——不走文件工具）。
 */
export function isRegistryPathBlocked(paths: string[]): string | null {
  for (const p of paths) {
    const norm = p.replaceAll('\\', '/');
    // 命中聚合档路径：.opencode/skills/<ccc-name>/references/mech-registry.json
    if (norm.includes('/references/mech-registry.json')) return p;
    // 命中 references/ 目录节点本身（写目录 = 改注册表区域）
    if (norm.endsWith('/references') || norm.endsWith('/references/')) return p;
  }
  return null;
}

type ToolArgs = Record<string, unknown>;

/**
 * v1.6 字段名提取：
 * - 显式列表：command, path, filePath, file, cwd（v0.1-3 已有）
 * - 启发式后缀：*path* / *file* / *dir* / *Path* / *File* / *Dir*（v1.6 加）
 *   覆盖：targetPath / sourceFilePath / outputDir / newPath / etc.
 */
export function extractPathsFromArgs(args: ToolArgs): string[] {
  const candidates: string[] = [];

  // 显式字段（不区分大小写）
  const explicitKeys = new Set(['command', 'path', 'filepath', 'file', 'cwd']);
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== 'string' || value.length === 0) continue;
    if (explicitKeys.has(key.toLowerCase())) {
      candidates.push(value);
    }
  }

  // 启发式后缀（覆盖大多数 LLM 工具的命名习惯）
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== 'string' || value.length === 0) continue;
    if (explicitKeys.has(key.toLowerCase())) continue; // 跳过已加的
    const lower = key.toLowerCase();
    if (lower.includes('path') || lower.includes('file') || lower.includes('dir')) {
      candidates.push(value);
    }
  }

  return candidates;
}

/**
 * 路径越界判定 + symlink 防御
 * 返回：
 *  - 'inside'：路径在 cwdRoot 内
 *  - 'outside'：路径解析后在 cwdRoot 外
 *  - 'symlink'：是 symlink 且 realpath 在 cwdRoot 外
 *  - 'unparseable'：路径无法解析
 *  - 'not-exist'：文件不存在（写场景，无法 realpath）
 */
function classifyPath(value: string, cwdRoot: string): 'inside' | 'outside' | 'symlink' | 'unparseable' | 'not-exist' {
  let abs: string;
  try {
    abs = value.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(value)
      ? pathResolve(value)
      : pathResolve(cwdRoot, value);
  } catch {
    return 'unparseable';
  }
  if (!isPathInside(cwdRoot, abs)) return 'outside';
  if (existsSync(abs)) {
    try {
      const real = realpathSync(abs);
      if (real !== abs) return 'symlink';
      if (!isPathInside(cwdRoot, real)) return 'symlink';
    } catch {
      return 'unparseable';
    }
  } else {
    return 'not-exist';  // 写文件场景合理
  }
  return 'inside';
}

const toolExecuteBeforeImpl: NonNullable<Hooks['tool.execute.before']> = async (input, _output) => {
  captureOcSessionId(input.sessionID);

  // v0.1: 阻塞等待 Phase 2 完成（失败时：放行所有 = plugin 不工作）
  try {
    await ensureReady();
  } catch {
    return;
  }

  const state = getState();
  // SDK 1.15.13: tool.execute.before signature = (input, output) where output.args is the tool call's arguments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args = _output?.args ?? {};
  const paths = extractPathsFromArgs(args);

  // v1.6: edit + write 一起 hard block（read 已有；webfetch A2 决定不动）
  // v1.6: grep 加入 — path 参数强制在 cwdRoot 内，禁止搜索宁静号之外的内容
  // v0.1: glob 加入 — 与 grep 同级限制
  if (input.tool === 'read' || input.tool === 'edit' || input.tool === 'write' || input.tool === 'grep' || input.tool === 'glob') {
    for (const p of paths) {
      const verdict = classifyPath(p, state.cwdRoot);
      if (verdict === 'outside' || verdict === 'symlink') {
        log.warn('guard', `${input.tool} path ${verdict} cwdRoot`, { path: p, cwdRoot: state.cwdRoot });
        throw new Error(
          `[serenity] ${input.tool} path "${p}" is ${verdict} the serenity workspace root "${state.cwdRoot}" (RR5).`,
        );
      }
    }
  }

  // v0.9 registry 写保护（specs §4.3）：mech-registry.json 及 references/ 节点写 deny、读 allow。
  // 注册表是结构核心不是秘密——agent 不得经文件工具直接改，管理走 container_admin msm register/deregister。
  if (input.tool === 'write' || input.tool === 'edit') {
    const registryGuard = isRegistryPathBlocked(paths);
    if (registryGuard) {
      log.warn('guard', `${input.tool} blocked: mech-registry.json is ACC-managed`, { path: registryGuard });
      throw new Error(
        `[serenity] ${input.tool} to "${registryGuard}" is not allowed — mech-registry.json is ACC-managed. ` +
        `Use the container_admin tool (msm register/deregister) to modify the MSM registry.`,
      );
    }
  }

  // Safe mode: bash disabled + write blacklist
  const safeOn = isSafeModeOn(state.cwdRoot);

  if (input.tool === 'bash' && safeOn) {
    throw new Error("bash is disabled, use msm instead");
  }

  if (safeOn && (input.tool === 'write' || input.tool === 'edit')) {
    const blacklist = readBlacklist(state.cwdRoot);
    if (blacklist.length > 0) {
      for (const p of paths) {
        const matched = matchBlacklistEntry(p, blacklist);
        if (matched) {
          log.warn('guard', `write blocked by safe mode blacklist`, { path: p, tool: input.tool });
          throw new Error(
            matched.message ?? `[serenity] ${input.tool} to "${p}" is not allowed.`,
          );
        }
      }
    }
  }

  // webfetch A2 决定不动（保持 v0.1-3 行为）
  if (input.tool === 'webfetch') {
    for (const p of paths) {
      const verdict = classifyPath(p, state.cwdRoot);
      if (verdict === 'outside' || verdict === 'symlink') {
        log.warn('guard', `webfetch path ${verdict} cwdRoot`, { path: p, cwdRoot: state.cwdRoot });
        throw new Error(
          `[serenity] webfetch path "${p}" is ${verdict} the serenity workspace root "${state.cwdRoot}" (RR5).`,
        );
      }
    }
  }

  addToolWeight(input.sessionID, input.tool, args);

};

/** 工厂：返回 permission guards 相关的 hooks 集合
 *
 * v1.6 关键修正：permission-guards **不**走 safeHook。
 * 原因：safeHook 的"silent 策略"会吞掉 throw，导致 RR5 hard block 失效。
 * L3 验证：单 hook 抛错中断整条 Effect 链（plugin/index.ts:286-299）——
 * 这正是 RR5 hard block 想要的行为，所以应当让它**传播**给 opencode。
 * 其他 hook（compacting / shell-env）保留 safeHook（throw 不应硬中断）。
 */
export function createPermissionGuards(config?: HookConfig): Partial<Hooks> {
  const hooks: Partial<Hooks> = {};
  if (isHookEnabled('tool.execute.before', config)) {
    // 不走 safeHook —— 让 RR5 throw 真正生效
    hooks['tool.execute.before'] = toolExecuteBeforeImpl;
  }
  return hooks;
}
