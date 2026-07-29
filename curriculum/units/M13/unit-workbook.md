# M13 研究工作簿

状态：`release-candidate`

本文件是作者工作区，不是教材正文。Graphify 只用于候选定位；所有标为“快照事实”的结论均已回到 `claude-code-CLI/` 直接核验。

## 1. 单元问题、边界与风险

核心问题：为什么一条消息存在于 durable conversation，并不意味着它会原样出现在当前模型请求里？一次请求要经过哪些选择、替换、正规化、配对修复和参数装配，才能成为 Provider 能接受的 payload？

前置：M10 的消息 owner、身份与配对；M11 的端到端纵切；M12 的 Query 状态机和 producer-local state。

本单元闭合：

```text
queryLoop State.messages
-> compact boundary 后的浅请求视图
-> tool-result budget / snip / microcompact / compact view
-> prependUserContext
-> queryModel
-> normalizeMessagesForAPI
-> ensureToolResultPairing
-> BetaMessageStreamParams
-> messages.create({ ...params, stream: true })
```

本单元不深入 M14 的 SSE 组装、重试和 usage，也不替代 M16-M18 对 Context、snip、microcompact、autocompact 与 collapse 的完整专题。它只解释这些机制在请求投影链中的接口、顺序和所有权影响。

风险：`R2`。投影顺序会影响请求合法性、Prompt Cache 稳定性、工具配对和 durable history；错误实现可能把一次请求的裁剪永久写回会话，或把 UI/进度/边界消息发送给 Provider。

## 2. Graphify 候选与准确性边界

图谱候选：

- `src/query.ts` -> `queryLoop()`；
- `src/utils/messages.ts` -> `getMessagesAfterCompactBoundary()` / `normalizeMessagesForAPI()` / `ensureToolResultPairing()`；
- `src/utils/toolResultStorage.ts` -> `applyToolResultBudget()`；
- `src/services/compact/microCompact.ts` -> `microcompactMessages()`；
- `src/services/api/claude.ts` -> `queryModel()` / `paramsFromContext()`。

Graphify 正确给出 `queryLoop -> normalizeMessagesForAPI`、`queryLoop -> getMessagesAfterCompactBoundary`、`queryLoop -> applyToolResultBudget` 的 `EXTRACTED` 调用边。它给出的 `query() -> query.ts -> normalizeMessagesForAPI()` 最短路径只包含 `contains + imports`，不是运行调用链，已丢弃。

证据状态：Graphify 仅决定阅读顺序，不进入事实闸门或教材证据。

## 3. 请求投影的真实顺序

`src/query.ts -> queryLoop()` 每次迭代从 `state.messages` 开始：

1. `messagesForQuery = [...getMessagesAfterCompactBoundary(messages)]`；
2. `applyToolResultBudget()`；
3. feature-gated `snipCompactIfNeeded()`；
4. `deps.microcompact()`；
5. feature-gated context-collapse read projection；
6. `deps.autocompact()`，成功时用 `buildPostCompactMessages()` 替换本轮 view；
7. `prependUserContext(messagesForQuery, userContext)`；
8. `deps.callModel(...)`。

决定性源码：`src/query.ts:365-535`、`659-704`。

该顺序表明 `messagesForQuery` 是 producer-local 派生视图，不是 durable owner。数组 spread 只分离容器，元素仍共享引用；后续组件需要在修改内容时创建新 message/block，不能依赖深不可变。

## 4. Compact boundary 选择的是可见历史

`src/utils/messages.ts -> getMessagesAfterCompactBoundary()`：

- 反向寻找最后一个 `system/compact_boundary`；
- 找不到时返回全部；
- 找到时 `slice(boundaryIndex)`，包含 boundary；
- HISTORY_SNIP 开启时再调用缺失快照模块 `projectSnippedView()`；
- boundary 本身随后被 `normalizeMessagesForAPI()` 过滤。

这不是删除 durable conversation 的通用函数，而是为 model-facing path 派生范围。当前快照缺少 `snipCompact.ts` 与 `snipProjection.ts`，只能确认调用接口和顺序，不能补造内部算法。

## 5. Tool Result Budget 是投影替换，不是简单截断

`src/utils/toolResultStorage.ts -> applyToolResultBudget()` / `enforceToolResultBudget()`：

- 在 microcompact 之前执行；
- 按 API 层合并后的 user-message group 估算 aggregate tool-result budget；
- 选择 fresh result，持久化大内容并在请求 view 中替换成 preview；
- `ContentReplacementState` 以 `tool_use_id` 冻结选择，保证后续请求 byte-stable；
- 可选把 replacement record 写入可恢复 transcript；
- 没有替换时允许返回原数组实例，替换时创建新 message/block；
- 状态 owner 与 durable conversation membership owner 不相同。

完整预算算法、阈值和持久化策略留给 M17。本单元只保留“请求替换必须可重复、可审计、不能悄悄损坏原历史”的契约。

## 6. User context 是请求时前置消息

`src/utils/api.ts -> prependUserContext()`：

- test 环境或空 context 时直接返回原数组；
- 否则创建 `isMeta: true` 的 user message，并放在当前 view 最前面；
- 不写回传入数组；
- system context 走 `appendSystemContext()`，是另一条参数通道。

因此“用户上下文”不是 durable human prompt，也不是 system prompt 的别名。它在下一步正规化时可能与相邻 user message 合并。

## 7. `normalizeMessagesForAPI` 是协议编译器

`src/utils/messages.ts -> normalizeMessagesForAPI()` 的核心职责：

- attachment 先重排，virtual message 永不进入 API；
- progress、普通 system、synthetic API error 被过滤；local command system 被转换为 user；
- consecutive user message 合并，并把 tool_result 提升到 user content 前部；
- assistant fragment 按 provider message ID 合并，tool input 和名称正规化；
- attachment 转为一个或多个 user message，而非以 attachment envelope 原样发送；
- 清理不合法 thinking/whitespace/media/tool-reference 组合并验证图片。

正规化不是序列化同义词。它会过滤、重排、合并、转换和校验，所以输出成员、role 和 content block 均可能不同于输入。

## 8. 配对合法化有 repair 与 strict 两种语义

`src/services/api/claude.ts -> queryModel()` 在正规化之后调用 `ensureToolResultPairing()`：

- 缺失 tool_result 时可插入 synthetic error result；
- orphan/duplicate tool_result 被移除；
- duplicate tool_use ID 被去重；
- server-side tool use 没有同消息 result 时被移除；
- strict mode 发现任何 repair 时抛错。

Claude Code 的默认 repair 主要服务 resume/teleport 兼容；它不证明 synthetic content 等同于真实工具结果。累计 Harness 继续选择 strict fail-closed，不复制兼容修复。

## 9. Provider payload 还有独立参数装配

`src/services/api/claude.ts -> queryModel()`：

1. 根据当前模型和能力过滤 tools 并构造 schemas；
2. 得到 `messagesForAPI` 后执行模型相关清理、配对、advisor/media 处理；
3. system prompt 单独构造成 cache-aware blocks；
4. `paramsFromContext(retryContext)` 组装 model、messages、system、tools、tool_choice、betas、metadata、max_tokens、thinking、temperature、context_management、output_config 与 speed；
5. `anthropic.beta.messages.create({ ...params, stream: true }, { signal, headers })` 才是传输调用。

`addCacheBreakpoints()` 发生在 params 构造时，所以 `messagesForAPI` 仍不是最终 wire messages。M14 再解释 retry context、stream 和响应组装。

## 10. 证据与缺失边界

- `快照事实`：上述路径、调用顺序、过滤/合并/repair 和参数构造来自直接源码。
- `运行验证`：M13 双语言 clean-room 实验只验证投影契约，不代表运行了 Claude Code。
- `设计迁移`：Harness 的 strict pairing、projection report 和有限 preview 是课程方案。
- `无法确认`：缺失 `src/services/compact/snipCompact.ts`、`snipProjection.ts`、部分 context-collapse 模块和原始测试，因此不声称 feature gate 默认值或完整算法。

## 11. 实验假设与反证条件

实验契约：

- 最新 compact boundary 之前的消息不进入 request，但 source 不变；
- boundary/progress envelope 不进入 API；attachment/local system 转成 user；
- user context 只存在于 request view；
- over-budget tool result 在 request 中变成 deterministic preview，durable output 保持全文；
- strict pairing 拒绝 missing/orphan/duplicate；repair 可以合成/移除并报告；
- 最终 params 在所有正规化后冻结。

反证条件：

1. projection 改变 source 数组或嵌套内容；
2. boundary 之前内容仍进入 payload；
3. preview 每次变化，破坏请求前缀稳定性；
4. repair 后仍有 unresolved/orphan pair；
5. Provider adapter 收到未正规化的领域 envelope。

## 12. Harness 候选契约

事实闸门和实验后的裁决：

- `merge`：`RequestProjectionPolicy`、`RequestProjectionReport`、history start、ephemeral user context、有限 tool-result preview、strict request validation；
- `merge`：Runtime Trace 只记录 source/projected count、replacement count 和 context-injected boolean，不记录内容；
- `defer`：真实 compact transaction、外置大结果存储、snip/collapse、Prompt Cache edit 和 resumable replacement record 到 H3/M16-M18；
- `reject`：在 `ConversationStore` 内原地截断 tool result，或在 Provider adapter 临时修补却不返回审计报告。

双语言实验修订后为 TypeScript `9/9`、strict typecheck 通过、Python `8/8`；FACT_B 同会话复审为 `PASS / 0`。累计 Harness 合入已通过 TypeScript Agent `23/23` 与 Python Agent `12/12` 的首轮验证。
