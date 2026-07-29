# M11 事实闸门中性范围

## 审查目标

独立研究当前静态源码快照，回答一次普通文本输入如何从交互式 REPL 与 SDK/Headless 两类入口进入 Agent 主循环、形成真实模型请求，并在模型返回工具调用后把工具结果带入下一次模型请求。

请独立核验，不预设两条入口是否共享同一适配器或同一消息所有者。

## 源码根目录

```text
D:\agent\Claude code最新\claude-code-CLI
```

该目录是从发布包 source map 得到的静态分析快照，可能缺少编译期被擦除的类型文件、原始构建元数据和测试。不要把它当作可直接构建的官方仓库，也不要修改其中任何文件。

## 需要回答的问题

1. REPL 普通文本提交从 UI 回调到 `query()` 的真实调用路径是什么？主会话消息由哪个对象或容器直接拥有，何时写入，何时读取当前值？
2. Headless/SDK 输入怎样经过 `print.ts`、`ask()` 与 `QueryEngine.submitMessage()`？跨调用消息连续性由谁维持？
3. 两条路径在哪里真正汇合？REPL 是否实际实例化或调用 `QueryEngine`？
4. 原始输入在何处成为内部 user message？附件与 hook 额外上下文在什么边界加入？
5. 会话历史、当前循环消息、请求投影视图与 API `messages` 参数是否是同一个数组或同一语义对象？分别在哪里派生或正规化？
6. `query()` 到真实流式网络请求的生产调用链是什么？依赖注入点在哪里？
7. assistant `tool_use` 怎样触发工具执行？成功、拒绝、取消或失败如何生成配对的 `tool_result`？何处组装下一轮模型请求？
8. 选择一个模型流取消路径和一个工具执行失败路径，说明怎样避免留下不配对的工具消息或错误继续下一轮。
9. 哪些结论因快照缺少测试、构建元数据或类型源文件而无法确认？

## 建议优先阅读

- `src/screens/REPL.tsx`：`messages`、`messagesRef`、`setMessages`、`onQuery`、`onQueryImpl`
- `src/utils/handlePromptSubmit.ts`：`handlePromptSubmit`、`executeUserInput`
- `src/utils/processUserInput/processUserInput.ts`
- `src/utils/processUserInput/processTextPrompt.ts`
- `src/cli/print.ts`：共享 `mutableMessages` 与 `ask()` 调用
- `src/QueryEngine.ts`：`QueryEngine`、`submitMessage`、`ask`
- `src/query.ts`：`query`、`queryLoop`、请求视图、模型消费、工具结果和 next state
- `src/query/deps.ts`
- `src/services/api/claude.ts`：`queryModelWithStreaming`、`queryModel`、正规化、参数构造和 `messages.create`
- `src/utils/messages.ts`：`createUserMessage`、`normalizeMessagesForAPI`
- `src/services/tools/toolOrchestration.ts`
- `src/services/tools/toolExecution.ts`
- `src/services/tools/StreamingToolExecutor.ts`

## 输出限制

- 不读取 Graphify 输出，不使用 Graphify 作为证据。
- 不修改任何正式文件或源码。
- 只报告会影响调用链、状态所有权、请求投影、Tool Loop、取消或教材核心表述的问题。
- 每个事实给出文件、真实符号和决定性分支；行号仅辅助。
- 区分直接源码确认、合理推断和无法确认，不要用仓库外记忆补齐缺失文件。
- 不评价教学风格，不生成教材。

