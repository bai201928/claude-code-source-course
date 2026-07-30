# M15 作者工作簿：Tool Loop 的调度、权限、结果与下一轮

状态：`release-candidate`

## 单元问题与边界

真实问题不是“怎样注册并调用一个函数”，而是：一个 response 中出现多个 `tool_use` 后，系统怎样在不破坏副作用顺序的前提下尽早执行；怎样让 schema 错误、未知工具、权限拒绝、Hook 阻止、运行异常和用户取消都仍形成配对的 `tool_result`；完成后怎样把结果与更新后的 context 交给下一轮模型。

前置：M10 消息身份与 pairing，M11 纵切，M12 Query 控制权，M13 请求投影，M14 stream assembly、fallback 与 bounded stream。

本单元闭合：

```text
completed tool_use block
-> needsFollowUp
-> streaming/non-streaming scheduler
-> lookup + schema + semantic validation
-> PreToolUse + permission decision
-> tool.call + progress
-> result mapping + PostToolUse/PostToolUseFailure
-> paired user/tool_result
-> updated ToolUseContext
-> next Query iteration
```

本单元不系统展开具体 Tool ABI（后续扩展专题）、完整 Permission 策略矩阵、Hook 配置语法、MCP 生命周期、Sandbox 或 durable idempotency ledger。它只讲主循环必须知道的执行边界。

风险：`R2`。核心风险是并发副作用、取消后 pairing、streaming fallback 已发生副作用，以及并发 context modifier 语义不完整。

## Graphify 候选与直接核验

Graphify 候选中心：`queryLoop()`、`StreamingToolExecutor`、`getMaxToolUseConcurrency()`、`runToolUse()`、`canUseTool`、Permission/Hook 文件。

直接核验：

- 主循环整合点在 `src/query.ts`；
- 两条调度路径分别在 `StreamingToolExecutor.ts` 和 `toolOrchestration.ts`；
- 两条路径共用 `toolExecution.ts -> runToolUse()`；
- Permission UI 不是执行 owner，只是 `canUseTool` 的一种交互适配；
- `isConcurrencySafe()` 是对已解析 input 的动态判断，不等同于固定“只读工具名单”；
- Graphify 邻近的 Sandbox、MCP 配置和 Hook UI 属后续专题，不能写成 M15 主调用链。

## 精简源码地图

| 位置 | 决定性符号/分支 | 意义 |
| --- | --- | --- |
| `src/query.ts` 约 551-568 | `toolUseBlocks`、`needsFollowUp`、gate | 实际 block 是唯一循环信号，stop reason 不可靠 |
| 同上约 826-862 | 收集 block、`addTool()`、`getCompletedResults()` | 完整 block 到达即可能启动与回收工具 |
| 同上约 1011-1051 | stream abort drain | 取消也必须为 queued/in-flight tool 补结果 |
| 同上约 1360-1408 | `getRemainingResults()` / `runTools()` | 两种 scheduler 汇合并更新 context |
| 同上约 1535-1717 | attachments、refresh tools、next state | 结果完成后才构造下一轮，避免普通 user 与 tool_result 交错 |
| `StreamingToolExecutor.ts` | `addTool()` / `processQueue()` | 边流边执行、exclusive barrier、progress 与结果缓冲 |
| 同上 | child/sibling abort、`discard()` | Bash sibling cascade、用户取消、fallback 丢弃语义 |
| `toolOrchestration.ts` | `partitionToolCalls()` | 连续 safe batch + 单个 unsafe batch |
| 同上 | `runToolsConcurrently()` | 并发上限默认 10，结果可按完成推进 |
| `toolExecution.ts` 约 337 | `runToolUse()` | unknown/abort/throw 全部转 paired result |
| 同上约 614-733 | schema + semantic validation | 外部模型输入必须两层验证 |
| 同上约 775-931 | observable clone、PreToolUse、permission | Hook 可修改观察输入/决定权限，call input 有独立边界 |
| 同上约 995-1103 | deny path | 拒绝仍生成 `is_error` tool_result，可能追加 hook meta |
| 同上约 1289-1473 | map result + PostToolUse | 结果只映射一次，user message 携带 pairing 与 context modifier |
| 同上约 1599-1737 | failure path | MCP auth 状态、PostToolUseFailure、error tool_result |

## 真实运行链

1. `queryLoop()` 不信任 `stop_reason === tool_use`，而是在 assistant content 中发现真实 tool block 时设置 `needsFollowUp=true`。
2. streaming gate 开启时，block 在 `content_block_stop` 形成 assistant 后立即交给 `StreamingToolExecutor.addTool()`；关闭时等 response 完成后统一 `runTools()`。
3. scheduler 先查 tool，再对 input 做 schema parse；只有 parse 成功才询问 `isConcurrencySafe(parsedInput)`，任何异常保守视为 unsafe。
4. `runToolUse()` 再执行 tool lookup、schema validation、tool-specific `validateInput()`、PreToolUse hooks、permission resolution、tool call、result mapping、PostToolUse 或 failure hooks。PreToolUse 的 allow 不是无条件放行：deny/ask 规则仍可覆盖或要求进入交互式确认；Hook deny 则直接拒绝。
5. progress 是 ephemeral 可见消息；最终 normal/error/cancel/deny 都形成 `user` role 的 `tool_result(tool_use_id)`。
6. Query Loop yield 结果，同时 normalize 成下一 API request 可用的 user messages；更新后的 `ToolUseContext` 进入下一 state。
7. 所有工具结果完成后才插入 queued attachments，防止普通 user 内容夹在 tool results 中间导致 Provider 协议错误。
8. next state 为 `messagesForQuery + assistantMessages + toolResults`，turn count 增加，再进入下一次模型请求。

## 调度不变量

### 非流式 batch

- consecutive safe calls 合成 batch；unsafe call 单独成 batch并形成屏障；
- safe batch 经 `all(..., maxConcurrency)` 并发，默认上限 10；
- safe batch 的 context modifiers 先按 tool ID 收集，batch 结束后按原始 block 顺序应用；
- unsafe 串行执行并立即更新 current context。

### streaming executor

- `queued -> executing -> completed -> yielded`；
- safe 可与 safe 并发；unsafe 只能在没有任何 executing tool 时启动；遇到不能启动的 unsafe 时停止向后调度；
- safe result 可在更早 safe tool 尚未结束时按完成情况 yield，pairing 依靠 ID 而非位置；
- progress 单独立即 yield，不等待最终 result 顺序；
- streaming 路径当前只对 unsafe tool 应用 context modifier。源码明确说明 concurrent context modifier 尚未支持；教材不得声称两条路径在这一点完全等价。
- Bash sibling-error cascade 和 per-tool `interruptBehavior` 也只存在于 streaming executor；response-complete `runTools()` 使用共享 Query abort，Bash error result 后仍会继续后续 batch。
- deprecated alias fallback 位于 `runToolUse()`；streaming `addTool()` 会先查当前 definitions 并对 unknown 直接造错，因此 gate on/off 对仅存在于 base-tool alias 的旧调用可能不一致。

## 失败、取消与副作用

- unknown tool -> synthetic error result；
- schema/semantic invalid -> error result，不进入 permission/call；
- PreToolUse stop 或 permission deny -> error result，可能附加图片/反馈/hook metadata；
- tool throws -> failure hook 后 error result；
- caller abort -> queued/in-flight tool 必须生成 cancel/reject result；
- `interrupt` 只取消 `interruptBehavior=cancel` 的工具，block 型工具不应收到该 abort；
- streaming 路径中 Bash error 会通过 sibling child controller 取消同组其他 subprocess，但 `sibling_error` 不向父 Query abort 冒泡；Read/WebFetch 等失败不级联；permission-dialog 等非 sibling 原因导致的 per-tool child abort 会由显式 listener 冒泡给 Query controller。response-complete 路径没有 sibling cascade 或 per-tool interrupt 粒度；
- streaming fallback 的 `discard()` 防止旧 ID result 进入新 attempt，但不能撤销已发生副作用（M14 结论）。

## 状态所有权

| 状态 | owner | 修改者 | 观察者 |
| --- | --- | --- | --- |
| tool block list / needsFollowUp | 当前 Query iteration | model event consumer | scheduler / next state |
| queued/executing/completed/yielded | StreamingToolExecutor | executor | Query Loop |
| safe/unsafe classification | scheduler | tool definition over parsed input | queue partition |
| permission decision | permission pipeline | Hook/rule/user/classifier | runToolUse / telemetry |
| in-progress IDs | ToolUseContext/App state bridge | scheduler completion | UI/cancel lifecycle |
| progress | running tool/Hook | callback stream | UI consumer，不进 durable request core |
| tool result pairing | runToolUse | result mapper/error mapper | Query Loop/Provider |
| current ToolUseContext | scheduler | ordered context modifiers | next Query iteration |
| durable side effect | external tool target | tool.call | 不可由 tombstone/discard 回滚 |

## 实验与 Harness 候选

双语言 clean-room scheduler 应验证：

1. safe A、safe B、unsafe C、safe D 的启动/结束屏障；
2. schema invalid 不调用 permission/tool，但产生 paired error；
3. permission deny、throw、cancel 都保持 exactly one result per call id；
4. progress 可先可见，final result 仍配对；
5. 同时验证两条快照路径的不对称：streaming Bash-like fatal policy 取消 siblings，response-complete Bash error 后继续；普通 read failure 不级联；
6. context modifiers 在 batch 边界按原 block 顺序应用；
7. 下一请求只有完整 assistant/tool_result 集合；
8. fallback discard 不执行第二次副作用的 clean-room policy。

Harness 候选：

- merge：显式 `ToolExecutionPlan`、safe batch + exclusive barrier、bounded concurrency、exact pairing、metadata progress、per-call outcome；
- merge（设计迁移）：统一 streaming/non-streaming 都调用同一个 executor core，并显式选择一致的 sibling-error、interrupt、alias 和 context-modifier 策略；当前 Runtime 可先使用 response-complete 触发时点。不得声称这是快照两条路径已有的一致行为；
- defer：真正从 Provider SSE block 完成时启动工具，等待 M14 parser 接入 Runtime；
- defer：durable idempotency ledger、distributed execution、MCP/Hook/Skill 完整 ABI；
- reject：`Promise.all` 无差别并发所有工具；
- reject：错误/拒绝时省略 tool_result；
- reject：用数组位置代替 call ID 配对。

## 事实闸门范围

重点让独立审查者验证：

- streaming 与 non-streaming 两条 scheduler 的真实差异；
- safe/unsafe 与结果顺序；
- Hook/permission/input 修改的先后；
- success/error/cancel 的 pairing；
- Bash sibling abort 是否被过度概括；
- context modifier 的差异与限制；
- next iteration 的消息组合和终止条件。
