# M14 事实闸门 B 提示词

继续同一个 FACT_A 会话。现在对照下面的 Codex 结论，只检查事实错误、重要遗漏、证据不足、版本混淆或会扭曲实验/Harness 的表述；不要重复完整仓库总结，不要修改文件。

## Codex 机制摘要

1. `queryModelWithStreaming()` 经 VCR `yield* queryModel()`；主请求为 `messages.create({ ...params, stream: true }, { signal, headers }).withResponse()`，使用 raw stream 避免 SDK 对每个 `input_json_delta` 重做 partial JSON parsing。
2. `withRetry()` 在 raw stream 创建前拥有 attempt/client/RetryContext。失败可先 yield `api_retry` system message，最终 generator return value 才是 Stream。
3. raw part 的处理顺序为：reset watchdog -> stall observation -> 更新 assembly state -> 可能先 yield internal message -> 最后 yield 对应 `stream_event`。
4. `content_block_start` 按 index 创建空 text/thinking/tool-input slot；delta 必须匹配现有 slot 与 block type；`content_block_stop` 先创建并 yield 单 block assistant，再 yield raw stop event。
5. `message_delta` 后到，更新 cumulative usage 和 stop reason，并直接 mutation 最后一条已 yield assistant 的嵌套 message；QueryEngine transcript queue 保存该嵌套对象引用并延迟序列化，所以 object replacement 会丢 final fields。最后一条承载 usage，避免多 block 重复计费。
6. request creation retry、model fallback、streaming-to-non-streaming fallback 是三种机制：`withRetry` 决定前者并发出 fallback signal；`queryLoop` 真正切换 model 并重跑 request；`queryModel` 在已创建 stream 后可内部执行 non-streaming fallback。
7. user signal 已 aborted 时的 `APIUserAbortError` 是业务取消；caller signal 未 aborted 的 SDK abort 映射 timeout；watchdog 主动 release hung stream；consumer `.return()` 通过 outer `finally` 保证 Stream/Response cleanup，但不保证 generator 后续 success logging 执行。
8. empty/incomplete stream 进入 fallback。若 partial streaming tool call 已经触发工具，透明 fallback 可能重复副作用；源码提供禁用该 fallback 的开关，上层会 tombstone partial messages 和 discard executor，但这不是副作用 rollback。
9. streaming usage 是 cumulative snapshot，不能逐 event 相加。Streaming cost 在 `message_delta` 的 yield 前结算；non-streaming fallback cost 在 outer `finally` 结算，以覆盖 consumer 在 fallback assistant yield 后立即 close。
10. `previousRequestId` 从当前 message chain 推导；具体 `llmSpan` 在 request 开始时捕获并传入成功/失败日志，避免并行请求匹配到“最近 span”。

## 对 FACT_A 三项意见的 Codex 初步裁决

1. “streaming 后 fallback 会重复累计 cost”：拟驳回。`addToTotalSessionCost()` 的确没有去重，但前一次 streaming 与后一次 non-streaming 是两次真实 Provider 请求，各自返回不同 usage 并产生实际费用；语义替代不等于第一次调用免费。请只在源码能证明同一请求 usage 被重复提交时保留此 issue。
2. “partial streaming tool 后 fallback 可能重复执行”：接受。`StreamingToolExecutor.discard()` 只设置 discarded flag，不能回滚已发生副作用；该风险已经进入教材和 Harness reject/defer 边界。
3. “non-streaming fallback 的 TTFT 可能上报 0”：接受。`ttftMs` 初始为 0，只在 `message_start` 改写；streaming 在 start 前失败而 fallback 成功时，0 表示不可得而非真实 0ms。clean-room 契约改用 optional/unknown。

## 拟验证实验

- indexed text/thinking/tool JSON assembly 与 start/delta 去重；
- assistant-before-stop-event 与 later terminal mutation；
- delta-before-start/type mismatch/missing message fail closed；
- cumulative usage、单次 cost；
- retry notice before stream；
- incomplete stream fallback 与 partial-tool duplicate-risk marker；
- abort/consumer close cleanup；
- bounded stream buffer overflow fail closed。

## Harness 候选

合入 Provider-neutral `ModelStreamEvent`、strict `StreamingAssembler`、`UsageRecord`、可选 `ModelAdapter.stream()`，以及 bounded single-consumer `AgentRunStream`。close 必须 abort owner run 并等待 cleanup，terminal summary 使用独立 Promise；拒绝无界 async queue、把 delta 写入 durable conversation、把 cumulative usage 当增量、partial tool 后透明重放。Provider SSE parser、多 observer、完整 OTel/cost ledger、model fallback、streaming tool execution 继续 defer。

输出必须以三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

每个 issue 必须给出路径、符号、为什么影响结论以及最小修正；没有实质问题就明确 `PASS / 0`。
