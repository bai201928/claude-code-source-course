# M10 事实闸门与 Codex 裁决

状态：`fact-reviewed`

FACT_A/B 会话：`dfd66a6b-0241-42e3-9329-0a8b58628ef0`

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 7
```

独立盲审正确确认了：

- REPL `messagesRef` 与 Headless `mutableMessages` 的 owner差异；
- Headless engine字段重绑定会脱离外部数组别名；
- spread只有浅快照，streaming层会在 yield 后原地补写 assistant usage/stop reason；
- envelope UUID、provider message ID、tool-use ID、transcript parent和 SDK session/tool parent不能混用；
- `isHumanTurn` 会漏判 `toolUseResult === undefined` 但 content含 tool_result的 subagent结果；
- progress实际被 transcript filter排除，邻近注释已经落后；
- 并行 tool result使 transcript成为需要补偿恢复的 DAG。

FACT_A 同时存在三类需裁决内容：把 attachment误写为永不进入 API；把显式 `getToolUseContext(messages, ...)` 参数误读为 React state旧闭包；把建议验证的 recovery/source-field边界升级成 material issue。

## Codex 裁决

### M10-F01

Issue：`isHumanTurn` 不是所有历史形状上的完备 human-input classifier。

Decision：`accepted`

Reason：`messagePredicates.ts` 只检查 `toolUseResult === undefined`；`attachments.ts:hasToolResultContent` 的注释和结构检查明确覆盖 subagent保留 tool_result content但丢弃本地 result payload的场景。

Change：教材把它定位为局部 helper而非领域真理；Harness使用显式 `kind: human | tool-result` 和结构校验。

### M10-F02

Issue：progress 的“已记录去重”注释与当前 transcript执行链冲突。

Decision：`accepted`

Reason：`recordTranscript -> cleanMessagesForLogging -> isLoggableMessage` 过滤 progress，loader 的 `isTranscriptMessage` 也排除当前 progress；legacy loader bridge只兼容旧 JSONL。

Change：正文以 filter/load链为事实，并讲清内存、SDK、API、durable四个平面。

### M10-F03

Issue：Headless `setMessages(fn)` 返回新数组后，engine字段与 `print.ts` owner数组分叉。

Decision：`accepted`，但只作为条件式所有权边界。

Reason：静态引用分叉可确认，`ask()` finally没有回写 messages；但当前快照缺失 feature-gated `commands/force-snip`，不能证明一个普通可达 Headless流程必然触发历史丢失。

Change：教材不宣称已验证产品 bug；Harness用单 owner + revisioned API消除隐式别名契约。

### M10-F04

Issue：REPL `getToolUseContext` 使用陈旧 React state。

Decision：`rebutted`

Reason：函数第一形参就是 `messages`，遮蔽外层 state；`onQueryImpl` 显式传入 `messagesIncludingNewMessages`。

Change：无。

### M10-F05

Issue：attachment 永不进入 provider API。

Decision：`rebutted`

Reason：`normalizeMessagesForAPI()` 的 attachment分支调用 `normalizeAttachmentForAPI()`，把 attachment投影成 user messages并合并。它不是以 AttachmentMessage envelope原样发送。

Change：正文区分“内部 attachment envelope”和“API user-message projection”。

### M10-F06

Issue：并行恢复依赖 `message.id`，因此 fork/synthetic必然丢消息。

Decision：`rebutted as a demonstrated defect`，保留为设计边界。

Reason：恢复代码确实按 response ID分组，但 FACT_A 没有给出 fork丢失该字段的路径或失败实验；synthetic assistant creator也生成 ID。

Change：正文只解释当前 DAG补偿算法及其依赖，不扩写未经验证的 fork故障。

### M10-F07

Issue：主要 tool result路径可能不设置 `sourceToolAssistantUUID`。

Decision：`rebutted as material`

Reason：定向搜索 `query.ts`、`StreamingToolExecutor.ts` 与 `toolExecution.ts` 的主要 result路径均显式设置；持久化顺序 parent fallback是兼容边界。

Change：Harness要求显式 parent概念，但不把当前快照描述成普遍漏写。

### M10-F08

Issue：缺失 `src/types/message.ts` 与 generated SDK types。

Decision：`accepted as evidence boundary`

Reason：无法通过现有快照恢复完整 type union。

Change：教材只列从 creator/switch/guard/schema可确认的形状，明确不声称类型全集。

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同会话复核确认 Codex 对 attachment、`getToolUseContext`、source field和缺失类型边界的裁决成立；`ConversationStore` 的单 owner、revision、深冻结、domain kind、ephemeral分离和 fail-closed pairing候选契约与快照事实无冲突。
