# M14 作者工作簿：真实模型流

状态：`release-candidate`

## 单元问题与边界

真实问题不是“怎样调用一次模型 API”，而是：一条已经完成请求投影的 wire request，怎样经过重试、raw SSE 消费、content block 组装、终态回写和资源清理，变成 Query Loop 能消费的 assistant message；当连接中断、调用方取消、消费者提前关闭或流不完整时，谁负责收敛。

前置：M10 消息所有权、M11 纵切、M12 AsyncGenerator 控制权、M13 durable/query/API/wire 四层请求投影。

本单元闭合：

```text
wire params
-> withRetry 创建流
-> raw SSE event
-> indexed content block assembly
-> assistant message + stream_event
-> final usage / stop reason 回写
-> success/error accounting
-> cleanup
```

本单元不展开 M15 的工具调度、并发安全分组和完整 Tool Loop，也不穷举每一种 Provider 错误或 OTel exporter。M40 原可观测性专题将在用户要求的 M25 前课程重排中合并，但 M14 只讲模型请求自身必需的 identity、TTFT、usage、cost 和 span 归属。

风险：`R2`。关键风险是 partial output 已可见后 fallback 可能重复工具副作用，以及生成器提前关闭时清理、计费和成功日志并不拥有相同的保证。

## Graphify 候选与直接核验

Graphify 候选中心：`queryModel()`、`withRetry.ts`、`contentArray.ts`、`StreamingToolExecutor`、`cost-tracker.ts`、`sessionTracing.ts`。

直接核验结果：

- `queryModel()` 与 `withRetry()` 是本单元真实主链；
- `StreamingToolExecutor` 是下游消费者，属于 M15 主讲，只用于确认 partial `tool_use` 已可能触发副作用；
- `contentArray.ts` 不是 raw SSE 主组装器，不能因图中邻近写入主调用链；
- 成本入口实际由 `claude.ts` 的 `message_delta`/fallback `finally` 调用，再进入 cost state；
- span 由 `startLLMRequestSpan()` 返回的具体对象标识，成功和失败日志把同一个对象交给 `endLLMRequestSpan()`。

Graphify 仅完成候选定位，以下结论均来自源码直接阅读。

## 精简源码地图

| 位置 | 决定性符号或分支 | 本单元意义 |
| --- | --- | --- |
| `src/services/api/claude.ts` | `queryModelWithoutStreaming()` 约 709 | 即使只要最终消息也完整消费 generator，使 yield 后的成功日志有机会执行 |
| 同上 | `queryModelWithStreaming()` 约 752 | VCR 外壳内 `yield* queryModel()`，不是另一个组装实现 |
| 同上 | `queryModel()` 约 1017 | request、stream、assembly、fallback、usage 与 cleanup 的 owner |
| 同上 | `getPreviousRequestIdFromMessages()` 约 928 | 从当前消息链推导 request identity，避免并行 Agent 共用全局 last-id |
| 同上 | `startLLMRequestSpan()` 约 1498 | 捕获本次具体 span，避免并行响应串线 |
| 同上 | `releaseStreamResources()` 约 1519 | 同时释放 SDK stream controller 和 Response body |
| 同上 | `messages.create({ ...params, stream: true }, { signal, headers }).withResponse()` 约 1818 | 主流式网络边界；raw stream 避免每个 JSON delta 的重复 partial parse |
| 同上 | watchdog 约 1868 | 主动发现无后续 chunk 的静默悬挂并释放资源 |
| 同上 | `for await (const part of stream)` 约 1940 | raw event 消费和被动 gap 观测 |
| 同上 | `content_block_start/delta/stop` 约 1995/2053/2171 | indexed block 状态机与 assistant message 产出 |
| 同上 | `message_delta` 约 2213 | cumulative usage、stop reason、成本和已 yield 对象的最终回写 |
| 同上 | incomplete stream 约 2337 | 空流或不完整流不能伪装成功，进入 non-streaming fallback |
| 同上 | streaming catch 约 2404 | user abort、SDK timeout、fallback 开关和重复工具风险 |
| 同上 | outer `finally` 约 2808 | consumer `.return()` 也保证 stream cleanup；fallback cost 也在这里结算 |
| 同上 | `cleanupStream()` / `updateUsage()` 约 2898/2924 | controller abort 与 cumulative usage merge |
| `src/services/api/withRetry.ts` | `withRetry()` 约 170 | operation 前重试状态 owner，可 yield `api_retry` 系统消息，最终 return 真实结果 |
| 同上 | retry context mutation 约 261-425 | fast mode、max-token override 和 model-fallback 信号 |
| 同上 | persistent heartbeat 约 477-511 | 长等待被拆成可见 heartbeat，但仍响应 caller signal |
| `src/query.ts` | `for await (deps.callModel)` 约 659 | Query Loop 是模型事件消费者，不拥有网络流组装 |
| 同上 | streaming fallback reset 约 709 | tombstone partial assistant、丢弃旧 tool result/executor |
| 同上 | `FallbackTriggeredError` 约 893 | 真正切换 fallback model 并重跑整个 request 的 owner 在 Query Loop |
| `src/QueryEngine.ts` | assistant transcript 约 718 | fire-and-forget 队列持有嵌套 message 引用，解释为何 final fields 必须直接 mutation |
| `src/services/api/logging.ts` | `logAPIError()` / `logAPISuccessAndDuration()` | 用同一 llmSpan 结束请求，记录 retries、TTFT、usage、cost 与 identity |
| `src/utils/telemetry/sessionTracing.ts` | `endLLMRequestSpan()` 约 353 | 显式 span 优先；缺省的 legacy “最近 span”在并行下可能错配 |

## 真实运行与产出顺序

### 流创建前

1. `queryModel()` 从当前 messages 推导 `previousRequestId`，创建本次 `llmSpan`。
2. `withRetry()` 拥有 attempt、client、consecutive 529、persistent attempt 和可变 `RetryContext`。
3. 每个 attempt 重建 params，并调用 raw streaming `messages.create(...).withResponse()`。
4. 若 attempt 失败且可重试，`withRetry()` 可以先 yield `SystemAPIErrorMessage`，sleep 后再试；成功时 generator 的 return value 才是 `Stream`。
5. 所以调用方观察顺序是“零到多个 retry system event，之后才开始 raw SSE”，不是把 retry event 混进 Provider SSE。

### 单个 raw event

```text
收到 part
-> 重置 active idle watchdog
-> 记录被动 stall gap
-> 按 part.type 更新 assembly state
-> 可能先 yield 内部 assistant/error message
-> 始终再 yield 对应 stream_event
```

决定性顺序：

- `message_start`：保存 `partialMessage`，计算 TTFT，接收 input/cache usage；随后 yield `stream_event`。
- `content_block_start`：按 index 建槽位。text、thinking 和 tool input 从空值开始，避免 SDK start 内容和 delta 重复；随后 yield `stream_event`。
- `content_block_delta`：只有 slot 存在且 delta 与 block 类型相符才累加；否则 fail explicitly；随后 yield `stream_event`。
- `content_block_stop`：从该 index 的完整 block 创建一条 `AssistantMessage`，先 push/yield assistant，再 yield stop 的 `stream_event`。
- `message_delta`：更新 cumulative usage 和 stop reason；直接修改最后一条已 yield assistant 的嵌套 message；先处理 refusal/max-token 等派生消息，再 yield raw `stream_event`。
- `message_stop`：没有新业务消息，只转发 `stream_event`。

一个 API response 有多个 content blocks 时，当前快照会产出多条共享底层 API message id、但拥有各自 harness uuid 的 assistant messages。最终 usage/stop reason 只附在最后一条，避免每个 block 重复计费；后续 normalize 可以按 API message identity 合并内容。

## 状态所有权

| 状态 | owner | 修改者 | 观察者 |
| --- | --- | --- | --- |
| `RetryContext`、attempt/client | `withRetry()` | retry 分支 | params builder、日志 |
| raw `Stream`、`Response` | 单次 `queryModel()` generator | request callback、release helper | SSE consumer |
| `partialMessage` | stream assembler | `message_start` | block stop message factory |
| `contentBlocks[index]` | stream assembler | start/delta | block stop |
| `newMessages` | stream assembler | block stop/fallback | Query Loop、success logging |
| final usage/stop reason | stream assembler | `message_delta` 或 fallback `finally` | transcript、QueryEngine、cost/span |
| durable conversation | REPL/QueryEngine/上层 runtime | 上层消费者 | 下次请求投影 |
| model switch | `queryLoop()` | `FallbackTriggeredError` 分支 | 下一次 `callModel()` |
| caller cancellation | 入口 `AbortController` | caller | retry、network、Query Loop、tools |

最反直觉的别名边界：`content_block_stop` 已把 assistant 对象交给消费者；`message_delta` 来得更晚。当前 QueryEngine 的 transcript 写队列保存 `message.message` 原引用并延迟序列化，因此源码必须 mutation 这个嵌套对象，替换外层或嵌套对象会使 queued reference 永远停在旧 usage。

## 重试、fallback 与取消不是一件事

### request creation retry

发生在还没有交出 raw stream 前。`withRetry()` 可刷新 client、调整 fast mode、处理 auth、按 Retry-After 等待、修正 max tokens，并 yield 可见 retry 系统消息。最终失败被包成 `CannotRetryError`，保留最终 retry context。

### model fallback

连续 overload 达到策略阈值时，`withRetry()` 抛 `FallbackTriggeredError`。`queryModel()` 必须继续抛出；真正把 `currentModel` 改成 fallback model、清空 partial attempt state、补配对、重建 executor 并重跑整次 request 的 owner 是 `queryLoop()`。

### streaming-to-non-streaming fallback

raw stream 已创建后发生组装错误、idle timeout、空/不完整流时，`queryModel()` 可以在内部调用 non-streaming request。partial assistant 可能已经被上层看见，所以 `onStreamingFallback` 让 `queryLoop()` tombstone 旧消息并丢弃旧 executor 结果。

但这不是 side-effect rollback。若 streaming tool execution 已经启动真实工具，再次得到相同 tool call 仍可能重复执行。源码因此提供开关禁用 mid-stream fallback。企业 Harness 应默认对有副作用工具使用 stable call id + idempotency ledger，或在 partial tool exposure 后不做透明重放。

### user abort、SDK timeout 与 consumer close

- `APIUserAbortError` 且 caller signal 已 aborted：是真实用户取消，API 层不 yield synthetic assistant error，Query Loop 负责 interruption 和未配对 tool result 收敛。
- SDK 抛 abort 但 caller signal 未 aborted：映射为 `APIConnectionTimeoutError`，不能伪装用户取消。
- consumer 对 generator 调 `.return()`：外层 `finally` 一定释放 stream/Response；但 generator 后面的 success logging 不保证执行。这正是 `queryModelWithoutStreaming()` 必须完整 drain 的原因。

## usage、成本和 span

- Streaming API usage 是累计快照，不是 delta；input/cache 的显式 0 不覆盖 `message_start` 的真实值，output 等字段使用最新值。
- Streaming cost 在 `message_delta` 内、任何该分支 yield 之前更新。
- Non-streaming fallback assistant 先 yield，消费者可能立即 close，所以 fallback usage/cost 在外层 `finally` 结算。
- `previousRequestId` 来自当前消息链，不来自跨 Agent 全局变量。
- 每个请求捕获具体 `llmSpan` 并把它传给 success/error logging；否则 legacy “最近活跃 span”会在并行请求下错配。
- TTFT 在 `message_start` 计算；首个任意 chunk 的 profiler checkpoint 与 TTFT 不是同一个语义。
- `ttftMs` 当前初始化为 `0`。若 streaming 在 `message_start` 前失败而 non-streaming fallback 成功，success logging 会收到 `0`；这表示快照中的观测缺口，不等于真实 0ms。clean-room Harness 应使用 optional/unknown 表达不可得。
- 若 streaming 已产生可计费用量、随后又发起 non-streaming fallback，两次 Provider 请求都实际消耗资源，session cost 应累计两笔；不能因第二次结果替代第一次可见输出就把第一次费用当作“重复计费”。

## 实验假设与反证条件

TypeScript/Python fake-stream 实验应验证同一行为契约：

1. text、thinking 和 fragmented tool JSON 按 index 正确组装；start 自带 text 不被重复。
2. `content_block_stop` 先产出 assistant，随后才是 raw stop event；`message_delta` 再完成终态回写。
3. delta-before-start、类型错配、无 partial message 的 stop 必须失败，不能静默跳过。
4. cumulative usage 的 input/cache 0 不擦除旧值；最终成本只结算一次。
5. retry notice 位于 raw stream 前，重试 params 可以读取更新后的 retry context。
6. 空流/不完整流触发 fallback；若 partial tool call 已暴露则报告 duplicate-side-effect risk。
7. caller abort 与 consumer close 都释放资源；只有 abort 是业务取消，close 不自动伪装成取消原因。
8. 缓冲区必须有明确上限；慢消费者不能让 producer 创建无界队列。

反证条件包括：错误顺序仍被接受、usage 被相加而非覆盖、close 后资源未释放、terminal summary 可在 terminal event 之前完成、buffer 越界仍继续接收。

## Harness 候选契约

候选 `merge`：

- Provider-neutral `ModelStreamEvent` 与严格 `StreamingAssembler`；
- `UsageRecord` 明确 per-response cumulative snapshot 和 run-level accumulation；
- `ModelAdapter.stream()` 可选能力，现有 `complete()` 保持兼容；
- bounded pull-based `AgentRunStream`：固定容量、单消费者、terminal summary 独立 Promise；close 必须 abort owner run 并等待 producer cleanup；
- metadata-only stream trace：TTFT、usage counts、retry count、terminal status，不记录 token text、tool JSON 或 credential。

候选 `defer`：

- 多 observer fan-out；
- Provider-specific SSE parser；
- OTel exporter、cost price table、quota ledger；
- transparent model fallback 和 idempotency ledger；
- streaming tool execution，留给 M15。

候选 `reject`：

- 无界 `AsyncQueue`；
- consumer break 仅停止读取但不通知 producer；
- 把每个 delta 写入 durable conversation；
- 把 cumulative usage 当增量相加；
- partial tool call 后无条件透明重放。

## 事实闸门范围

事实 A 只获得中性问题与源码路径。事实 B 对照以下高风险结论：

- raw event 与内部消息的准确 yield 顺序；
- final usage/stop mutation 的对象引用原因；
- creation retry、model fallback、streaming fallback 三种 owner；
- user abort、SDK timeout、watchdog 与 consumer close 的不同终态；
- cumulative usage、cost 和 span identity；
- partial tool exposure 后 fallback 的 side-effect 风险。
