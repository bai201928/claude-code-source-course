# M14 事实闸门中性范围

GATE: FACT_A

请独立审查当前 Claude Code CLI 源码快照中“模型请求如何经过 raw stream、事件组装、重试、取消、fallback、usage/cost/span 和资源清理，形成 Query Loop 可消费消息”的真实机制。

源码根目录：

```text
D:\agent\Claude code最新\claude-code-CLI
```

优先阅读：

- `src/services/api/claude.ts`
  - `queryModelWithStreaming`
  - `queryModelWithoutStreaming`
  - `executeNonStreamingRequest`
  - `queryModel`
  - `cleanupStream`
  - `updateUsage`
- `src/services/api/withRetry.ts`
  - `withRetry`
  - `CannotRetryError`
  - `FallbackTriggeredError`
- `src/query.ts`
  - `deps.callModel` 消费循环
  - streaming fallback 与 model fallback 分支
- `src/QueryEngine.ts`
  - assistant message 的 transcript 写入和 stream event 消费
- `src/services/api/logging.ts`
  - `logAPIError`
  - `logAPISuccessAndDuration`
- `src/utils/telemetry/sessionTracing.ts`
  - `startLLMRequestSpan`
  - `endLLMRequestSpan`

请回答：

1. 主流式请求的参数、signal、headers、response 和 stream 分别由谁拥有？
2. retry 系统消息、raw SSE event 和内部 assistant message 的准确产出顺序是什么？
3. text、thinking、tool input、usage 和 stop reason 如何组装，遇到缺槽或类型错配怎样处理？
4. request creation retry、model fallback、streaming-to-non-streaming fallback 是否由同一个组件决定？
5. user abort、SDK timeout、idle watchdog、空/不完整流和 consumer early close 分别怎样结束？
6. usage/cost/TTFT/span/request identity 在何时写入，怎样避免重复或并行错配？
7. 哪些状态已经交给上层后仍会被修改，为什么？
8. partial tool output 已暴露后 fallback 是否存在副作用风险？

只报告会影响事实正确性、实验有效性、初学者理解或 Harness 契约的实质问题。不要总结整个仓库，不要修改任何文件，不要读取 Graphify 输出，不要把新版公开行为覆盖当前快照。

输出必须以三行开始：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

之后给出精简调用链、状态所有权、关键失败路径、源码位置以及无法确认项。

