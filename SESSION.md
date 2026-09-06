# SESSION: opencode-serenity-plugin

> **项目即会话模式**（home-session 定义）—— 本仓是独立 git 项目；日常演进通过 git commit 记录，本文件追踪**当前焦点 + 关键决策 + 未决问题 + 项目演进历史 + 关联文档**。
>
> **迁移说明**：本 SESSION 模式在 2026-06-04 21:00 从"事项化"切换为"项目即会话"。原事项化 session `AGENT_SESSIONS/2026-06-04--opencode-serenity-plugin-skeleton/` 已收口归档。

---

## v0.0.3 — 2026-06-08 (S028 release)

**Scope:** msm_exec 协议层从 "spawn 子进程 (serenity 仓 msm-exec.ts)" 反转为 "in-process 库 (plugin 仓 msm-exec-runtime.ts)" — 反转 S024/D26, plugin 端 msm_exec 实现首次**完全自包含**, 不再依赖主仓.

**主要变化:**

- **新增 `src/util/msm-exec-runtime.ts` (687 行)** — 从 serenity 仓 msm-exec.ts 移植, 零三方依赖 (仅 node:fs / child_process / path / url). 业务 msm spawn 内部完成 (cwd=state.cwdRoot, timeout 10 分钟).
- **`src/util/msm-call.ts` 重写 (104 行)** — 移除薄 spawn 包装, 改为直接 in-process 委托 `runMsmExec(argv, opts)`. API shape (`callMsmExec({msm_name, businessArgs})`) 保持不变.
- **D13 收口 (双注册表问题)** — msm-call 计算 `<cwdRoot>/.opencode/skills/<inst>/references/mech-registry.json` 路径传入 runtime. runtime 在 caller 提供 path 时**不**走 D6 bootstrap (避免覆盖 msm_admin 写入的注册表). plugin-root 注册表 (D9) 仅作 CLI 调试 fallback, 业务流不再依赖 plugin-root 注册表.
- **msmExecTool description 极简 (D5)** — 移除冗余字段 ("ALWAYS call msm_list first" / "30s timeout (实际 600s, 过期文案)" / "args 是 string array" / "bash RR3 提示"), 只保留 msm_name + args + 1 示例.
- **CLI 守卫** — 文件底部加 `if (import.meta.url === pathToFileURL(process.argv[1]).href)` 守卫, 避免 import 时 main() 静默触发. (S028 v0.0.3 修复 — 移植 v0.0.2 时守卫遗漏).
- **新增 `mech-registry.json` (plugin 根)** — D10 初始 = `{version:1, description:..., entries:[]}`, 给 CLI 调试 fallback 用.

**测试变化 (320 → 320, 3 个新文件覆盖):**

| 文件 | cases | 范围 |
|------|------:|------|
| `tests/msm-call.test.ts` (重写) | 8 | vi.mock msm-exec-runtime, 测 callMsmExec argv/cwd/registryPath 透传 + 错误透传 |
| `tests/msm-exec-tool.test.ts` (新) | 7 | msmExecTool §9 fix 行为 + happy path E2E + 错误路径, 真实 stub msm 脚本 + 注册表 |
| `tests/msm-exec-runtime.test.ts` (新) | 19 | 协议 flag 解析 + 元命令 + 注册表错误处理 + 业务 spawn |
| **总计** | **34 (新增/重写) + 286 (保留) = 320** | 测试总数不变; 新覆盖 v1.14 follow-up: "msm-exec.ts unit tests (deferred from v1.14)" |

**Lock-in 决策 (D9-D13):**

| # | 决策 | 关键事实 |
|---|------|----------|
| D9 | plugin 仓独立注册表 (C 变体) | 路径 = `<plugin-root>/mech-registry.json` |
| D10 | 初始 = 空 `{version:1, entries:[]}` | 不预填 |
| D11 | timeout 统一 600s (10 分钟) | plugin 端 600s (与 v0.0.2 一致) + runtime 600s (原 30s) |
| D12 | msmExec description 极简 | msmName + args (2 字段) + 1 示例 |
| D13 | 业务流走 cwdRoot 注册表 (收口双源) | msm-call 传入 path 1, runtime 用 caller path 时不 bootstrap, D9 仅作 CLI fallback |

**心智模型校正 (永久):**

- **plugin = serenity 的创建者/管理者** (durable infrastructure, source of truth)
- **serenity 仓 = serenity 的实例** (replicable, 可删除重建, 下游 artifact)
- plugin 改 → serenity wipe & rebuild, 不存在"两真源"漂移问题

**S028 关联 SESSION:**

- `AGENT_SESSIONS/2026-06-08--S028--plugin-self-contained-msm/SESSION.md` — D1-D13 全部固化, 含 8 步实施规划 + 风险点

**Open follow-ups (v0.0.4+):**

- ~~msm-exec.ts unit tests (deferred from v1.14)~~ ✅ S028 解决
- ~~msm_exec tool-level protocol flag prefix parsing~~ ✅ S028 解决 (plugin 完全自包含, flag 解析在 plugin 内)
- PluginConfig full wiring in plugin entry
- session-tool resolve-path bug fix
- omo-style 5-layer hook composer migration (low priority)
- 主仓 README 加 GitHub 链接
- ~~`git tag v0.0.3 && git push --tags`~~ ✅ v0.0.3 release 收尾 (见下)

---

## v0.0.3 release 收尾 — 2026-06-08

**触发**: S028 后 user 反馈"msm_exec 还是老样子" + "tui 加载时也不显示版本号", 根因 = plugin 无 version 暴露 → v0.0.2 vs v0.0.3 无法识别 (opencode 工具面板 / TUI 启动 banner / msm_list 输出 都没有 version 字段). "模糊性" 根因不是 require cache, 是 plugin 没把 version 暴露出来.

**修改 (3 处暴露):**

1. `package.json` — `version: 0.0.2` → `0.0.3` (单一真相源, 跟 tui.ts#VERSION 共用)
2. `src/msm.ts` — import `pkg` + `VERSION` 常量, 暴露 2 处:
   - `msmExecTool.description` 末尾追加 `(serenity-plugin v${VERSION})` — opencode 工具面板可见
   - `msmListTool` 输出顶部加 `(serenity-plugin v${VERSION})` 行 — `msm_list` 调用即可确认
3. `src/tui.ts` — **不改**: v1.15 已有 `api.ui.toast({ title: 'opencode-serenity-plugin v${VERSION}', message: 'loaded', ...})`, 改 package.json 即可自动显示新版本

**git 操作 (develop-kit 不会自动做):**

- `git tag v0.0.3 && git push origin v0.0.3` — 走 `serenity-plugin-develop-kit --cmd` (kit 不推 tag)

**user 验证步骤:**

1. 重启 opencode
2. 看 TUI 启动 toast: 应该是 "opencode-serenity-plugin v0.0.3 loaded"
3. 调 `msm_list` 看顶部: 应该是 "(serenity-plugin v0.0.3)" 行
4. 调任一 msm 看 stderr 行为: 应该是 in-process 行为 (无 spawn wrapper 日志)

---

## v0.0.2 — 2026-06-07 (release)

**Scope:** RR7 init + postinstall ergonomics + 协议层精简

**Commits (12 new since v0.0.1, all built on v0.0.1 silent base):**

- `25e75ec` chore: bump version to 0.0.2
- `62820e9` v1.17: merge msm_register + msm_deregister → msm_admin
- `2889942` v1.16: protocol flag prefix + drop msm_help/version/schema (Option C)
- `d244798` v1.15.1: msm_exec preserves stdout in MsmExecutionError (§9 fix)
- `a5d54f4` v1.15: show version in TUI load toast
- `bca0e63` v1.13: zod-first plugin config (D26)
- `7ad23ee` v1.12: isHookEnabled + safeCreateHook hook 保护
- `725a9e7` v1.14: msm_exec 协议层集成 (S022 RFC)
- `93348e3` v1.11: bin install CLI (one-shot register server + TUI entries)
- `d0ab00a` v1.10.1: /serenity-init visible in non-serenity dirs (self-install to global tui.json)
- `d026b05` v1.10: RR7 init — /serenity-init slash command + DialogPrompt UX

**User-visible features (additive to v0.0.1):**

- **RR7 init**: `/serenity-init` slash command in TUI. User enters a prefix (e.g. `xx`); plugin writes `/.serenity` with `xx-serenity` and commits. Visible in non-serenity dirs (self-installs TUI to global on first run).
- **bin install**: `opencode-serenity-plugin install [--global]` one-shot writes both server + TUI plugin entries to opencode config. Replaces manual config edits.
- **msm_exec protocol layer**: S022 RFC v0.1 implemented in `msm-exec.ts` MSM + thin `msm-call.ts` plugin wrapper. 6 mandatory flags: `--format`, `--log`, `--help`, `--version`, `--list`, `--schema`. JSON Lines logging.
- **Tool surface (3 total)**: `msm_list` + `msm_exec` + `msm_admin` (merged from msm_register/deregister). ~~`bash` override (RR3)~~ ❌ 2026-06-08 移除。
- **Hook protection**: `isHookEnabled` + `safeCreateHook` two-layer guard. v1.6 RR5 hard block preserved (permission-guards.ts not migrated).
- **Zod-first config**: 4 schemas in `src/config-schema.ts`; types derived via `z.infer`. HookConfig stays hand-written to avoid z.infer widening.
- **Version in load toast**: `opencode-serenity-plugin v0.0.2 loaded` (3s) on every opencode TUI plugin load.
- **§9 bugfix**: MsmExecutionError preserves stdout in error path, so `--format=json` callers see JSON errors.

**Lock-in decisions (D23-D26):**

- D23: Two-entry architecture (server + TUI) — kept
- D24: v1.11 `bin install` CLI — implemented
- D25: v1.12 hook protection — implemented
- D26: v1.13 zod-first — implemented

**Remote migration:**

- 2026-06-07: remote moved from `git@home.gitlab:yh/opencode-serenity-plugin.git` to `git@github.com:tellmewhattodo/opencode-serenity-plugin.git`

**Test count:** 320 / 320 passing (was 184 at v0.0.1)

**Open follow-ups (v0.0.3+):**

- msm-exec.ts unit tests (deferred from v1.14 — only E2E validated)
- PluginConfig full wiring in plugin entry
- session-tool resolve-path bug fix
- msm_exec tool-level protocol flag prefix parsing (currently only the protocol layer does it; plugin wrapper could too)
- omo-style 5-layer hook composer migration (low priority — current isHookEnabled is sufficient)
- **主仓 README 加 GitHub 链接** — 指向 `github.com/tellmewhattodo/opencode-serenity-plugin`
- **`git tag v0.0.2 && git push --tags`** — 打第一个 GitHub release tag

**Demos:**

- In serenity dir: `cd ~/my-serenity-project && opencode` → toast `opencode-serenity-plugin v0.0.2 loaded`
- In non-serenity dir: type `/serenity-init` → dialog with smart prefix prefill from cwd dir name
- Run `opencode-serenity-plugin install --global` to bootstrap the plugin in a fresh env

---

## 当前焦点

**v0.9.0 已发布（specs v1.4.0，S156，2026-09-06）。npm @shgroup/opencode-serenity-plugin@0.9.0 + git commit 8309f45 + tag v0.9.0。**

| 维度 | 状态 |
|------|:----:|
| Phase 1 工具面（9 契约名：container_fs/container_git/logbook/dashboard/handyman/msm/praxis/container_admin/resident）| ✅ |
| Phase 2 注入 9 块（compacting.ts 重写，specs §5.0-5.9）| ✅ |
| Phase 3 机制（trajectory-assistant 改名 / registry 写保护 / dashboard registry 段）| ✅ |
| Phase 4 logbook rebuild（借道宿主压缩）| ✅ |
| 测试 562/562 全绿（37 files）| ✅ 2026-09-06 |
| **v0.9.0 发布（npm + git commit 8309f45 + tag）** | ✅ 2026-09-06 |
| Phase 5 localstore（全新工具）| ⏳ 未做（宿主无缝评估中）|
| 仓内 SESSION.md v0.3.4 → v0.8.7 历史补记 | 🟡 独立 follow-up（见未决问题）|

详细方案：S156 `AGENT_SESSIONS/2026-09-06--S156--opencode-serenity 长期维护/osp-v140-impl-plan.md`

---

## v0.3.x — ACC/CCC 模型成型（2026-06-20）

### 核心发现
- **D16-D18**: ACC/CCC 三层模型 — ACC (Abstract, 本 plugin) → CCC (Concrete, 各 `xxx-serenity/`) → CC (日常用语 "serenity")
- **P1/P2/P3**: 认知容器三原则（有根 / git管 / 权限二分）
- **D19**: bash 降级为高危后备，msm_exec 为标准执行路径
- **D20-D22**: ACC 原语短名（session, cc-fs, cc-ck 等），CCC 注册 wrapper MSM

### 命名重命名（v0.3.0）
- `instanceName`→`cccName`, `buildInstanceName`→`buildCccName`, `InvalidInstanceNameError`→`InvalidCccNameError`
- 环境变量 `SERENITY_ROOT`/`SERENITY_CCC`/`SERENITY_VERSION`（保留旧名 deprecated alias）
- 34 文件重命名（src/~20 + tests/11 + templates/4）

### 5 MSM 增强（v0.3.0）
- cc-fs: 加 `tree` + `append` 子命令
- msm_exec: spawn 注入 CCC 环境变量
- 新建 `ccc-status` (后改 `cc-ck`): P1/P2/P3 健康检查
- msm_admin: register path 默认 CCC-relative
- msm_list: 输出加 CCC context header

### EAP + Neat 升为 ACC 原语（v0.3.3）
- 新增 `eap` / `neat` 两个 tool，渐进式披露（description=signal, execute=返回完整 SKILL.md）
- tool 计数: 6→8

### session 扩展提示 + 注册表保护（v0.3.4）
- session tool: 检测 CCC 是否注册了 session-tool MSM，附加扩展/提示信息
- cc-fs: 禁止直接写 `mech-registry.json`（必须走 msm_admin）

### npm 发布链
0.3.0 → 0.3.1 (session_tool→session) → 0.3.2 (cc-fs/cc-ck/msm_name→name) → 0.3.3 (eap+neat) → 0.3.4 (session hint + registry protection)

所有版本 npm / git tag / package.json 三源对齐。
| v0.0.2 详细记录（12 commits / 5 lock-in 决策 / open follow-ups）| 见上文 v0.0.2 — 2026-06-07 (release) 块 |

**v0.0.x 版本说明**：v0.0.x 系列目前仅 **v0.0.1 + v0.0.2** 两个 release。在 v0.0.2 之前，仓内 commit 链曾短暂以 v0.0.4/5/6 作内部版本标记（0.0.2 reset 前），现已废弃——不要在文档/issue 中引用 v0.0.3-0.0.6。

**v0.0.1 commit 链（17 个）**：

| 阶段 | 状态 | commit |
|------|:----:|--------|
| 范围层（RR1-RR7）| ✅ | `70db320` |
| 方案层（10 步协议 + 模块）| ✅ | `b92eed6` |
| 接口层（6 契约 + 错误类）| ✅ | `f2b3845` |
| v0 实现层（24 tests）| ✅ | `e91f8cc` |
| v0.0.1 完全静默（release 应无 stderr 噪音）| ✅ | `521f8d1` |
| v0.0.1 首个可用版本 release | ✅ | `df80a8c` |
| v0.1 候选文档 | ✅ | `ac9b7ec` |
| v0.1-1 两阶段 init（13 tests）| ✅ | `fc1f6a7` |
| v0.1-2 path-arg 守卫（4 tests）| ✅ | `1c4ce6b` |
| v0.1-3 hook 工厂分层（9 tests）| ✅ | `ca4360f` |
| v1-1 symlink 防御（6 tests）| ✅ | `20bf791` |
| v1-2 hashline edit（13 tests）| ✅ | `e39ed23` |
| v1-3 升 v2 SDK + auto-reply permission | ✅ | `809bf94` |
| v1.4 SKILL.md 全文注入 system prompt | ✅ | `cee8c2e` |
| v1.5 init-check（启动时校验 opencode.json）| ✅ | `00fcd19` |
| v1.6 RR5 hard block | ✅ | `00fcd19` |
| v1.7 auto-patch 主仓 opencode.json | ✅ | `1c420a1` |
| v1.7b/c marker 调整 | ✅ | `d9b774e` / `bafa22c` |
| v1.8 TUI plugin entry（双 plugin 架构）| ✅ | `ebc2491` |
| **v1.9** TUI entry shape + 切 tui.json（R-α/β/γ 修复）| ✅ | `3d34cba` |
| **v1.9.1** 移除 JSX slot 防止 plugin 加载失败 | ✅ | `80f6b28` |
| **v1.10** RR7 init — /serenity-init slash command + DialogPrompt UX | ✅ | `d026b05` |
| **v1.10.1** /serenity-init 修复：self-install 到 global tui.json（非 serenity 目录可见）| ✅ | `d0ab00a` |

> **下一步**：v0.0.3 候选（5 项 open follow-ups）——见上文 v0.0.2 — 2026-06-07 (release) 块末尾 Open follow-ups 段。

---

## 关键决策

### 范围层（RR1-RR7，已写入 docs/requirements-v0-scope.md）

| # | 规则 | 关键约束 |
|---|------|---------|
| RR1 | cwd 内必须有 `/.serenity`，内容 = 实例名 | 文件是单一真相源 |
| RR2 | 激活后首次加载 `.opencode/skills/<实例名>/SKILL.md` | 每次新 session 启动时 |
| ~~RR3~~ | ~~禁 bash；命令通过 MSM（已有/新写）~~ | ~~同名 bash tool 抛错 + permission.bash:deny~~ ❌ 2026-06-08 移除：不再禁止 bash，移除 bash-override 工具 + permission-guards 守卫 + 权限 deny。详见 serenity-plugin-development v0.2。|
| RR4 | cwd 内全部权限 | 默认 allow |
| RR5 | cwd 外全部无权限 | deny/throw |
| RR6 | cwd 必须在 git repo 内 | 否则 plugin 不工作 |
| RR7 | plugin 应能"初始化 cwd 为 serenity" | 5 子点（slash `/serenity-init` / 默认目录名 / 不自动 init / 自动 add+commit / 仅创建 /.serenity）|

### 工程层决策

| # | 决策 | 理由 |
|---|------|------|
| 11 | **zod 锁 4.1.8**（与 `@opencode-ai/plugin@1.15.13` 严格匹配）| 4.4.3 minor 不兼容；3.x 缺 `$ZodType` |
| 12 | **plugin 入口签名** `(input) => Promise<Hooks>`，非 `(api) => PluginReturn` | 真实 SDK 1.15.13 形式 |
| 13 | **tool 用 `tool()` 工厂 + `Hooks.tool[name]`** 注册 | SDK 1.15.13 形式 |
| 14 | **同名 bash tool 覆盖**（L3 验证）| `[...builtin, ...custom]` 顺序 = 后注册覆盖前注册 |
| 15 | **msm_exec 30s 超时** | v0 固定；v1 可配置 |
| 16 | **msm_exec 路径解析** 用 `path.resolve` + `isPathInside` 校验 | 防路径逃逸 |
| 17 | **mcp 客户端不引入** | v0 简化：plugin 自包含读 `mech-registry.json`（实例内）|
| 18 | **RR7 触发走 `experimental.chat.system.transform` hook** | SDK 不暴露 `registerCommand`；v0 用 system prompt 注入提示 LLM 改用 msm_exec |
| 19 | **Q5（msm_exec 完整签名）+ Q6（permission schema）推迟 v1** | m0100 后自主推进；v0 已最小可行；扩展留 v1 |
| 20 | **Q7（主仓定位）取消** — cwd 就是主仓 | m0085：plugin 不维护 instance→main_repo 映射；不需要 HOME_SERENITY_ROOT env |
| 21 | **Q8（plugin 仓身份）删除** | plugin 仓就是 plugin 仓，绝不可能是 serenity 实例 |
| 22 | **plugin 仓工程实践**（git/test/文档）独立于 RR6 | m0088 区分"plugin 自身的工程需求" vs "serenity 实例的 git 要求"（plugin 仓用 git 是为了开发/发布/版本控制；不是 RR6 "plugin 运行时宿主必须在 git repo" 的一部分 — RR6 作用于 plugin 加载时 cwd，而非 plugin 工程自身）|

### 撤回记录

- **R1-R5 旧版**（基于 R1-R5 隐含 B 软专属假设）→ 已被 RR1-RR7 取代（用户 m0070 + m0073 重定义为"plugin 是 opencode 行为的强约束层"）
- **Q5 / Q6 撤回**（不在范围层问，跳级）→ 移到 v1 接口/契约层
- **Q8 撤回**（plugin 仓身份 = 废问题）

---

## 未决问题

| # | 问题 | 状态 |
|---|------|------|
| 1 | **主仓 opencode.json 集成** | ✅ v0.0.1 完成（主仓 `240dffe` + `0460bf1`）|
| 2 | **msm_exec 完整签名（v1）** | 当前 v0 = `{msm_name, args}`；v1 可加 `cwd` / `timeout` / `env` |
| 3 | **permission schema 真实集成（v1）** | 当前 v0 用 tool.execute.before hook 拦截；v1 可改用 permission.ask hook（若宿主触发）+ opencode.json |
| 4 | **RR7 完整 slash command（v1）** | v0 用 system.transform 注入；v1 期望 SDK 暴露 registerCommand 或自实现 |
| 5 | **plugin 仓的"开发期测试"** | 当前 vitest 测纯逻辑；v1 可加集成测试（在真实 serenity 主仓中跑）|
| 6 | **v0.1 候选 — 两阶段 init** | ✅ v0.1-1 完成（commit `fc1f6a7`，13 tests）|
| 7 | **v0.1 候选 — Pre-indexed resources** | ✅ v0.1-2 完成（commit `1c4ce6b`，4 tests）|
| 8 | **v0.1 候选 — Hook 工厂分层** | ✅ v0.1-3 完成（commit `ca4360f`，9 tests）|
| 9 | **v1 候选 — symlink 防御** | ✅ v1-1 完成（commit `20bf791`，6 tests）|
| 10 | **v1 候选 — Hashline Edit** | ✅ v1-2 完成（commit `e39ed23`，13 tests；自实现 FNV-1a）|
| 11 | **主仓实地验证** | ✅ v0.0.1 完成（用户 m1180 确认 toast 显示）|
| 12 | **TUI toast 实测** | ✅ v0.0.1 完成（v1.9.1 修复 JSX runtime 根因，commit `80f6b28`）|
| 13 | **v1.3-v5b 撤销** | 🟡 代码仍 active，1.16+ UI 不响应 v2 API reply（暂不影响功能）|
| 14 | **PluginModule.tui?: never 限制** | ✅ v1.8 用 2 个独立 entry 绕过 |
| 15 | ~~**永久 slot 状态指示器**~~ | ❌ v0.0.2 决定不做——JSX runtime 与 tsc 编译不兼容，bun-plugin-solid 重构成本与价值不匹配。当前 toast 通知已足够。 |

---

## 项目演进历史

### 关键里程碑

| 时间 | 事件 | commit |
|------|------|--------|
| 20:45 | 创建 SESSION + plugin 仓骨架 6 文件 | — |
| 20:55 | GitLab API 创建远程仓（id=32, private, yh）| — |
| 21:00 | 项目框架 12 文件 + D1-D12 元信息 | `99e95a3` |
| 21:00 | SESSION 模式迁移（事项化→项目即会话）| `09810ef` |
| 21:30 | 范围层 RR1-RR7 文档化 | `70db320` |
| 22:00 | 方案层 10 步协议 + 5 模块 | `b92eed6` |
| 22:30 | 接口层 6 契约 + 10 错误类 | `f2b3845` |
| 23:30 | 实现层（src/ 9 文件 + tests/ 6 文件）| `e91f8cc` |
| 06-05 00:00 | oMo + skillful 代码级对照（v0.1 候选）| `ac9b7ec` |
| 06-05 00:00 | v0.1-1 两阶段 init | `fc1f6a7` |
| 06-05 00:05 | v0.1-2 path-arg 守卫 | `1c4ce6b` |
| 06-05 00:10 | v0.1-3 hook 工厂分层 | `ca4360f` |
| 06-05 00:15 | v1-1 symlink 防御 | `20bf791` |
| 06-05 00:30 | v1-2 hashline edit | `e39ed23` |

### v0.0.2 文件清单（实际）

> 旧 "28 文件清单" 段（v1 完成后）已废弃——v0.0.2 实际是 **40+ 文件**：v1-2 hashline 已撤回、新增 install.ts / tui.ts / msm-schema.ts / config-schema.ts / 5 hook 工厂 / 10 util、tests 扩到 23 / 320 cases、docs 7 篇。

**顶层 (7):**

| 路径 | 用途 |
|------|------|
| `README.md` | 用户入口（v0.0.3 重写计划） |
| `SESSION.md` | 本文件（项目即会话） |
| `package.json` | version 0.0.2, deps: `@opencode-ai/plugin@1.16.2` + `zod@4.1.8` |
| `tsconfig.json` / `tsconfig.test.json` | TS 5.x strict + Node 20+ |
| `vitest.config.ts` | vitest + node 环境, testTimeout 20s |
| `.gitignore` / `.npmrc` / `.nvmrc` | Node/TS/pnpm 友好配置 |
| `bun.lock` / `pnpm-lock.yaml` | 依赖锁 |

**bin/ (1):**

| 路径 | 用途 |
|------|------|
| `bin/opencode-serenity-plugin.js` | CLI: `install` / `uninstall` (v1.11) |

**src/ 顶层 (12 .ts):**

| 路径 | 用途 |
|------|------|
| `src/index.ts` | **server entry** — 4 tool + 4 hook (v1.9 R-β 改 default export `{id, server}`) |
| `src/tui.ts` | **TUI entry** — toast + /serenity-init + global tui.json 自安装 (v1.10 + v1.10.1) |
| `src/activation.ts` | 两阶段 init (Phase 1 sync RR6 + Phase 2 async RR1+RR2+config-patch) |
| `src/state.ts` | 全局激活状态 singleton + ReadyStateMachine 接入 |
| `src/msm.ts` | msmListTool + msmExecTool + msmAdminTool (4 tool) |
| `src/msm-schema.ts` | flag normalize (v0/v1) + tokenizeArgs + path-arg 校验 (v0.1-2 + v1-1) |
| `src/config-schema.ts` | zod-first 4 schemas (v1.13 D26) + HookName/HOOK_NAMES export |
| `src/install.ts` | bin install lib (project + global, XDG + APPDATA) (v1.11) |
| ~~`src/bash-override.ts`~~ | ~~同名 bash tool 覆盖 (RR3 第三层)~~ ❌ 2026-06-08 移除 |
| `src/errors.ts` | 13 个 SerenityError 子类 + 1 基类 (v0.1-2 + v1-1 各加 1) |
| `src/types/index.ts` | 内部类型: SerenityState + INACTIVE_STATE + SerenityPluginInput |

**src/hooks/ (5 工厂):**

| 路径 | 用途 |
|------|------|
| `src/hooks/util.ts` | isHookEnabled + safeHook + safeCreateHook (oMo 模式 v1.12) |
| `src/hooks/permission-guards.ts` | createPermissionGuards — tool.execute.before, **RR5 hard block, 故意不 catch** |
| `src/hooks/compacting.ts` | createCompactingHooks — system.transform (SKILL.md 注入) + session.compacting |
| `src/hooks/shell-env.ts` | createShellEnv — 注入 HOME_SERENITY_ROOT + SERENITY_INSTANCE + SERENITY_PLUGIN_VERSION (v1.18 动态版) |
| `src/hooks/permission-auto-reply.ts` | createPermissionAutoReplyHandler — event hook, v1.3-v4 "无条件 reply always" |

**src/util/ (10 helper):**

| 路径 | 用途 |
|------|------|
| `src/util/git.ts` | findGitRoot (throws) + tryFindGitRoot (returns null) + isPathInside + git ops (v1.18 bin 复用) |
| `src/util/path.ts` | buildSkillPath + validateSkillExists + isValidInstanceName |
| `src/util/serenity-file.ts` | readSerenityFile (RR1) |
| `src/util/ready-state.ts` | ReadyStateMachine (idle/loading/ready/error/disabled) (v0.1-1) |
| `src/util/init.ts` | initSerenity (RR7) — 写 /.serenity + git add+commit |
| `src/util/init-check.ts` | checkSerenityConfig (v1.5, warn-only) |
| `src/util/config-patch.ts` | patchMainRepoOpencodeJson (v1.7, auto-grant read/edit=allow) |
| `src/util/msm-call.ts` | callMsmExec + callMsmExecMeta + parseProtocolFlags (S022 RFC, 共享 spawnMsmProcess helper v1.18) |
| `src/util/tui-install.ts` | global tui.json 自安装 (v1.10.1, v1.18 薄包装 install.ts) |
| `src/util/log.ts` | 统一 log wrapper (no-op, 65 sites) |

**tests/ (23 文件 / 320 cases):**

| 类别 | 文件 |
|------|------|
| 启动 | `activation.test.ts` (Phase 1+2) / `ready-state.test.ts` (machine) |
| msm 协议层 | `msm-{call,schema,registry,admin}.test.ts` |
| config | `config-{schema,patch}.test.ts` |
| hook | `hooks-{util,guard}.test.ts` / `permission-{auto-reply,guards-v16}.test.ts` / `compacting-skill-inject.test.ts` |
| init/install | `init-check.test.ts` / `install.test.ts` / `tui{-install,}.test.ts` |
| util | `util-{git,init,path,serenity-file}.test.ts` |
| 顶层 | `errors.test.ts` (13 错误类) / `plugin.test.ts` (full entry) |

**docs/ (7 篇):**

| 路径 | 用途 |
|------|------|
| `docs/requirements-v0-scope.md` | RR1-RR7 范围层 (v0 终版) |
| `docs/architecture-v0.md` | 方案层（本文件 SESSION.md 引用） |
| `docs/contract-v0.md` | 接口层（6 契约 + 13 错误） |
| `docs/requirements-v0-summary.md` | ⚠️ 已过时（旧 R1-R5 演进史） |
| `docs/v0.1-candidates.md` | ✅ ALL DONE (3 候选已实施) |
| `docs/rr7-init-design.md` | v1.10 + v1.10.1 RR7 init 实施记录 |
| `docs/refactor-direction-v1.11.md` | ✅ Done 2026-06-07 (v1.11-v1.17 演进) |

### 远程仓

- `git@github.com:tellmewhattodo/opencode-serenity-plugin.git` — private, default_branch=main
- Web: `https://github.com/tellmewhattodo/opencode-serenity-plugin`
- 迁移历史：2026-06-07 从 `git@home.gitlab:yh/opencode-serenity-plugin.git` → `git@github.com:tellmewhattodo/opencode-serenity-plugin.git`（详见上文 v0.0.2 — 2026-06-07 (release) 块的 Remote migration 段）
- commits（v0.0.2 = 12 新增，已列于上文 v0.0.2 块的 Commits (12 new since v0.0.1) 段）

---

## 最近变更

- 2026-09-06 — **v0.9.0 对齐推进（S156，specs v1.4.0）**：Phase 1 工具面（9 契约名硬切）、Phase 2 注入 9 块（compacting.ts 重写：ACC→Metaphor→Principles→CCE→EAP→[状态]→SKILL→Tools→Session，Root 边界并入 Principles，删除旧 `=== Serenity Constraints ===` 块）、Phase 3 机制（trajectory-assistant 改名/registry 写保护/dashboard health registry 段）、Phase 4 logbook rebuild（借道宿主压缩，`src/session/rebuild.ts` 新建）；562/562 tests 全绿（37 files，compacting-skill-inject 重写为 9 块断言 8红→12绿 + rebuild.test.ts 新增 10）。**未发布**（bump+发布待用户确认；详见上方 当前焦点 + CHANGELOG v0.9.0 段）
- 2026-06-07 — **v0.0.2 release**：RR7 init + bin install CLI + msm_exec 协议层 + hook 保护 + zod-first；320/320 tests pass；远程从 GitLab 迁 GitHub（commit `d0ff4e2`；详见上方 v0.0.2 — 2026-06-07 (release) 块）
- 2026-06-06 — **v1.10.1** 修复 `/serenity-init` 在非 serenity 目录不可见：TUI plugin 自安装到 `~/.config/opencode/tui.json`，让 plugin 在**任何**目录被 opencode 加载；184/184 tests pass（commit `d0ab00a`；详见 `AGENT_SESSIONS/2026-06-06--S020--fix-serenity-init-visibility`）
- 2026-06-06 — **v1.10** RR7 init — `/serenity-init` slash command + DialogPrompt UX（commit `d026b05`，156 tests pass）
- 2026-06-06 — **v0.0.1 release**：bump version 0.0.0 → 0.0.1（commit `df80a8c` release + `521f8d1` silent 收口）；README 重写为 release 状态；SESSION 收尾
- 2026-06-06 — **v1.9.1** 修复 TUI toast 加载失败：移除 JSX slot（@opentui/solid JSX runtime 只支持 build-time transform），保留 toast；125/125 tests pass（commit `80f6b28`）
- 2026-06-06 — **v1.9** 修复 TUI 加载机制（R-α/β/γ）：tui.json 拆分、default 形状改 `{ id, tui/server }`、显式 export id；用户实测 toast 显示（commit `3d34cba` + 主仓 `240dffe`）
- 2026-06-06 — **S019** 调研完成：3 subagent 并行定位 tui-toast 根因；报告 `AGENT_SESSIONS/2026-06-06--S019--tui-toast-investigation/docs/tui-toast-root-cause.md`
- 2026-06-05 — **v1.8** TUI plugin entry：双 plugin 架构 + toast 通知（commit `ebc2491`）
- 2026-06-05 — **v1.7** auto-patch 主仓 opencode.json：含 marker key 演进（`bafa22c`）
- 2026-06-05 — **v1.6/v1.5** RR5 hard block + init-check（commit `00fcd19`）
- 2026-06-05 — **v1.4** SKILL.md 全文注入 system prompt（commit `cee8c2e`）
- 2026-06-05 — **v1.3-v2** 升 v2 SDK + auto-reply permission（commit `809bf94`）
- 2026-06-05 — **v1.2 / v1.1** hashline edit + symlink 防御（commit `e39ed23` / `20bf791`）
- 2026-06-05 — **v0.1-3 / v0.1-2 / v0.1-1** hook 工厂分层 / path-arg 守卫 / 两阶段 init（commit `ca4360f` / `1c4ce6b` / `fc1f6a7`）
- 2026-06-04 — **v0 实现层** 24 tests pass / typecheck / build green（commit `e91f8cc`）
- 2026-06-04 — **接口层 / 方案层 / 范围层** 文档化（commit `f2b3845` / `b92eed6` / `70db320`）
- 2026-06-04 — **项目框架 12 文件 + SESSION 模式迁移**（commit `99e95a3` / `09810ef`）

---

## 关联文档

### 主仓（home-serenity）
- 调研 SESSION：`AGENT_SESSIONS/2026-06-04--opencode-plugin-investigation/`
- 需求源（旧 R1-R5）：`AGENT_SESSIONS/2026-06-04--opencode-plugin-investigation/requirements-locked-v0.md`
- 架构 L4：`AGENT_SESSIONS/2026-06-04--opencode-plugin-investigation/docs/plugin-v0-architecture.md`
- 可行性 L5：`AGENT_SESSIONS/2026-06-04--opencode-plugin-investigation/docs/plugin-viability-analysis.md`
- 路线 L6：`AGENT_SESSIONS/2026-06-04--opencode-plugin-investigation/docs/plugin-implementation-roadmap.md`
- 范围层（v0 终版）：`AGENT_SESSIONS/2026-06-04--opencode-plugin-investigation/requirements-locked-v0.md`（旧 R1-R5）+ plugin 仓 `docs/requirements-v0-scope.md`（新 RR1-RR7）
- 主仓事项化 SESSION（已收口）：`AGENT_SESSIONS/2026-06-04--opencode-serenity-plugin-skeleton/SESSION.md`
- 主仓 project link：`AGENT_SESSIONS/_project-links.md`

### plugin 仓（opencode-serenity-plugin）
- 范围层：`docs/requirements-v0-scope.md`
- 方案层：`docs/architecture-v0.md`
- 接口层：`docs/contract-v0.md`
- 旧需求：`docs/requirements-v0-summary.md`（R1-R5 旧版）
