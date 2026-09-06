# 更新日志
## v0.9.0 — specs v1.4.0 对齐（S156，2026-09-06）✅ 已发布

> 发布记录：npm `@shgroup/opencode-serenity-plugin@0.9.0`（npmjs.org official latest，内网 Nexus 镜像未同步 = 已知现象）+ git commit `8309f45` + tag `v0.9.0`（手动纠正落点至 8309f45，见 S156）。562/562 tests 全绿（37 files）。Phase 5 localstore（全新工具）未做。

### 工具面（11 → 9 契约名，硬切无别名）

| 旧（v0.8.7） | 新（v0.9.0） | 动作 |
|-------------|-------------|------|
| msm_list + msm_exec + ccc_admin（执行面）| **`msm`** 单入口 | 合并：`msm(name, args)` 执行 / 未命中模糊候选 / `inspect=true` / 无参目录 |
| ccc_admin（管理面）| **`container_admin`** | action=msm（register/deregister/check/guide/ccc-config）+ action=config（CCC 配置读）|
| cc_fs | **`container_fs`** | 注册键改名（15 子命令保留）|
| cc_git | **`container_git`** | 注册键改名（6 子命令保留）|
| session | **`logbook`** | 注册键改名 + rebuild 子命令 |
| acc_kit | **`dashboard`** | 注册键改名 + health registry 完整性段 |
| eap + neat | **`praxis`** | 合并 + cce（specs §5.4 逐字）|
| loop | **`handyman`** | 注册键改名（白名单 worker 语义）|
| resident | resident | 保留（§4.2 非标准超集）|

### 注入面：compacting.ts 重写为 9 块（specs §5.0-5.9 + §5.11）

ACC → Metaphor → Principles → CCE → EAP → [状态块 safe-mode 条件] → SKILL 全文 → Tools → Session。Metaphor/Principles/CCE/EAP 逐字对齐 specs；Root 边界并入 Principles 块（删除旧独立 `=== Serenity Constraints ===` 块）；Session 块含 TRAJECTORY-ASSISTANT 预声明。

### 机制面

- **trajectory-assistant**（session-keeper 改名）：前缀 `[TRAJECTORY-ASSISTANT · CHECKPOINT]` + ACK 码 + 阈值 150→100 + READ_TOOLS 扩展 + 预声明进 Session 块
- **registry 写保护**：permission-guards 拦 read/edit/write 写 `references/mech-registry.json`（isRegistryPathBlocked）
- **dashboard health registry 段**：BOM/wrapper/字段/name 唯一/path 根内+存在（checkRegistryHealth 导出）
- **logbook rebuild**（新 `src/session/rebuild.ts`）：借道宿主压缩 — `client.session.summarize` + compacting hook 注入"读 SESSION.md 从检查点继续"指令 + autocontinue

### 测试

- **562/562 全绿**（37 files，+11 since v0.8.7 基线 551）
- `compacting-skill-inject.test.ts` 重写为 9 块断言（8 红 → 12 绿；Metaphor/EAP/safe-mode 状态块/活跃 Session 块 新增覆盖）
- `rebuild.test.ts` 新增 10 tests；plugin/session-keeper 测试同步改名

## v0.8.7 — 2026-08-19（ccc_admin 注册表聚合修复 + dev-kit publish 加固）

**触发**：`ccc_admin register --skill <name>` 时旧逻辑写 per-skill 注册表 → `msm_exec` 按 cwdRoot aggregate registry 查找失败（skill 参数导致注册表分裂）。

- **`ccc_admin register` 始终写 aggregate registry**：skill 参数降级为 ownership 检查 + metadata（不再决定写入目标）；修复 register 后 msm_exec 找不到新 MSM 的问题。
- **dev-kit publish hardening**（develop-kit 增强）：`--registry <url>` 显式指定 npm registry（防内网 Nexus E400，S138 教训）；tarball 核对（`npm pack --dry-run` 断言 dist 必需文件）；版本一致性检查（package.json vs CHANGELOG）；自动 tag v<version> + push（发布即 tag）；`--bump` 同步版本。
- 测试：551/551 全绿（37 files）。

## v0.8.6 — 2026-08-19（ccc_admin register skill 参数）

- **`ccc_admin register` 接受可选 `--skill` 参数**：path-skill 一致性检查（默认 cccName 向后兼容）。

## v0.8.5 — 🛑 resident 中断清理加固（S110 用户反馈）

用户反馈"start 被中断后 resident 没有停止进程"，修复中断清理可靠性：

- **abort 处理加固**：killGroup 同时杀进程组（`-pid`）和单个 pid（进程组可能已消失）；abort 已触发时立即执行。
- **finally 兜底强杀**：工具 promise 被中断后，finally 检查 `abort.aborted` 并 SIGKILL 兜底，杜绝残留进程。
- **新增测试**：真实 detached 进程组 abort 中断 → SIGTERM 清理 + close 触发（548 全绿）。
- ccc-config 文档更新：说明中断时 resident 进程也会被杀（与 loop 一致）。

## v0.8.4 — ⏳ resident start 改为阻塞挂住（像 loop）

根据用户反馈（"start 后为何立即返回，像 loop 一样 hang 住即可"）：

- **`resident` 调用改为阻塞**：spawn runner 后不再立即返回，而是 `await close` 挂住，直到 resident 停止（被杀/机器关机）才返回。
- **移除 `unref()` 和 20s 状态轮询**：逻辑与 loop-tool 的阻塞模式一致。
- 返回：正常停止时 `{ok:true, stopped:true}`；异常退出/取消时抛错。
- ccc-config 文档更新：说明"调用会阻塞挂住，运行结束后返回；需后台时放进 loop/独立 serve"。

## v0.8.3 — 🧹 resident 接口极简化为 start-only

根据用户反馈（"设计过于复杂，CCC 难以理解"）简化 resident 接口：

- **`resident` tool 去掉 action 参数**：调用即 `start`，start 后挂起常驻，无需查询/停止。
- **移除 `status` / `stop` action**：CCC 只需理解"resident = 启动并保持运行"。
- **ccc-config resident 段同步简化**：改为 SETUP / HOW IT WORKS / NOTES 三节，突出单一用法 `resident`（无参数）。
- 防重入保留：已运行返回 `already_running`；停止方式在文档注明（kill PID）。

## v0.8.2 — 📖 ccc-config resident 使用指南

`ccc_admin ccc-config` 的 resident 段扩展为完整使用指南：

- **设计理念（DESIGN RATIONALE）**：双 while 循环、mind.md 即身份、时间界限、目的性不能重、约束继承。
- **使用方式（USAGE GUIDE）**：配置/心智文件创建、start/status/stop 三步、状态值语义、恢复流程、每轮行为、STOP 提前了结、SQC 首选用例。
- **运维注意事项（OPERATIONAL NOTES）**：gitignore、端口、detached 守护、日志路径、权限模型、失败排查。

## v0.8.0 — 🏠 resident 顶层常驻 Agent（M0）+ acc_kit 通用能力工具

首个顶层常驻 agent 功能（RFC《永存 Agent 载体设计》M0）：

- **`resident` tool**：`start` / `status` / `stop`。双层 while 循环——外层永存，内层生命周期（`lifetimeMs`）到期自我了结（写心智 → 新 session → 新周期）。
- **心智协议**：`mind.md` 是唯一持久记忆，每轮原子固化（tmp+rename），agent 可死、磁盘即恢复源。
- **时间界限**：`lifetimeMs` 到期 agent 自我了结；每轮 POST 超时 = `min(timeoutMs, 剩余+grace)`。
- **可靠性**：锁 O_EXCL 防并发 start、serve 崩溃自愈、stop PID 身份校验、异步 curl + abort（SIGTERM 不延迟）、端口 CCC 盐化、remainingMs 每生命周期刷新。
- **`acc_kit` tool**：`cc_ck` 升级——`health`（CCC 三原则）/ `time` / `wait`。
- **配置**：`.serenity-meta/resident.json` + `mind.md`；`ccc_admin ccc-config` 增加 resident 配置段。
- 551+ tests 全绿；2 轮静态审查（实现正确性 + 并发时序）高危修复全部落地。

## v0.7.0 — 🛠️ Session-Keeper 全面修复与加固

Session-Keeper 从 v0.5.48 到 v0.7.0 经过多轮修复，本次小版本整合所有改动：

- **触发机制**：改为增量计分（`tool.execute.before` 实时累加）+ DCP 即时注入（`tool.execute.after` 工具返回中直接提醒），不再依赖遍历历史消息。
- **计分规则**：write/edit=3分，task=10分，read/grep/glob/msm=1分，时间 1分/分钟；默认阈值 150。
- **ACK 检测**：text 和 reasoning part 均有效；只有正确 code 才清零，未 ACK 每轮持续提醒。
- **会话恢复**：反向扫描最近匹配 + 校验 `YYYY-MM-DD--` 前缀，杜绝子 agent 系统提示污染会话名。
- **SDK 适配**：统一 ToolPart 格式（`type=="tool"`），移除废弃 toolUse/toolResult 分支。
- **代码加固**：清理死字段、空安全防护、`removeActiveSession` 逻辑修复。

## v0.5.29 — 🧠 Todo 列表自动显示当前工作会话

激活一个工作会话后，Agent 创建的每条 todo 列表顶部都会自动出现当前会话的标识（如 `SESSION: S035 — 插件长期开发`），一眼就知道"现在在哪个会话里干活"。这个标识项以已完成状态显示，不会跟待办任务混在一起。

## v0.5.28 — 📋 切换会话后，Agent 立即知道该做什么

以前切换到会话后，Agent 可能过一会儿才"反应过来"。现在只要切过去，它立刻就知道：去读 SESSION.md、同步 todo、往进度记录里记东西。不需要等下一轮对话。

## v0.5.27 — 🔗 会话进度和 todo 自动同步

激活工作会话后，Agent 会自动读取当前 SESSION.md，把里面的待办拆成 OpenCode 内置的 todo 条目。一件事完成了、进度更新了，两边同时记录，不用操心哪个才是最新的。

## v0.5.26 — 💬 Agent 的"脑内指令"写得更清楚了

Agent 每次思考前，插件会在它的系统提示里注入约束规则（哪些文件能碰、用哪个命令工具、怎么管理会话）。这次把 4 块提示词全部用完整 EAP 理论重写了一遍——每条规则的含义更明确，不再有模糊地带，Agent 执行起来更精准。

## v0.5.25 — 📚 Neat 设计协作协议升级为完整版

`neat` 工具之前给的是精简版。现在跟理论仓库同步，新增了完整的内容架构章：覆盖论文写作、翻译规范、双语定义模式、英式中文寄存器等 11 条实战经验，不仅是软件需求对齐，非软件场景的内容设计也能用。

## v0.5.24 — 📚 EAP 认知框架升级为完整版

`eap` 工具现在返回完整的 6 章论文：前置抽象的无穷性、语言作为接口（英式中文策略、词汇辨析）、实证案例、理论推论（编码贬值 vs 抽象升值）、信息论形式化证明。在对话框里直接问 `eap` 就能看到全貌。

## v0.5.23 — ⏱️ loop 单轮超时延长到 2 小时

后台 loop 任务每轮的最长等待时间从 1 小时调整为 2 小时，长任务不再被中途掐断。

## v0.5.22 — 🔄 loop 运行时，TUI 能看到进度了

以前 loop 在后台跑，你不知道它干到哪了。现在每轮完成都会弹一个 toast 通知："第 3 轮完成"、"✅ 任务完成"、"❌ 任务失败"。不用切出去看进度文件了。
