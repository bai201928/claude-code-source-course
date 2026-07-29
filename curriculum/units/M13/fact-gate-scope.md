# M13 事实闸门中性范围

## 审查目标

独立研究当前静态源码快照，重建从 `queryLoop State.messages` 到最终 `anthropic.beta.messages.create({ ...params, stream: true })` 的请求投影链。重点核验 durable/query/API/wire 四层消息视图、compact boundary、tool-result budget、snip/microcompact 接口、user context、`normalizeMessagesForAPI`、tool pairing 与 `BetaMessageStreamParams` 的顺序和所有权。

## 源码根目录

```text
D:\agent\Claude code最新\claude-code-CLI
```

该目录是静态分析快照，可能缺少 feature-gated 模块、类型、测试和构建元数据。不要修改任何文件，不要把它当作可直接构建的官方仓库。

## 需要回答的问题

1. `queryLoop()` 每次迭代如何从 `State.messages` 派生 `messagesForQuery`？哪些步骤按什么顺序改变 view？
2. `getMessagesAfterCompactBoundary()` 是删除历史还是派生范围？为什么包含 boundary，而 boundary 又不会到达 API？
3. `applyToolResultBudget()` 的状态、返回数组、replacement record 与 durable messages 分别由谁拥有？它为何必须在 normalize/microcompact 前运行？
4. snip、microcompact、context collapse 和 autocompact 在当前快照可确认到什么接口与顺序？哪些实现缺失，不能推断？
5. `prependUserContext()` 怎样注入 meta user message？它与 system prompt、durable user input 有何不同？
6. `normalizeMessagesForAPI()` 会过滤、重排、合并或转换哪些代表性消息？assistant fragment、attachment、local command、progress 与 consecutive users 如何处理？
7. `ensureToolResultPairing()` 在 normalize 后做什么？repair 与 strict mode 的差异是什么？
8. `queryModel()` 怎样从 messages 继续构造 tools、system 和 `BetaMessageStreamParams`？`addCacheBreakpoints()` 与 `stream: true` 位于何处？
9. 哪些操作只改变当前 request，哪些会 yield/write durable or transcript state？
10. 当前快照缺失什么，使哪些默认 gate、类型或算法不能确认？

## 建议优先阅读

- `src/query.ts`：`queryLoop()` 迭代入口、projection 顺序、`deps.callModel()`
- `src/utils/messages.ts`：`getMessagesAfterCompactBoundary()`、`normalizeMessagesForAPI()`、`ensureToolResultPairing()`
- `src/utils/toolResultStorage.ts`：`ContentReplacementState`、`applyToolResultBudget()`
- `src/utils/api.ts`：`prependUserContext()` / `appendSystemContext()`
- `src/services/compact/microCompact.ts`：`MicrocompactResult` / `microcompactMessages()`
- `src/services/compact/compact.ts`：`buildPostCompactMessages()`
- `src/services/api/claude.ts`：`queryModel()`、`paramsFromContext()`、`messages.create()`

## 输出限制

- 不读取 Graphify 输出，不评价教学风格，不生成教材。
- 不扩散到 M14 的流事件组装、重试算法和成本统计，也不完整审查 M16-M18 的 Context 内部实现。
- 只报告影响请求合法性、状态所有权、投影顺序、实验或 Harness 契约的实质问题。
- 每个结论给出路径、符号和决定性分支；行号只作辅助。
- 区分直接源码确认、语言/API 类型语义、推断和无法确认项。

