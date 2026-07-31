# S0-S3 源码符号地图

状态：`S3 已发布`

行号只作当前快照辅助，稳定定位采用“路径 -> 符号 -> 决定性分支”。

| 单元 | 路径与符号 | 决定性语义 |
| --- | --- | --- |
| M01 | `src/Task.ts` -> `TaskStatus` / `isTerminalTaskStatus()` | 值域与终态分类不等于状态机 |
| M01 | `src/utils/tasks.ts` -> `TaskStatusSchema` / `getTask()` | Work-item Task 是另一领域；旧状态迁移受环境守卫 |
| M01 | `src/Tool.ts` -> `Tool<Input,Output,P>` / `buildTool()` | 泛型关联、schema runtime、最终类型断言信任点 |
| M01 | `src/utils/messages.ts` / `src/components/Message.tsx` | 从 producer、guard、consumer 重建可见消息边界 |
| M02 | `src/query.ts` -> `query()` / `queryLoop()` | `yield*` 委托、正常终值与 early close |
| M02 | `src/QueryEngine.ts` -> `submitMessage()` | `for await` 边消费边修改状态/Transcript/usage |
| M02 | `src/services/api/claude.ts` -> 非流/流请求 | 手动 next 与模型事件流 |
| M02 | `src/services/tools/StreamingToolExecutor.ts` | Tool progress、缓存结果与 race |
| M02 | `src/utils/stream.ts` -> `Stream<T>` | push queue 适配 AsyncIterable，不保证无缓冲 |
| M03 | `src/tools/BashTool/BashTool.tsx` -> `BashTool.call` / `runShellCommand()` | 手动 generator 消费、progress/result race、background |
| M03 | `src/utils/Shell.ts` -> `exec()` | pre-abort、file/pipe mode、spawn 与 cwd reaction |
| M03 | `src/utils/ShellCommand.ts` -> `ShellCommandImpl` | timeout/abort/kill/background/exit/result/cleanup owner |
| M03 | `src/utils/abortController.ts` / `combinedAbortSignal.ts` | child reason 传播与 combined reason 丢失边界 |
| M03 | `src/utils/cleanupRegistry.ts` / `gracefulShutdown.ts` | 并行 cleanup、分段预算与 failsafe |
| M04 | `src/QueryEngine.ts` -> `ask()` | SDK/Headless 构造、yield 委托与 read-file state handoff |
| M04 | `src/QueryEngine.ts` -> `wrappedCanUseTool` | 调用注入 policy，Tool 只是实参；Graph inferred edge 被否定 |
| M04 | `src/QueryEngine.ts` -> `processUserInput` / `shouldQuery` | 输入先修改状态，本地分支可跳过 Query |
| M04 | `src/QueryEngine.ts` -> `for await query(...)` / event switch | 条件调用、turn view 与按事件类型的 owner mutation |
| M05 | `src/main.tsx` -> Interactive/Headless root branches | 同一产品的表面选择、React root 与独立 headless store |
| M05 | `src/cli/print.ts` -> `runHeadless` / StructuredIO | text/JSON/stream-json 是适配投影，不改 Core event |
| M05 | `src/screens/REPL.tsx` -> submit/exit boundaries | Interactive 拥有 UI 输入、消息体验与按键生命周期 |
| M06 | `src/utils/settings/settings.ts` -> source selection/merge/cache | 来源顺序、provider 与 effective settings 边界 |
| M06 | `src/utils/settings/applySettingsChange.ts` | cache reset 后向 AppState 发布，不承诺所有消费者原子切换 |
| M06 | `src/utils/managedEnv.ts` | trust 前后 environment projection 不同 |
| M07 | `src/bootstrap/state.ts` -> module `STATE` | 进程早期一次性 owner，不是 AppState store |
| M07 | `src/state/AppStateStore.ts` -> `createStore/getState/setState` | current root、observer/subscriber 顺序和 identity no-op |
| M07 | `src/state/AppState.tsx` -> `AppStateProvider` | Provider 保存 store 实例；同进程可有多个 root/store |
| M08 | `src/commands.ts` / Skill/Agent loaders | 发现来源和不同消费者的同名解析并非统一全局规则 |
| M08 | `src/tools.ts` -> `getTools/assembleToolPool` | 环境候选、deny/enable、MCP 合并与本地 runtime pool |
| M08 | `src/query.ts` -> `refreshTools` boundary | Interactive 在 tool result 后、下一模型迭代前刷新 |
| M08 | `src/cli/print.ts` / `src/QueryEngine.ts` | Headless 下一 command 重建，单 submit 通常保持传入 tools |
| M08 | `src/services/api/claude.ts` -> Tool Search/schema projection | runtime pool 经 deferred/discovered 投影才成为 API schemas |
| M09 | `src/utils/gracefulShutdown.ts` -> setup/sync/async/forceExit | signal 入口、first owner、阶段预算与最终退出 |
| M09 | `src/utils/cleanupRegistry.ts` -> register/run | Set + Promise.all 并发、fail-fast、无 phase/priority |
| M09 | `src/screens/REPL.tsx` -> `onCancel` / resume path | turn cancellation 与 logical SessionEnd 是不同边界 |
| M09 | `src/commands/clear/conversation.ts` / exit flow | clear/resume/process exit 的 reason、AppState 与存活差异 |
| M09 | `src/utils/sessionStorage.ts` -> `getProject/Project.flush` | Transcript 惰性注册、drain 和 stopping 后 remote suppression |
| M10 | `src/screens/REPL.tsx` -> `messagesRef` / wrapped `setMessages` | REPL 同步 owner 与 React render projection 分开 |
| M10 | `src/cli/print.ts` / `src/QueryEngine.ts` -> `mutableMessages` / `submitMessage()` | Headless alias、push、rebind 与 turn shallow view |
| M10 | `src/utils/messages.ts` -> message creators / `ensureToolResultPairing()` | 多类 identity、human/tool result 分类与 repair/strict pairing |
| M10 | `src/utils/sessionStorage.ts` -> chain build / parallel result recovery | Transcript parent DAG、legacy progress bridge 与 sibling 恢复 |
| M11 | `src/screens/REPL.tsx` / `src/cli/print.ts` / `src/QueryEngine.ts` | REPL 与 Headless 两条输入路径在 `query()` 汇合 |
| M11 | `src/query.ts` -> `query()` / `queryLoop()` | 会话输入成为 Query state，并由 tool result 推进下一模型请求 |
| M12 | `src/query.ts` -> QueryDeps / while transitions / yielded events | Query owner、模型依赖注入、显式循环与提交顺序 |
| M12 | `src/QueryEngine.ts` -> `submitMessage()` / event switch | `for await` 消费、early return 与 terminal 不可见边界 |
| M12 | `src/utils/stream.ts` / Hook generator paths | callback queue、generator close 与过程/终值分层 |
| M13 | `src/query.ts` -> history boundary / `messagesForQuery` | durable/query 请求视图和 compact boundary |
| M13 | `src/utils/messages.ts` -> tool result budget / `normalizeMessagesForAPI()` | per-group budget、外置 replacement、过滤/合并/repair |
| M13 | `src/services/api/claude.ts` -> `queryModel()` / `paramsFromContext()` | API messages 到 system/tools/model/thinking/wire params |
| M14 | `src/services/api/claude.ts` -> `queryModelWithStreaming()` / `queryModel()` | indexed assembly、assistant-before-terminal、late finalize、fallback 与 cleanup |
| M14 | `src/services/api/withRetry.ts` -> `withRetry()` | stream 创建前 attempt、retry notice 与 model fallback signal |
| M14 | `src/query.ts` -> fallback handling | partial attempt 收敛与真正的 model switch owner |
| M15 | `src/query.ts` -> `needsFollowUp` / streaming gate / next state | tool-use 驱动继续、两条执行入口、results 后 attachments |
| M15 | `src/services/tools/StreamingToolExecutor.ts` -> `addTool()` / `processQueue()` / `discard()` | parse 后安全分类、safe/unsafe 屏障、child abort 与非 rollback discard |
| M15 | `src/services/tools/toolOrchestration.ts` -> `partitionToolCalls()` / `runTools()` | response-complete safe batch、并发上限与 ordered modifiers |
| M15 | `src/services/tools/toolExecution.ts` -> `runToolUse()` | schema、Hook、Permission、call、alias fallback 与 paired error result |
| M16 | `src/query.ts` -> `messagesForQuery` / aggregate budget / snip / microcompact | 轻量 Context 管线、预算单位与稳定 replacement state |
| M16 | `src/utils/messages.ts` / `src/services/api/claude.ts` | normalization、temporary userContext 与 wire cache edit |
| M17 | `src/services/compact/` / `query.ts` -> auto/traditional compact | threshold、summary fork、hook、boundary、fallback 与 Query continuation |
| M17 | `src/utils/sessionStorage.ts` -> enqueue/append/flush/relink | Transcript 完成点、logical parent 与 resume-visible chain |
| M18 | `src/utils/claudemd.ts` -> `getMemoryFiles()` / `processMemoryFile()` | instruction discovery、include、Rules、trust、scope 与 cache |
| M18 | `src/context.ts` / `queryContext.ts` / `attachments.ts` | userContext、system prompt、nested/dynamic attachment 与 request visibility |
| M19 | `src/services/SessionMemory/` / `services/compact/sessionMemoryCompact.ts` | session summary extraction、safe boundary、SM-first compact 与 fallback |
| M19 | `src/services/extractMemories/` / `src/memdir/` | Auto Memory topic/index、best-effort extraction 与 relevance attachment |
| M19 | `src/services/autoDream/` | time/session/lock gates 与跨 session consolidation |

已知快照边界：`src/types/message.ts`、`src/types/utils.ts`、`src/types/tools.ts` 与 `src/query/transitions.ts` 缺失，不能声称原项目完整 typecheck，也不能从 import 名称补造完整类型声明。
