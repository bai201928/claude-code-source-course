# FACT_B 同会话对照提示词

继续刚才的 FACT_A 会话。现在请把你在阶段 A 独立得到的结论，与下面 Codex 的机制摘要和实验设计逐项对照。不要重新扩散阅读整个源码树；只有发现明确冲突时，才回到相关路径和符号定向核验。

## Codex 机制摘要

### 两条输入路径

```text
REPL
-> REPL.onSubmit
-> handlePromptSubmit
-> executeUserInput
-> processUserInput / processTextPrompt
-> onQuery 先把 newMessages 追加到本地 messages/messagesRef
-> onQueryImpl
-> query()

Headless / SDK
-> print.ts 跨调用共享 mutableMessages
-> ask() 每次创建 QueryEngine(initialMessages: mutableMessages)
-> QueryEngine.submitMessage
-> processUserInput
-> engine 内部数组 push 新消息
-> messages = [...mutableMessages] 当前查询浅快照
-> query()
```

Codex 结论：REPL 当前不经过 `QueryEngine`。REPL 的主会话消息由 `REPL.tsx` 本地 React `messages` 与同步 `messagesRef` 直接维护；AppState 主要提供权限、工具、任务等运行状态。Headless 的跨 `ask()` 连续性由 `print.ts` 共享数组维持，单次调用由 QueryEngine 管理。两条路径在 `query()` 汇合。

### 汇合后的模型请求

```text
query()
-> queryLoop()
-> 从 state.messages 派生 messagesForQuery
-> 边界、预算与压缩等请求视图处理
-> deps.callModel(...)
-> productionDeps().callModel = queryModelWithStreaming
-> queryModel()
-> normalizeMessagesForAPI / ensureToolResultPairing
-> paramsFromContext
-> anthropic.beta.messages.create({ ...params, stream: true })
```

Codex 结论：会话历史、`queryLoop` 的 `state.messages`、每轮 `messagesForQuery`、`queryModel` 的 `messagesForAPI` 和最终 API `params.messages` 是相互关联但职责不同的层次，不能统称为 `mutableMessages`，也不能声称会话数组被原样发送给模型。

### Tool Loop

Codex 结论：流中出现 assistant `tool_use` 后，Query Loop 收集 tool block 并设置需要后续轮次；工具通过 `StreamingToolExecutor` 或 `runTools -> runToolUse` 执行。工具成功、拒绝、取消和失败都被编码为内部 user message 中与 `tool_use.id` 配对的 `tool_result`。`query.ts` 收集正规化后的 `toolResults`，再以 `messagesForQuery + assistantMessages + toolResults` 建立 next state，while 循环发起第二次模型请求。

### 取消和失败

Codex 结论：入口的 `AbortSignal` 向模型流和工具执行传播。流阶段取消会消费剩余 streaming tool updates 或补齐缺失工具结果，随后以 `aborted_streaming` 结束；工具阶段取消会形成取消结果并以 `aborted_tools` 结束。模型运行异常若已暴露 `tool_use`，会补合成结果，避免后续历史出现孤立工具调用。

## 拟写入教材的关键表述

1. “REPL 与 Headless 共享的是 `query()` 之后的 Agent 主循环，不共享当前输入适配器或会话消息容器。”
2. “`processUserInput` 的产物先成为内部用户消息；会话历史随后被投影成当前请求视图，直到 `queryModel` 才正规化为 API messages。”
3. “工具结果不是旁路回调值，而是重新进入对话协议的 user/tool_result 消息，因此模型的第二次请求能看见它。”
4. “浅拷贝快照隔离的是数组结构，不自动深冻结每个 Message 对象；不要把它描述成深不可变快照。”
5. “AppState 参与运行上下文，但不是 REPL 主会话消息数组的直接所有者。”

## 实验设计

使用独立 clean-room TypeScript 与 Python 实现，不运行静态快照，不调用真实模型：

- `SessionStore` 唯一拥有可变消息；入口只追加领域消息。
- `RequestProjector` 每轮复制消息并记录 `model.request` 观察点。
- scripted fake model 第一次返回一个 `tool_use(id=call-1)`，第二次只有在看到匹配 `tool_result` 时返回最终文本。
- fake tool 返回确定值；另一个场景抛错，验证错误仍成为配对 `tool_result`。
- 取消场景在模型或工具阶段触发 signal，断言不会发生取消后的新工具成功或下一轮请求。
- 反证条件包括：第二次请求缺少配对结果、无工具响应仍重复请求、入口后续突变污染已投影请求、取消后继续运行。

## 审查要求

只检查：事实错误、重要遗漏、证据不足、层次混淆、版本/快照边界混淆，以及实验不能验证正文结论的问题。普通措辞偏好、目录格式和无现实影响的理论漏洞不构成 Issue。

输出必须以以下三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后按 Issue 列出：源码路径与符号、与 FACT_A 的对照、为什么影响教材或 Harness、应接受的修正或定向验证。没有实质问题时明确写 `No material issues`。
