# M02 研究工作簿

状态：`final`

Graphify 只用于候选定位；所有结论已回到当前 `claude-code-CLI/` 静态快照核验。

## 1. 核心问题与边界

核心问题：为什么 Agent 运行不能只返回一个最终对象，而要用 Promise、AsyncGenerator、AsyncIterable、`yield`、`yield*` 和 `for await` 让值分段出现？生产者失败、消费者提前停止和缓冲发生时，谁负责收敛？

本单元只建立异步迭代最小模型。事件循环、timer、Node Stream、子进程和 AbortSignal 留给 M03；Query Loop 业务状态机留给 M12；模型流协议和重试留给 M14；工具并发调度留给 M15。

风险：R1。最大风险是把 AsyncIterable 误教成“自动流式、自动背压、自动取消”。

## 2. 源码锚点

- `src/query.ts:query()` / `queryLoop()`：外层 `yield*` 转发事件并保留 `Terminal` 返回值；注释明确 throw 与 `.return()` 的不对称路径。
- `src/QueryEngine.ts:submitMessage()`：`for await` 消费 `query()`，按事件类型更新消息、Transcript 和 SDK 输出。
- `src/services/api/claude.ts:queryModelWithStreaming()`：多层 `yield*` 委托模型流。
- `src/services/api/claude.ts:executeNonStreamingRequest()`：手动 `.next()`，yield 中间 system error，最终 `return e.value as BetaMessage`。
- `src/services/tools/StreamingToolExecutor.ts`：`for await` 消费单工具生成器，`getRemainingResults()` 产生进度/结果，`Promise.race` 等待完成或新进度。
- `src/utils/stream.ts:Stream<T>`：AsyncIterator 外观、单消费者限制、push queue、done/error/return。

## 3. 最小语义

- 调用 async function 会立即执行到第一个 await，并返回 Promise；Promise 表示一个未来完成或失败的终值。
- 调用 async generator 只创建 iterator，函数体到第一次 `.next()` 才开始执行。
- `yield value` 产生 `{done:false,value}` 并暂停；下一次 pull 才继续。
- `return value` 产生 `{done:true,value}`；普通 `for await` 循环不暴露这个终值。
- `yield* child()` 转发 child 的 yield，并把 child 的 return value 作为表达式结果。
- 生产者 throw 会让等待的 `.next()` reject；若业务把错误编码成 event，则不会自动 reject。
- 消费者 `break`/`.return()` 会请求 iterator 关闭，并应触发 generator `finally`；外部资源是否真正取消取决于 finally/return/Abort 等实现。

## 4. 背压边界

原生 generator 的 yield 边界是 pull-driven：生产者 yield 后不继续，直到消费者再次 next。但 Claude Code 的 `Stream<T>` 允许外部 `enqueue()` 先把值推入 queue，因此 AsyncIterable 外观可以包含任意缓冲。模型 SDK、网络 socket 或工具子进程也可能在迭代器之外缓冲。

结论：只能说 iterator 边界支持逐次消费；端到端背压必须检查上游协议、队列上限、丢弃/阻塞策略和资源取消。

## 5. 错误与终值

`query()` 捕获 `yield* queryLoop()` 的 `Terminal`，正常结束后才通知 consumed commands completed。throw 会穿过 `yield*`；消费者 `.return()` 会关闭两层生成器，并跳过该完成通知。这个差异影响生命周期事件。

`executeNonStreamingRequest()` 展示另一种模式：它手动调用 retry generator 的 `.next()`，将中间 system messages yield 给上层，直到 done，再 return 最终 BetaMessage。若改成普通 `for await`，终值会被循环语法丢弃。

## 6. 实验

双语言实验验证：惰性启动、逐次 pull、正常完成、早退 finally、部分事件后的异常、AsyncIterable queue 缓冲。TypeScript 另以嵌套 async generator 验证：消费者对外层调用 `.return()` 时，内外 `finally` 都执行，但 `yield*` 后的正常完成代码不执行；正常耗尽时 `yield*` 才取得子生成器终值。

Python async generator 不允许 `return value`，因此 Python 版把完成信息建模为显式 `run.completed` event；这是语言差异，不做伪等价翻译。

## 7. H0 候选

- `HarnessEvent` 判别联合；
- `AsyncIterable<HarnessEvent>` 作为事件端口；
- 正常终值与显式 completion event 的选择必须写进协议；
- consumer early-close 与 producer finally 是资源契约；
- queue 是否允许缓冲、上限和单/多消费者要显式声明。

初步裁决：`merge`，在 M01 的 Message/RunState 契约旁新增异步事件协议，不提前加入 AbortSignal。

## 8. 证据边界

源码中的生成器、迭代和 queue 行为是快照事实；双语言实验是运行验证；H0 event protocol 是设计迁移。Graphify 未作为事实证据。
