# M02 事实闸门中性范围

独立核验当前静态源码快照中 Promise、AsyncGenerator 与 AsyncIterable 的决定性语义，不评价教学风格，不修改文件，不读取 Graphify 或 M02 作者材料。

源码根目录：`D:\agent\Claude code最新\claude-code-CLI`

需要回答：

1. `query()` 与 `queryLoop()` 的 AsyncGenerator yield 类型、return 类型和 `yield*` 语义是什么？正常 return、throw、消费者 `.return()` 分别怎样影响外层完成逻辑？
2. `QueryEngine.submitMessage()` 怎样用 `for await` 消费 query events，消费时执行哪些状态写入或 SDK 转换？
3. `queryModelWithStreaming()` 的委托链与 `executeNonStreamingRequest()` 的手动 `.next()` 各自为何保留或忽略终值？
4. `StreamingToolExecutor` 怎样消费单工具生成器、缓存 progress、产生 remaining results，并用 Promise.race 等待？
5. `utils/stream.ts:Stream<T>` 是 pull、push 还是混合适配？queue、单次迭代、error、done 和 return 怎样工作？
6. 能否仅凭 AsyncIterable 声称端到端背压或资源取消？哪些层仍可能缓冲？
7. 哪些错误被 throw，哪些被编码为 message/event？教材应保留什么边界？

优先阅读：`src/query.ts`、`src/QueryEngine.ts`、`src/services/api/claude.ts`、`src/services/tools/StreamingToolExecutor.ts`、`src/utils/stream.ts`。

输出必须以规定 FACT_A 三行开始，只报告影响事实、实验或 H0 契约的实质问题，给出路径、符号和决定性语义。
