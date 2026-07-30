# M14 事实闸门记录与 Codex 裁决

状态：`fact-reviewed`

审查会话：`f28cab71-1ee2-4ef2-b68e-38777c662031`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max；FACT_A 与 FACT_B 使用同一会话，均自然退出，无应用层超时。

## 闸门结果

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 3
```

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

FACT_A 的三个意见经直接源码核验后裁决：

1. `cost-tracker.ts:addToTotalSessionCost()` 没有去重，但 streaming 失败请求与 non-streaming fallback 是两次真实 Provider 请求，各自 usage 各自计费；不能把两笔真实费用称为同一请求的重复计费。`rebutted`。
2. `StreamingToolExecutor.discard()` 只设置 discarded 标记，不能回滚已经启动的外部副作用；partial tool 后透明 fallback 可能重复执行。`accepted`，进入正文风险和 Harness reject/defer 边界。
3. `ttftMs` 只在 `message_start` 设置，streaming 在 start 前失败而 fallback 成功时保持 0；这是不可得值被伪装成 0ms 的观测问题。`accepted`，clean-room `UsageRecord` 用 optional TTFT。

## FACT_B 对照结论

- `queryModelWithStreaming()` 经 VCR `yield* queryModel()`；主请求为 `messages.create({ ...params, stream: true }, { signal, headers }).withResponse()`，raw stream 用于避免每个 `input_json_delta` 的重复 partial parse。
- `withRetry()` 在 stream 创建前拥有 attempt、client 和可变 `RetryContext`，可以先 yield `api_retry` system message；成功后 generator return value 才是 raw Stream。
- raw part 处理顺序为 watchdog/stall 观察、assembly state 更新、可选内部 message yield，最后统一 yield `stream_event`。
- `content_block_stop` 先产出一条单 block assistant，再产出 raw stop event；`message_delta` 之后直接 mutation 最后一条已产出 assistant 的嵌套 message。QueryEngine 的 transcript 队列保存该引用并延迟序列化。
- request creation retry、model fallback、streaming-to-non-streaming fallback 分属 `withRetry()`、`queryLoop()` 和 `queryModel()`；不能写成一个统一 retry 开关。
- user abort、SDK timeout、idle watchdog 和 consumer `.return()` 有不同 owner 与终态；outer `finally` 负责资源释放，consumer close 不保证后续成功日志执行。
- usage 是 cumulative snapshot；streaming cost 在 `message_delta` yield 前结算，fallback cost 在 outer `finally` 结算；具体 `llmSpan` 和 message-chain `previousRequestId` 避免并行错配。
- 空/不完整 stream 触发 fallback；partial tool 已经触发外部副作用时，tombstone/discard 只能收敛消息，不是 rollback。

## 证据边界

- `快照事实`：上述路径、符号、yield 顺序、mutation、retry/fallback owner、cleanup 和 usage 语义来自当前源码直接核验。
- `运行验证`：后续 fake-stream 实验只证明 clean-room 行为契约，不证明访问了 Claude Code 网络端点。
- `设计迁移`：Harness 的 bounded single-consumer stream、optional TTFT、terminal summary 和 metadata-only stream trace 是本课程的 clean-room 设计。
- `推断`：Provider 在 partial tool 后是否真的重发相同 call 取决于实际响应；教材只保留源码明确记录的潜在重复副作用风险。

