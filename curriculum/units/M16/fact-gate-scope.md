# M16 事实闸门范围

## 审查目标

请独立核验当前 Claude Code CLI 源码快照中，一次 Query iteration 如何从长期消息构造当前模型可见的 Context 视图，并回答：

1. `messagesForQuery` 从哪里创建，last compact boundary 怎样选择历史；
2. 单个大 tool result 的持久化/preview 与 API user-message group 的 aggregate budget 是否是两层不同机制，分别发生在什么时点；
3. aggregate budget 如何定义 group，progress、attachment 和相同 Provider response ID 的 assistant fragments 是否形成边界；
4. `ContentReplacementState` 的 owner、跨轮冻结、fork/resume reconstruction 与 Prompt Cache 目的；
5. budget、snip、microcompact、context collapse、autocompact、user context、normalize 和 wire cache edit 的可见调用顺序；
6. cached microcompact 与 time-based microcompact 是否改写 local messages，以及 cache edit 在哪里进入最终请求；
7. 用户轮次附件和 Tool Loop 中途附件分别何时进入消息链，为什么不能与 tool results 任意交错；
8. 字符阈值、token 估算、API-level message group 与最终 wire payload 是否为不同预算/表示单位；
9. shallow copy、orphan result、persist failure、Transcript write、并发 replacement writer 与恢复有哪些已实现保证，哪些只能缩小为边界或设计风险。

只报告会影响教材事实、实验设计或 Harness 契约的实质问题。

## 源码根目录

`D:\agent\Claude code最新\claude-code-CLI`

## 优先路径与符号

- `src/query.ts`：`queryLoop()` 中 `messagesForQuery` 到 `deps.callModel()`，以及 Tool Loop 后附件和 next state；
- `src/utils/messages.ts`：`findLastCompactBoundaryIndex()`、`getMessagesAfterCompactBoundary()`、`normalizeMessagesForAPI()`；
- `src/utils/toolResultStorage.ts`：`processToolResultBlock()`、`enforceToolResultBudget()`、`applyToolResultBudget()`、`ContentReplacementState`、reconstruction；
- `src/services/tools/toolExecution.ts`：tool result block 进入 user message 的位置；
- `src/services/compact/microCompact.ts`：`microcompactMessages()`、cached path、time-based path；
- `src/services/api/claude.ts`：`paramsFromContext()`、`addCacheBreakpoints()`、pending/pinned cache edits；
- `src/services/tokenEstimation.ts`、`src/utils/tokens.ts`：token estimate 与 API usage 基线；
- `src/utils/processUserInput/processUserInput.ts`、`processTextPrompt.ts`、`src/utils/attachments.ts`：附件入口；
- `src/screens/REPL.tsx`、`src/utils/forkedAgent.ts`、`src/utils/swarm/inProcessRunner.ts`、`src/utils/sessionStorage.ts`：replacement state provision/clone/resume/persist。

## 版本与缺失边界

当前快照可能缺少 feature-gated 的 `snipCompact.ts`、`snipProjection.ts`、`cachedMicrocompact.ts`、context-collapse 内部文件及对应测试。若文件缺失，只能确认现存调用接口、注释和上下游行为，不得补造算法或默认 gate。

内部实现以本地快照为最高证据。不要用 Graphify、其他教材、公开新版文档或推断改写快照事实。

## 写入限制

不要修改源码、教材、实验或 Mini Agent Harness。不要读取 M16 `unit-workbook.md`、其他 M16 文件、Graphify 输出或历史审查结论。
