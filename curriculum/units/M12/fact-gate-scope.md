# M12 事实闸门中性范围

## 审查目标

独立研究当前静态源码快照，回答 `query()` / `queryLoop()` 的异步生成器控制流怎样被 REPL 与 QueryEngine 消费，模型流与工具流怎样嵌套进入主循环，循环状态怎样跨迭代演进，以及正常完成、取消、错误和消费者提前退出如何产生不同结果。

请独立核验，不预设实现是递归还是迭代，不预设 Query Loop 是否拥有 durable conversation，也不预设 `for await` 能否取得 generator return value。

## 源码根目录

```text
D:\agent\Claude code最新\claude-code-CLI
```

该目录是从发布包 source map 得到的静态分析快照，可能缺少类型文件、原始构建元数据和测试。不要把它当作可直接构建的官方仓库，也不要修改其中任何文件。

## 需要回答的问题

1. `query()` 与 `queryLoop()` 当前各自承担什么职责？`yield*` 在普通产出、正常 return、throw 和外部 `.return()` 时怎样影响包装器后续代码？
2. 当前 `queryLoop()` 是真实递归、尾递归，还是 `while` 驱动的显式状态机？哪些旧注释或 checkpoint 名称可能造成误读？
3. REPL 与 QueryEngine 分别如何消费 `query()`？谁调用 `.next()`（由何种语法隐式完成），谁处理 yielded value，是否读取最终 generator return value？
4. 模型 async iterable、Query Loop 和入口 consumer 之间的 pull/yield 接力是什么？工具更新又怎样嵌套进入同一控制流？
5. `queryLoop` 的 `State.messages`、`messagesForQuery`、`assistantMessages`、`toolResults` 与外层 REPL/QueryEngine 持久消息分别由谁拥有、在何时修改？
6. 选择至少两个 `yield` 点，检查 producer 在 `yield` 前后分别做什么。消费者在该事件后提前退出时，哪些后续 bookkeeping 不会发生？
7. 哪些条件导致 `state = next; continue`，哪些条件直接 `return`？请给出代表性 Continue/Terminal 原因，但不要在缺少类型定义时冒充完整穷举。
8. streaming 取消与 tool 阶段取消分别怎样收敛？`abort` 是否意味着不会再 yield 任何事件？
9. QueryEngine 或 REPL 消费者自身提前 `return`、`break` 或抛错时，generator close 与业务 terminal 是否相同？
10. 当前快照缺少哪些文件或测试，使哪些类型、清理或运行时结论无法确认？

## 建议优先阅读

- `src/query.ts`：`query`、`queryLoop`、State、所有 `yield`/`continue`/`return` 点
- `src/query/deps.ts`
- `src/screens/REPL.tsx`：`onQueryEvent`、`onQueryImpl`、`onQuery`
- `src/QueryEngine.ts`：`submitMessage()` 对 `query()` 的消费、消息 switch 与 result 生成
- `src/utils/generators.ts`
- `src/utils/stream.ts`
- `src/services/tools/toolOrchestration.ts`
- `src/services/tools/StreamingToolExecutor.ts`
- `src/services/api/claude.ts`：只核验 `callModel` 返回的 async iterable 边界，不扩散到 M14 的协议细节

## 输出限制

- 不读取 Graphify 输出，不使用 Graphify 作为证据。
- 不修改任何正式文件或源码。
- 只报告会影响控制流、状态所有权、取消/结束语义、实验设计或 Harness 契约的问题。
- 每个事实给出源码路径、真实符号和决定性分支；行号仅辅助。
- 区分直接源码确认、JavaScript/TypeScript 语言语义、合理推断和无法确认。
- 不评价教学风格，不生成教材。

