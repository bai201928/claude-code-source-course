# Graphify 辅助的课程结构审计

## 1. 审计目的

本审计使用 Graphify 寻找候选架构中心、跨目录关系和可能遗漏，再回到当前 `claude-code-CLI/` 源码核验。它服务于课程拆章、依赖排序和 Harness 演进，不向教材提供最终事实。

固定证据链：

```text
Graphify 候选关系
-> 直接源码核验
-> 必要实验或官方资料
-> 事实状态
-> 对课程结构的影响
```

## 2. 图谱状态与边界

### 2.1 构建状态

- Graphify 版本：`0.9.28`；
- 输入：`claude-code-CLI/`；
- 模式：本地 AST、`--code-only`、无语义模型；
- 扫描源码文件：1,902；
- 节点：16,218；
- 聚类后有效边：61,295；
- 社区：344；
- `EXTRACTED` 边：60,109；
- `INFERRED` 边：1,186；
- 悬空端点、缺失端点、自环和同端点折叠：均为 0；
- 语义模型耗时：0，没有上传源码或调用 Gemini。

图谱可重建，位于 `graphify-out/`，已被 `.gitignore` 排除。

### 2.2 已验证的能力

- `god-nodes` 能返回架构中心；
- `QueryEngine query loop messages` 能定位带源码位置的候选子图；
- 最短路径和节点邻居查询可用；
- 项目 MCP 只开放查询、节点、邻居、社区、架构中心、统计和最短路径；
- `codex mcp list` 同时保留 `graphify` 与原有 `node_repl`；
- 全局自定义模型 Provider、插件和其他配置没有被项目 MCP 覆盖。

### 2.3 准确性样本

确认的 `EXTRACTED` 关系：

```text
QueryEngine.submitMessage()
--calls-->
query()
```

源码在 `src/QueryEngine.ts -> submitMessage()` 中直接调用 `query(...)`，关系成立。

确认的 `INFERRED` 假阳性：

```text
QueryEngine.submitMessage()
--indirect_call-->
src/entrypoints/agentSdkTypes.ts::tool()
```

源码中的 `tool` 是传给 `canUseTool(tool, input, ...)` 的局部参数，并不是对导出工厂 `tool()` 的调用。该边不成立。

另一个边界是 `QueryEngine.submitMessage()` 到 `queryModelWithStreaming()` 的图中最短路径。它经过共享导入、文件包含和邻近符号，不等于运行调用。源码核验后的主链是：

```text
QueryEngine.submitMessage
-> query
-> queryLoop
-> productionDeps().callModel
-> queryModelWithStreaming
-> queryModel
-> anthropic.beta.messages.create({ ...params, stream: true })
```

结论：即使是 `EXTRACTED` 也要看关系类型；`imports`、`contains`、邻接和最短路径不能被改写成 `calls`。`INFERRED` 只用于提出阅读假说。

## 3. CLI 启动、配置与运行表面

### Graphify 候选关系

架构中心包含 `main.tsx`、`run()`、`REPL()`、`getGlobalConfig()`、`state.ts`、`settings/settings.ts`、`QueryEngine`。图中这些节点连接大量入口、配置、状态和运行组件，提示课程不能从 `query.ts` 直接开始。

### 直接源码核验结果

- `src/main.tsx` 和 `src/entrypoints/init.ts` 负责启动期装配，但不同运行表面不会全部进入同一 UI 路径；
- 交互式 REPL、print/headless 和 SDK 入口的输入适配、状态容器和输出消费不同；
- 配置不是单文件读取。`src/utils/settings/settings.ts` 合并插件、用户、项目、本地、flag 和 policy 等来源；policy 来源内部采用 remote、MDM、managed file、HKCU 的优先选择；
- 启动还包括信任、权限上下文、工具集合、MCP、插件、遥测和清理注册，不能用“解析参数后调用 REPL”概括；
- 远程托管设置可在启动时 cache-first 加载，并通过 change detector 热更新权限、环境和遥测。

### 证据状态

`快照事实，已确认`。图谱只提供中心节点，运行表面和配置优先级来自源码。

### 对课程结构的影响

CLI 阶段拆为运行表面、参数与配置、启动装配、系统上下文、生命周期五个闭环。必须先解释“同一产品有多个输入/输出适配器”，再进入 Query 主线。配置、信任和 policy 是后续 Permission、Sandbox 与企业治理的前置。

## 4. QueryEngine、Query Loop、消息与模型调用

### Graphify 候选关系

`QueryEngine`、`query()`、`queryLoop()`、`ToolUseContext`、`REPL.tsx`、`claude.ts` 是高连接节点。查询“QueryEngine query loop messages”能返回源码位置，但最短路径混入导入和包含关系。

### 直接源码核验结果

必须区分两条输入路径：

```text
交互式 REPL
-> AppState / messagesRef
-> processUserInput
-> query()

SDK / Headless
-> QueryEngine.mutableMessages
-> processUserInput
-> messages 快照
-> query()
```

它们在 `query()` 汇合，不是 REPL 调用 `QueryEngine`。

请求进入模型前还要经过：

```text
messages
-> compact boundary 之后的可见历史
-> Tool Result Budget
-> snip / microcompact
-> context collapse 或 auto compact
-> prependUserContext
-> queryModelWithStreaming
-> normalizeMessagesForAPI
-> ensureToolResultPairing
-> BetaMessageStreamParams
-> anthropic.beta.messages.create(..., stream: true)
```

工具循环由 `queryLoop` 收集 `tool_use`，进入 `runTools`。并发安全工具可分批并发，非并发安全工具串行；`runToolUse` 再执行输入校验、PreToolUse Hook、Permission、工具调用、PostToolUse/错误处理，并把 `tool_result` 送回下一轮。

### 证据状态

`快照事实，已确认`。关键位置包括：

- `src/screens/REPL.tsx -> processUserInput/query`；
- `src/QueryEngine.ts -> mutableMessages/submitMessage`；
- `src/query.ts -> query/queryLoop/runTools`；
- `src/query/deps.ts -> productionDeps().callModel`；
- `src/services/api/claude.ts -> queryModelWithStreaming/query/真实 API create`；
- `src/services/tools/toolOrchestration.ts`；
- `src/services/tools/toolExecution.ts -> runToolUse`。

### 对课程结构的影响

消息、纵向标杆、异步 Query Loop、请求投影、流式模型调用、Tool Loop 与终止/取消必须形成多个相邻闭环。标杆章用一次运行建立全景，后续单元再分别放大机制，避免第一章堆满所有细节。

## 5. Context Pipeline、压缩与记忆

### Graphify 候选关系

候选节点跨越 `query.ts`、`services/compact/`、`services/contextCollapse/`、消息附件、系统提示词、CLAUDE.md/Rules 和 session memory。它们没有收敛成一个单独的“Context 组件”。

### 直接源码核验结果

Context 至少包含不同时间点和不同状态语义：

- 请求前历史视图投影；
- Tool Result Budget；
- snip；
- microcompact；
- context collapse；
- auto compact；
- compact boundary 与保留消息；
- 压缩后的附件与清理；
- CLAUDE.md、Rules 和系统提示上下文；
- Session Memory；
- Resume 后 Skill、压缩提交和快照的恢复。

这些机制的触发条件、输入范围、输出落点和持久化语义不同。`messages`、`messagesForQuery` 和发送给 API 的规范化消息也不是同一个数组的别名。

### 证据状态

`快照事实，已确认`。图谱确认跨目录分布，具体顺序和状态变化由 `query.ts`、`services/compact/*`、`services/contextCollapse/*`、消息与恢复源码闭合。

### 对课程结构的影响

原先把 Context 压成大章会让初学者混淆“修改会话历史”与“只投影本次请求”。课程拆成请求视图、轻量裁剪、多级压缩、指令装配、长期记忆五个单元，并在 Transcript/Resume 阶段再次解释跨进程恢复。

## 6. Tool、Permission、Hook、Skill、MCP 与 Plugin

### Graphify 候选关系

候选节点分布在 `Tool.ts`、`services/tools/`、`utils/permissions/`、`utils/hooks.ts`、`skills/`、`services/mcp/` 和 `utils/plugins/`。图中邻近表明它们共享运行上下文，但不代表同一生命周期。

### 直接源码核验结果

- Tool 定义契约、模型可见 schema、调度、权限和真实执行分属不同层；
- `runToolUse` 先找工具并校验输入，再执行 PreToolUse Hook，随后解析 Hook 决策与正常 Permission 决策，允许后才调用工具；
- Permission 有 deny、ask、tool-specific check、模式转换、headless 行为、auto classifier 和安全检查等多层决策，不是一个布尔值；
- Sandbox 是更低层的执行约束。设置会被转换为文件系统和网络规则，关键设置、Skill 目录和危险 Git 路径有防御性保护；Permission 允许不等于可以绕过 Sandbox；
- Skill 发现时只需 frontmatter，正文可在调用时加载；存在 inline、fork、remote/MCP 等不同执行方式；
- MCP Tool、Resource、Prompt 与 MCP Skill 必须区分，MCP 工具最终仍进入统一 Tool/Permission/Hook 运行路径；
- Plugin 是发现、加载和注册多个扩展面的打包层，可贡献 command、agent、skill、hook、settings 等，不是新的 Query Loop。

### 证据状态

`快照事实，已确认`。主要源码：

- `src/Tool.ts`；
- `src/services/tools/toolOrchestration.ts`；
- `src/services/tools/toolExecution.ts`；
- `src/utils/permissions/permissions.ts`；
- `src/utils/sandbox/sandbox-adapter.ts`；
- `src/utils/hooks.ts` 与 `src/services/tools/toolHooks.ts`；
- `src/skills/loadSkillsDir.ts`、`src/tools/SkillTool/SkillTool.ts`；
- `src/services/mcp/client.ts`；
- `src/utils/plugins/pluginLoader.ts`。

### 对课程结构的影响

各机制先独立建立心智模型，再用一个“扩展栈协作”单元串起顺序、输入改写、权限、安全边界和冲突。不能按文件夹各讲一次后不解释一次真实 Tool Use 如何跨越它们。

## 7. Runtime Task、Work-item Task、Subagent 与 Agent Team

### Graphify 候选关系

`Task.ts`、`tasks/*`、`utils/task/framework.ts`、`utils/tasks.ts`、`AgentTool/runAgent.ts`、`LocalAgentTask`、`inProcessRunner.ts` 和 swarm/mailbox 节点形成多个社区。图谱提示“Task”存在同名异义。

### 直接源码核验结果

Runtime Task：

- `src/Task.ts` 定义 `pending/running/completed/failed/killed` 与多种运行任务类型；
- `AppState.tasks` 保存运行状态；
- `TaskOutput` 承担磁盘输出，通知队列把完成消息注入后续对话；
- Shell、Local Agent、Remote Agent、Teammate 等实现有不同 spawn、background、kill 和 resume 语义。

Work-item Task：

- `src/utils/tasks.ts` 管理持久化工作项；
- `owner`、`blockedBy`、claim 和列表操作描述协作任务，而非进程状态；
- `claimTaskWithBusyCheck()` 使用 task-list 级锁，把 busy-check 与 claim 放进同一临界区，解决 TOCTOU。

Subagent 与 Agent Team：

- Subagent 可以同步或异步运行，支持 background 与 resume；
- Agent Team 有长期身份、邮箱、任务所有权、权限转发、idle/wakeup 和 shutdown 协议；
- Team 不是“启动多个 Subagent”这么简单，生命周期和协作状态不同。

### 证据状态

`快照事实，已确认`。

### 对课程结构的影响

两种 Task 必须拆章。Subagent 主路径、异步/恢复、Agent Team 协议也分别闭环，最后再做多 Agent 失败与治理综合。Harness 顺序必须先有 Runtime Task，再有工作项所有权，之后才进入 Team mailbox 和权限同步。

## 8. Transcript、恢复、后台任务与 Cron

### Graphify 候选关系

恢复查询命中 `sessionStorage.ts`、`sessionRestore.ts`、`conversationRecovery.ts`、`ResumeConversation.tsx`、`LocalShellTask`、`cronTasks.ts`、`cronScheduler.ts` 和 `gracefulShutdown.ts`。这些节点结构相邻，但代表四类不同机制。

### 直接源码核验结果

Transcript 写入：

- `recordTranscript()` 清理消息、按 UUID 去重并维护 parent UUID；
- `appendEntry()` 是底层入口，消息、queue operation、file history、content replacement、context collapse commit/snapshot 等有不同语义；
- 主链和 Agent sidechain 写入不同文件，去重规则也不同；
- 写入先入队，优雅退出优先冲刷会话数据；
- QueryEngine 在进入模型循环前先记录用户消息，使“模型响应前进程被杀”仍可恢复。

Resume：

- `loadTranscriptFile()` 读取条目，`buildConversationChain()` 根据 UUID/parent UUID 重建链；
- `deserializeMessagesWithInterruptDetection()` 处理未配对 tool use、API 错误和中断轮次，区分 interrupted prompt、interrupted turn 与已正常终止的 tool result；
- `loadConversationForResume()` 还恢复 Skill 状态并运行 SessionStart resume hooks；
- `processResumedConversation()` 接管或 fork session ID，恢复成本、metadata、worktree、context-collapse、agent setting 和初始 AppState。

后台 Runtime Task：

- `LocalShellTask` 在 `AppState` 中维护运行状态，输出由 `TaskOutput` 持续落盘；
- 前台转后台是同一个已注册任务的状态转换，不应重复注册；
- 完成后更新终态并通过 pending notification 注入摘要；kill、flush、cleanup 和通知竞争需单独解释。

Cron：

- 任务分会话内存型与 `.claude/scheduled_tasks.json` 文件持久型；
- 调度器对文件任务使用项目级锁，避免多个会话重复触发；会话任务进程私有，不需要该锁；
- `nextFireAt`、`inFlight`、`lastFiredAt`、chokidar reload 共同保证调度与防重复；
- one-shot 漏执行需要用户确认，recurring 重新从当前时间调度；
- 稳定抖动用于避免整点惊群，过期策略限制长期会话资源累积。

### 证据状态

`快照事实，已确认`。主要位置：

- `src/utils/sessionStorage.ts -> appendEntry/recordTranscript/loadTranscriptFile/buildConversationChain`；
- `src/utils/conversationRecovery.ts -> loadConversationForResume/中断检测`；
- `src/utils/sessionRestore.ts -> processResumedConversation`；
- `src/tasks/LocalShellTask/LocalShellTask.tsx`；
- `src/utils/cronTasks.ts`；
- `src/utils/cronScheduler.ts`；
- `src/utils/gracefulShutdown.ts`。

### 对课程结构的影响

拆成 Transcript 数据模型与写入、链重建与 Resume、后台任务、Cron 四个单元。这样学习者能分别理解事件日志、恢复状态机、进程内任务和持久调度，而不是把“后台”泛化成一个概念。

## 9. Sandbox、安全、可观测性与企业治理

### Graphify 候选关系

候选节点包括 `permissions.ts`、`permissionSetup.ts`、`sandbox-adapter.ts`、`securityCheck.tsx`、`instrumentation.ts`、`sessionTracing.ts`、`cost-tracker.ts`、`remoteManagedSettings` 和 settings policy。它们连接执行控制、配置与遥测，但不是一个模块。

### 直接源码核验结果

安全与 Sandbox：

- Permission 决定应用是否允许一次工具调用，Sandbox 把文件系统和网络限制落实到实际进程；
- Sandbox 配置合并权限规则、managed policy、额外目录、网络域名和关键 deny 路径；
- 设置文件、Skill 目录和潜在 bare Git 逃逸路径有额外防御；
- `SandboxManager` 包装底层 runtime，提供依赖检查、策略锁定、命令包装、违规记录和命令后清理；
- 远程 managed settings 使用缓存、校验、危险变更检查和后台轮询；policy 来源采用明确优先级，并能热更新 Permission、环境和遥测。

可观测性与成本：

- 交互、LLM 请求、Tool、等待用户、执行和 Hook 有不同 Span；
- 并行模型请求必须把准确 Span 传给结束函数，否则响应可能挂到错误请求；
- 用户 Prompt 默认可被 redacted，内容级遥测要受显式配置控制；
- OpenTelemetry 的 metrics、logs、traces 导出器与内部指标是可配置层，SDK 格式化输出会移除 console exporter，避免污染协议 stdout；
- `cost-tracker.ts` 累计模型级 input/output/cache token、成本、API/工具/墙钟时间和代码变更，并在 Resume 时按 session ID 恢复；
- 优雅退出先冲刷关键会话状态，再执行 SessionEnd Hook，最后在有限预算内冲刷分析与遥测。

### 证据状态

`快照事实，已确认`。主要源码：

- `src/utils/permissions/*`；
- `src/utils/sandbox/sandbox-adapter.ts`；
- `src/services/remoteManagedSettings/*`；
- `src/utils/settings/settings.ts`；
- `src/utils/telemetry/instrumentation.ts`；
- `src/utils/telemetry/sessionTracing.ts`；
- `src/services/api/logging.ts`；
- `src/cost-tracker.ts`；
- `src/utils/gracefulShutdown.ts`。

### 对课程结构的影响

后期不能只有“企业治理总结”。先独立讲 Permission/Sandbox 防御闭环，再讲 policy 和扩展供应链安全，再讲可观测性，最后把 Token/延迟/成本、并发、灰度、回滚和 SLO 集成为生产 Harness。评估与 RAG 指标属于设计迁移，需要明确不是当前快照的全部现成实现。

## 10. 对课程依赖和 Harness 的最终调整

### 10.1 不能按文件夹教学的机制

- 用户输入到模型：跨 `REPL`、`QueryEngine`、`processUserInput`、`query`、API service；
- Tool Use：跨 Tool 定义、调度、Hook、Permission、Sandbox、执行与消息反馈；
- Context：跨 query、compact、context collapse、attachments、memory 与 transcript；
- Resume：跨存储、链重建、消息修复、元数据、成本、工作树、Skill 和 Hook；
- Agent Team：跨 Runtime Task、work-item、mailbox、权限和 shutdown；
- 企业治理：跨 settings policy、Permission、Sandbox、遥测和成本状态。

### 10.2 需要拆分的大闭环

- Context Pipeline 拆为请求视图、轻量裁剪、多级压缩、指令、记忆；
- Tool 扩展栈拆为 Tool、Permission、Hook、Skill、MCP、Plugin 和协作综合；
- Task 拆为 Runtime Task、Work-item Task、Subagent、异步 Agent、Agent Team；
- 持久化拆为 Transcript、Resume、Background Task、Cron；
- 企业治理拆为 Sandbox、安全/policy、可观测性、资源治理、最终生产架构。

### 10.3 Harness 依赖顺序

```text
语言与异步基础
-> 消息契约
-> Query Loop / 模型适配器
-> 流式与 Tool Loop
-> Context 投影与压缩
-> 扩展 ABI 与权限
-> Runtime Task / Work-item
-> Subagent / Agent Team
-> Transcript / Resume / 后台调度
-> Sandbox / Observability / 生产治理
```

不得在消息和取消契约尚未稳定时提前实现多 Agent，也不得在 Runtime Task 与工作项所有权尚未区分时实现 Team 协作。

## 11. 审计结论

Graphify 的主要价值不是“自动生成课程”，而是暴露了多个跨目录中心和同名异义，使课程从文件夹目录转为真实运行依赖。源码核验支持将课程设计为 42 个单元，而不是收敛到少数最小固定点。

本审计确认的核心结构调整：

1. TypeScript/Node 前置扩为四个完整单元，并在后续随用随讲；
2. 标杆章必须同时展示 REPL 与 SDK/Headless 两条输入路径；
3. Context、扩展栈、Task、恢复和治理均需拆成多个闭环；
4. Harness 演进顺序必须服从真实组件依赖；
5. Graphify 不直接增加章节，所有 42 单元都由源码核验后的认知闭环决定。
