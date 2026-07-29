# FACT_B 同会话对照提示词

继续 FACT_A 会话，把独立结论与以下 Codex 摘要和实验逐项对照，只在明确冲突时定向回读源码。

## Codex 摘要

- `query(): AsyncGenerator<EventUnion, Terminal>` 用 `const terminal = yield* queryLoop(...)` 转发事件并取得子生成器终值；只有正常 return 才执行 command completed 通知。throw 穿过 `yield*`，消费者 `.return()` 关闭两层并跳过正常完成段。
- `QueryEngine.submitMessage()` 用 `for await` 消费 query，边消费边追加 mutable messages、记录 Transcript、累计 usage 并 yield SDK message；它不是等待最终对象后一次更新。
- `queryModelWithStreaming()` 通过 `yield*` 委托模型流。`executeNonStreamingRequest()` 手动 `.next()`，中间 system message 向上 yield，done 时 return BetaMessage；普通 for-await 不提供该 return value。
- `StreamingToolExecutor` 用 for-await 消费 `runToolUse()`，progress 进入 pending queue，非 progress 进入 results；`getRemainingResults()` 用 generator 产出缓存结果，并用 `Promise.race` 等待工具 promise 或 progress signal。
- `utils/stream.ts:Stream<T>` 是 push-to-async-iterator 适配器：无等待 consumer 时 `enqueue` 进入无界数组 queue；只允许迭代一次；done/error 唤醒 pending next；return 触发可选 callback。因而 AsyncIterable 不等于无缓冲或端到端背压。
- generator throw 与业务 error message 是不同通道；教材必须按具体边界区分。

## 实验

TypeScript 验证 6 个契约：惰性与逐次 pull、正常耗尽时的 yield* 终值、early return finally、嵌套 yield* 的 early return、部分事件后异常、push queue 缓冲。嵌套实验的可观察轨迹是：

```text
normal: inner after-yield -> inner finally -> outer after-yield* -> outer finally
outer.return(...): inner finally -> outer finally
```

在 `.return()` 路径中，`outer after-yield*` 明确没有执行，返回给消费者的是其传给 `.return(...)` 的值。这支持 `query.ts:query()` 的源码注释：消费者关闭时，两层生成器关闭并跳过 command completed 通知。Python 验证对应运行行为，但 Python async generator 不能 return value，因此用显式 completed event，不声称语法等价。

## 对 FACT_A 五项意见的待裁决边界

1. FACT_A #1 声称外层 `.return()` 后会继续执行 `yield*` 后代码，与上述原生 Node 实验冲突。请按实验和 ECMAScript delegated-yield 的 Return completion 重新裁决。
2. FACT_A #2 描述模型异常时可能同时出现补位 tool_result 与新的 assistant API error。该观察不反驳本单元“throw 与业务错误消息是不同通道”的摘要；请只在它造成教材关键表述错误时列为 issue。
3. FACT_A #3 自身确认同步 helper generator 会被委托关闭且无清理需求，不应计为实质问题。
4. FACT_A #4 将“retry callback throw 非对象”与 `e.value` 混在一起：callback throw 会使 `await generator.next()` reject，不会作为 iterator result 的 `value` 被读取。只有 withRetry 违反其静态 yield/return 契约时才可能触发所述属性访问问题；本单元不把类型契约说成恶意值防御。
5. FACT_A #5 关于外部资源清理属于 M03/M15 边界。本单元已明确：generator finally 不等于端到端资源取消，真实资源是否停止取决于 disposer、iterator return、AbortSignal 和具体组件；不会声称 `queryLoop` 自动取消所有工具资源。

输出必须以三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

只报告事实错误、重要遗漏、层次混淆或实验无效问题。无问题写 `No material issues`。
