/**
 * opencode-serenity-plugin — server entry
 *
 * 职责：注册 9 个内置工具（v0.9 specs v1.4.0 契约名：container_fs/container_git/logbook/
 *       dashboard/msm/container_admin/praxis/handyman/resident）+ 6 个 system hook，
 *       实现 serenity 认知基础设施的 plugin 层（MSM 框架、文件系统操作、会话管理、
 *       路径守卫、skill 注入等）。
 *
 * 设计文档见 docs/：
 *   - architecture-v0.md — 两阶段 init + 模块分解
 *   - contract-v0.md — 6 契约 + 13 错误类
 *   - requirements-v0-scope.md — RR1-RR7 范围层
 *
 * Hook 工厂分层：
 *   createPermissionGuards → tool.execute.before（RR5 路径守卫 + bash 开关）
 *   createCompactingHooks  → system.transform（SKILL.md 注入）
 *                           + session.compacting（关键状态保留）
 *                           + tool.definition（subagent context 注入）
 *   createShellEnv         → shell.env（HOME_SERENITY_ROOT + SERENITY_INSTANCE）
 *   createPermissionAutoReply → event permission.asked（cwdRoot 内自动 always）
 */

import type { Plugin, Hooks } from '@opencode-ai/plugin';
import { tryActivateSync } from './activation.js';
import {
  msmTool,
  msmAdminTool,
} from './msm.js';
import { fileSystemTool } from './fs/file-system-tool.js';
import { sessionTool, setRebuildClientGetter } from './session/session-tool.js';
import { accKitTool } from './acc-kit.js';
import { praxisTool } from './praxis-tool.js';
import { ccGitTool } from './git/cc-git-tool.js';
import { loopTool, cleanupAllLoops } from './tools/loop-tool.js';
import { residentTool } from './tools/resident-tool.js';
import { createPermissionGuards } from './hooks/permission-guards.js';
import { createCompactingHooks } from './hooks/compacting.js';
import { createShellEnv } from './hooks/shell-env.js';
import { createPermissionAutoReplyHandler } from './hooks/permission-auto-reply.js';
import { log } from './util/log.js';

const plugin: Plugin = async (input) => {
  log.info('entry', 'plugin loading', { directory: input.directory, worktree: input.worktree });

  // Phase 1: 同步 RR6 验证（git repo）
  const syncResult = tryActivateSync(input, () => input.client);

  if (!syncResult.ok) {
    log.warn('entry', 'plugin not activated', { reason: syncResult.reason });
    return {};
  }

  // v0.9: logbook rebuild 需 host client（session.summarize 触发压缩）——注入惰性 getter
  setRebuildClientGetter(() => input.client as never);

  // Phase 2 启动：fire-and-forget，状态机后台验证 RR1 + RR2
  // （由 activation.activateAsync 内部触发，此处不 await）

  // 注册 hooks + tools（Phase 2 未完成时 hook 内 await ensureReady() 阻塞）
  // v0.9 工具面 = specs v1.4.0 契约名（11 → 10 注册键 + msm 单入口）
  const hooks: Hooks = {
    tool: {
      container_fs: fileSystemTool, // cc_fs → container_fs
      container_git: ccGitTool,   // cc_git → container_git
      logbook: sessionTool,       // session → logbook（含 rebuild 子命令）
      dashboard: accKitTool,      // acc_kit → dashboard
      handyman: loopTool,         // loop → handyman
      msm: msmTool,               // msm_list + msm_exec → msm 单入口
      container_admin: msmAdminTool, // ccc_admin → container_admin
      praxis: praxisTool,         // eap + neat → praxis（含 cce）
      resident: residentTool,     // 非标准超集（保留）
    },
    dispose: async () => { cleanupAllLoops(); },
    ...createPermissionGuards(),
    ...createCompactingHooks(),
    ...createShellEnv(),
    event: createPermissionAutoReplyHandler({
      getServerUrl: () => input.serverUrl,
    }),
  };

  log.info('entry', 'phase 1 ok; phase 2 loading in background', { cwdRoot: syncResult.cwdRoot });
  log.info('entry', 'registered tools', { tools: Object.keys(hooks.tool ?? {}) });
  return hooks;
};

export default {
  id: 'opencode-serenity-plugin-server',
  server: plugin,
};
