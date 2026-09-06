/**
 * session-tool.ts — 通用会话管理工具（v0.1 D5）
 *
 * Plugin 自注册的会话生命周期管理工具，不依赖任何实例特定的脚本。
 * 路径基于 file-system root（.serenity 向上遍历）动态解析。
 *
 * 标准子命令（ACC 内置）：
 *   list/show/create/use/close/health/qa/archive/summary
 *
 * CCC 可注册 session-tool MSM 来扩展：
 *   - 后处理钩子：create-transform（create 写完 SESSION.md 后调用）
 *   - 新子命令：直接 msm_exec session-tool <cmd>
 *
 * 查看扩展指南：session hook-develop-guide
 */

import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { z } from 'zod';
import { findSerenityRoot, resolveRootPath, readSerenityCccName } from '../fs/resolve-path.js';
import { loadMechRegistryFrom } from '../msm.js';
import { callMsmExec } from '../util/msm-call.js';
import { SessionError } from '../errors.js';
import {
  listSessions,
  showSession,
  useSession,
  closeSession,
  resolveSessionInfo,
  healthCheck,
  createSession,
  archiveSessions,
  sessionSummary,
  qaSession,
} from './lib.js';
import { setActiveSession, removeActiveSession, getActiveSession, getLastActiveSession } from './active-state.js';
import type { MechEntry } from '../config-schema.js';
import { triggerRebuild, resolveCurrentModel, type RebuildClient } from './rebuild.js';

// ── rebuild client 注入（v0.9 logbook rebuild）──
// index.ts 在 plugin 闭包内 setRebuildClientGetter(() => input.client) 注入真实 SDK client；
// 工具 execute 经 getter 惰性取（避免 import 循环 + 便于测试 mock）。
let rebuildClientGetter: (() => RebuildClient | null) | null = null;

export function setRebuildClientGetter(getter: (() => RebuildClient | null) | null): void {
  rebuildClientGetter = getter;
}

function getRebuildClient(): RebuildClient | null {
  return rebuildClientGetter ? rebuildClientGetter() : null;
}

/** 从 flags 中查找 name 匹配的 flag，仅在 new-style 对象上检查 */
function findFlagByName(
  flags: MechEntry['flags'] | undefined, name: string,
): { description?: string } | undefined {
  if (!flags) return undefined;
  for (const f of flags) {
    if ('name' in f && f.name === name) return f;
  }
  return undefined;
}

/** 从 CCC 的 session-tool MSM flags 中提取支持的钩子名列表 */
function discoverCccHooks(entries: MechEntry[]): string[] {
  const msm = entries.find(e => e.name === 'session-tool');
  const hookFlag = findFlagByName(msm?.flags, 'hook');
  if (!hookFlag?.description) return [];
  return hookFlag.description.split('|').map(s => s.trim()).filter(Boolean);
}

/** 从 CCC 的 session-tool MSM flags 中提取自定义子命令清单 */
function discoverCccSubcommands(entries: MechEntry[]): string[] {
  const msm = entries.find(e => e.name === 'session-tool');
  const subFlag = findFlagByName(msm?.flags, 'subcommand');
  if (!subFlag?.description) return [];
  return subFlag.description.split('|').map(s => s.trim()).filter(Boolean);
}

/** 生成扩展提示 */
function buildExtHint(hasSessionTool: boolean, hooks: string[], subcommands: string[]): string {
  if (!hasSessionTool) {
    return '\n\n[CCC] 如需扩展会话能力，可注册 session-tool MSM (ccc_admin register)，详见 session hook-develop-guide';
  }
  const parts: string[] = [];
  if (hooks.length > 0) {
    parts.push(`钩子: ${hooks.join(', ')}`);
  }
  if (subcommands.length > 0) {
    parts.push(`扩展子命令 (msm_exec session-tool): ${subcommands.join(', ')}`);
  }
  const detail = parts.length > 0 ? ` (${parts.join('; ')})` : '';
  return `\n\n[CCC] session-tool MSM 已注册${detail}`;
}

export const sessionTool: ToolDefinition = tool({
  description:
    'Session lifecycle management for cognitive containers (CCC). ' +
    'Manages AGENT_SESSIONS/ directory: list, show, create, use, close, health, qa, archive, summary. ' +
    'Use `use` to activate a session as current context for this conversation. ' +
    'Close requires --confirm flag. ' +
    'Use `hook-develop-guide` to learn how CCCs extend session capabilities via session-tool MSM.',
  args: {
    subcommand: z
      .enum(['list', 'show', 'create', 'use', 'close', 'health', 'qa', 'archive', 'summary', 'hook-develop-guide', 'rebuild'])
      .describe(
        'Operation to perform:\n' +
        '  list              — List all sessions with status summary (active/in-progress first)\n' +
        '  show              — View session details (accepts S###, directory name, or fuzzy keyword)\n' +
        '  create            — Create a new session (--desc <desc> [--goal <goal>]) or (--issue <id>)\n' +
        '  use               — Activate a session as current context (--name S###). Closed sessions can be re-opened.\n' +
        '  close             — Close a session (requires --name + --confirm). Cannot be undone.\n' +
        '  health            — Health check: stale/stalled/drift/ghost\n' +
        '  qa                — Fact-check a session: verify SESSION.md claims against reality\n' +
        '  archive           — Archive completed sessions past their grace period\n' +
        '  summary           — Dashboard: stats + recent activity + warnings\n' +
        '  rebuild           — Rebuild the current conversation in place (Ship of Theseus): host compaction is triggered; the agent auto-continues from SESSION.md. Requires --summary <content summary ≤20 chars> + optional --note <task focus>. Same-session — no manual switch needed.\n' +
        '  hook-develop-guide — Guide for CCC developers writing session-tool MSM hooks',
      ),
    name: z
      .string()
      .optional()
      .describe('Session identifier for show/use/close/archive subcommands (e.g. "S001", directory name, or fuzzy keyword)'),
    confirm: z
      .boolean()
      .optional()
      .default(false)
      .describe('Must be true for close subcommand — prevents accidental session closure'),
    'dry-run': z
      .boolean()
      .optional()
      .default(false)
      .describe('Preview changes without actually modifying files'),
    desc: z
      .string()
      .optional()
      .describe('Short description for create subcommand (any language, max 5 words). Mutually exclusive with --issue.'),
    issue: z
      .string()
      .optional()
      .describe('Issue/ticket ID for create subcommand (e.g. apaas-24712). Directory named YYYY-MM-DD--<issue>/. Mutually exclusive with --desc.'),
    goal: z
      .string()
      .optional()
      .describe('Optional one-sentence goal for the session'),
    summary: z
      .string()
      .optional()
      .describe('[rebuild] content summary ≤20 chars — next work phase; REQUIRED for rebuild'),
    note: z
      .string()
      .optional()
      .describe('[rebuild] task focus ≤200 chars for the rebuilt self — what to work on next (short; SESSION.md holds the full history)'),
  },
  execute: async (input, ctx) => {
    const cwd = ctx.directory;
    const root = findSerenityRoot(cwd);
    const sessionsDir = resolveRootPath(root, 'AGENT_SESSIONS');

    // 检测 CCC 是否注册了 session-tool MSM
    const cccName = readSerenityCccName(root);
    const entries = cccName ? loadMechRegistryFrom(root, cccName) : [];
    const hasSessionTool = entries.some(e => e.name === 'session-tool');
    const cccHooks = discoverCccHooks(entries);
    const cccSubs = discoverCccSubcommands(entries);
    const extHint = buildExtHint(hasSessionTool, cccHooks, cccSubs);

    const sub = input.subcommand;

    // hook-develop-guide 子命令 — 返回扩展指南
    if (sub === 'hook-develop-guide') {
      return getHookDevelopGuide(hasSessionTool);
    }

    if (sub === 'list') {
      const activeSession = getActiveSession(ctx.sessionID);
      return listSessions(sessionsDir, activeSession?.sessionId) + extHint;
    }

    if (sub === 'show') {
      if (!input.name) {
        throw new SessionError('session-tool show: requires --name (S### or directory name)');
      }
      return showSession(sessionsDir, input.name) + extHint;
    }

    if (sub === 'create') {
      if (!input.desc && !input.issue) {
        throw new SessionError('session-tool create: requires --desc or --issue');
      }
      if (input.desc && input.issue) {
        throw new SessionError('session-tool create: --desc and --issue are mutually exclusive');
      }
      // 先执行 ACC 默认创建（写 SESSION.md）
      const result = createSession({
        sessionsDir,
        root,
        desc: input.desc,
        issue: input.issue,
        goal: input.goal,
        dryRun: input['dry-run'] ?? false,
      });

      // ---- 钩子：create-transform ----
      // 仅在非 dry-run 且 CCC 声明了该钩子时执行
      if (!input['dry-run'] && cccHooks.includes('create-transform')) {
        try {
          const hookResult = await callMsmExec({
            msm_name: 'session-tool',
            businessArgs: ['--hook=create-transform', `--session-dir=${result.sessionPath}`],
          });
          result.message += `\n  [create-transform] ${hookResult.stdout.trim()}`;
        } catch (err) {
          result.message += `\n  [WARN] create-transform hook failed: ${err}`;
        }
      }

      return result.message + extHint;
    }

    if (sub === 'use') {
      if (!input.name) {
        throw new SessionError('session-tool use: requires --name (S### or directory name)');
      }
      const info = resolveSessionInfo(sessionsDir, input.name);
      setActiveSession(ctx.sessionID, { sessionId: info.sessionId, dirName: info.dirName, mdPath: info.mdPath });
      return useSession(sessionsDir, input.name);
    }

    if (sub === 'close') {
      if (!input.name) {
        throw new SessionError('session-tool close: requires --name (S### or directory name)');
      }
      removeActiveSession(ctx.sessionID);
      return closeSession(sessionsDir, input.name, input.confirm ?? false);
    }

    if (sub === 'health') {
      return healthCheck(sessionsDir) + extHint;
    }

    if (sub === 'archive') {
      return archiveSessions({
        sessionsDir,
        name: input.name,
        dryRun: input['dry-run'] ?? false,
      }) + extHint;
    }

    if (sub === 'summary') {
      return sessionSummary(sessionsDir) + extHint;
    }

    if (sub === 'qa') {
      if (!input.name) {
        throw new SessionError('session-tool qa: requires --name (S### or directory name)');
      }
      return qaSession(sessionsDir, input.name) + extHint;
    }

    if (sub === 'rebuild') {
      // v0.9 logbook rebuild（specs §5.9 载体重建，借道宿主压缩）
      if (!input.summary || input.summary.trim().length === 0) {
        throw new SessionError('logbook rebuild: requires --summary <content summary ≤20 chars> (next work phase; appended to the session title after rebuild)');
      }
      // 定位当前活跃会话（内存 Map；无则提示先 use）
      const active = getActiveSession(ctx.sessionID) ?? getLastActiveSession();
      if (!active) {
        throw new SessionError(
          'logbook rebuild: no active session. Run "logbook use <S###>" first to activate the trajectory to rebuild, then retry.',
        );
      }
      const client = getRebuildClient();
      if (!client) {
        throw new SessionError('logbook rebuild: host client unavailable (session.summarize not exposed)');
      }
      // 从当前会话 model 解析 provider/model（宿主压缩需指定模型）——经 client 读会话最后 user 的 model
      const resolved = await resolveCurrentModel(client, ctx.sessionID, cwd);
      if (!resolved) {
        throw new SessionError(
          'logbook rebuild: could not resolve the current model from the session. ' +
          'The host compaction trigger requires a providerID/modelID.',
        );
      }
      const result = await triggerRebuild(client, {
        sessionID: ctx.sessionID,
        providerID: resolved.providerID,
        modelID: resolved.modelID,
        summary: input.summary.trim(),
        note: input.note?.trim() || undefined,
        directory: cwd,
      });
      if (!result.ok) throw new SessionError(result.message);
      return result.message + extHint;
    }

    throw new SessionError(`session-tool: unknown subcommand "${sub}"`);
  },
});

/** hook-develop-guide 内容 — CCC 开发者的 session-tool MSM 编写指南 */
function getHookDevelopGuide(hasSessionTool: boolean): string {
  return [
    '═══ Session Extension Protocol (SEP) v1 — 开发指南 ═══',
    '',
    'CCC 可以通过注册 session-tool MSM 来扩展 ACC session 工具的能力，',
    '而无需修改 plugin 代码。ACC 的行为不会缩水——CCC 只在 ACC 完成后做后处理。',
    '',
    '── 口子一：后处理钩子 (Hooks) ──',
    '',
    'ACC 的某些子命令执行完成后，会检查 CCC 的 session-tool MSM 是否',
    '注册了对应的钩子。如果注册了，ACC 会调用 MSM 做后处理。',
    '',
    '可用钩子：',
    '',
    '  create-transform',
    '    触发时机：create 写完默认 SESSION.md 后',
    '    调用方式：msm_exec session-tool --hook=create-transform --session-dir=<path>',
    '    允许行为：读取 SESSION.md，原地修改内容（追加字段、换模板、调 API 等）',
    '    注意事项：ACC 已确保目录和 SESSION.md 存在，CCC 只做修改',
    '',
    '── 口子二：新子命令 (Custom Subcommands) ──',
    '',
    'LLM 可以直接调用 msm_exec session-tool <subcommand> 来执行 CCC 专属的子命令，',
    '如 reindex、export、batch-create 等。这些子命令不走 ACC session tool 的 enum。',
    '',
    '── 如何注册 session-tool MSM ──',
    '',
    '1. 编写脚本，放在 CCC 的 skills 目录下：',
    '     .opencode/skills/<ccc-name>/scripts/session-tool.ts',
    '',
    '2. 注册到 mech-registry.json：',
    '     ccc_admin register session-tool \\',
    '       --path .opencode/skills/<ccc-name>/scripts/session-tool.ts \\',
    '       --category semi-mech \\',
    '       --description "CCC session 扩展: 钩子 + 自定义子命令" \\',
    '       --flags \'[',
    '         {"name":"hook","type":"string","description":"create-transform"},',
    '         {"name":"subcommand","type":"string","description":"reindex | export"},',
    '         {"name":"session-dir","type":"path","description":"session 目录路径"},',
    '         {"name":"dry-run","type":"boolean","description":"预览模式"}',
    '       ]\'',
    '',
    '3. 钩子声明约定：',
    '     flags 中的 --hook description 字段按 | 分割枚举支持的钩子名。',
    '     ACC 发现 create-transform 在列表中时，就会在 create 后调用。',
    '',
    '4. 子命令声明约定：',
    '     flags 中的 --subcommand description 字段按 | 分割枚举支持的子命令名。',
    '     LLM 看到提示后可调用 msm_exec session-tool <subcommand>。',
    '',
    '── session-tool MSM 模板 ──',
    '',
    '脚本应包含 main() CLI 守卫，支持 --hook 和 --subcommand 调度：',
    '',
    '  if (argv.includes("--hook")) {',
    '    const hook = parseArg(argv, "--hook");',
    '    const sessionDir = parseArg(argv, "--session-dir");',
    '    if (hook === "create-transform") {',
    '      // 读取 sessionDir + "/SESSION.md"，修改后写回',
    '    } else {',
    '      console.log("unknown hook, skipped");',
    '      process.exit(0);  // 未知钩子静默跳过',
    '    }',
    '  }',
    '',
    (hasSessionTool
      ? '✅ 当前 CCC 已注册 session-tool MSM'
      : 'ℹ️  当前 CCC 尚未注册 session-tool MSM — 使用 ccc_admin register 开始'),
    '',
    '── 更多信息 ──',
    '',
    '参考 ACC 源码: src/session/session-tool.ts (hook 调用逻辑)',
    '参考模板: src/templates/session/scripts/session-tool.ts (reindex + create-transform 示例)',
  ].join('\n');
}
