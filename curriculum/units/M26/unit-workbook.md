# M26 研究工作簿：可观测性、评估、Token、成本与配额

状态：`researched`

风险：`R2`。观测通常不改变主业务结果，但错误关联、重复计费、内容泄漏和 observer backpressure 会改变治理结论，需验证并行、累计值、失败与队列边界。

## 1. 单元问题与边界

本单元回答：一次 Agent run 跨多个模型 attempt、Tool、Task 与 Agent 后，怎样重建它为什么慢、花了多少、结果怎样、由谁消耗额度，同时不把 prompt、tool input/result 和 secret 复制进 telemetry？

本单元包含：

- run/request/attempt/tool identity 与 trace parentage；
- API duration、retry duration、TTFT 与缺失值；
- cumulative usage、delta、cache token、advisor/fallback cost；
- price uncertainty 与 price version；
- metadata analytics、OTel/Perfetto content gates 与 redaction boundary；
- provider quota、policy limit 与 tenant budget 的区别；
- ordered batching、retry、backpressure 与 drop visibility；
- evaluation ledger；
- H7-2 redacted telemetry、usage/cost/evaluation ledger 与 tenant governor。

不包含：

- M27 的部署拓扑、canary、rollback、schema rollout 和 disaster recovery；
- 产品 Usage UI 的枚举式功能；
- 对所有 Analytics event 的逐项清单；
- 把 feature-specific feedback 冒充通用 Agent evaluation platform。

## 2. Graphify 候选与源码闭合

Graphify 只定位到 `cost-tracker.ts`、`api/logging.ts`、`sessionTracing.ts`、`SerialBatchEventUploader.ts`、`policyLimits`、`claudeAiLimits.ts` 和 `withRetry.ts`。以下结论均由直接源码阅读闭合。

## 3. Identity 与 Span

`src/utils/telemetry/sessionTracing.ts`：

- interaction 是一次 user request -> Claude response 的 root span；
- LLM request、tool、tool.blocked_on_user、tool.execution、hook 是 operation span；
- `AsyncLocalStorage` 分别传播 interaction/tool context；
- LLM request 等非 ALS-owned span 由 strong map 保活；active map 使用 WeakRef；
- 30 分钟 TTL 清理未正常结束的 orphan span，interval `unref()` 不阻止进程退出；
- end LLM 时应传入 start 返回的 exact span；并行请求若依赖 legacy “最近 llm span” fallback，可能串接 response；
- tool execution 与 blocked-on-user 分 span，能区分等待人类和真实执行。

状态 owner 是 tracing subsystem，不是 run state。observer 不能决定 Tool 是否成功或回滚。

## 4. 内容边界

`src/services/analytics/index.ts::logEvent()` 的 metadata type 默认只允许 boolean/number/undefined；string 必须显式使用冗长的 `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` cast，目的是让代码审查者看到风险。这个标记类型本身是 `never`，cast 可以绕过普通 string exclusion，因此它是审查约定，不是编译期安全证明。sink 未 attach 前事件进入 module queue，attach 后用 microtask drain。

`sessionTracing.ts` 默认将 interaction `user_prompt` 设为 `<REDACTED>`，只有 `OTEL_LOG_USER_PROMPTS` 启用时写真实 prompt。Tool content event 由 `OTEL_LOG_TOOL_CONTENT` 控制。

beta tracing 更强：`betaSessionTracing.ts` 可以记录 system prompt、tools、new context、model output、tool input/result；会 hash、dedupe、truncate，但 truncation 不是 redaction，hash 也不能消除低熵内容风险。教材不能泛称“OTel 永不含正文”。

H7-2 默认只暴露 fixed metadata union；原始内容只通过受控 artifact/evidence reference，默认实现不提供正文 port。

## 5. API timing 与 retry

`src/services/api/claude.ts` 在每个 attempt 开始时记录 `start`，`message_start` 到达时计算 `ttftMs = Date.now() - start`。`logAPISuccessAndDuration()` 同时计算：

- `durationMs`：成功 attempt 从其 start 到完成；
- `durationMsIncludingRetries`：从整个 retry sequence 开始到完成；
- `attempt`；
- TTFT、request ID、stop reason、usage/cost、fallback flag。

`withRetry.ts`：foreground 529 可重试，某些 background source 直接退出以避免 capacity cascade amplification；fast-mode 429/529 可以等待、cooldown 到 standard speed，或触发 fallback。retry/fallback 是 attempt 层事实，不能只保留最终 request success。

未知或没有产生 `message_start` 的 TTFT 在企业 ledger 中应是 `undefined/unknown`，不能用 0 冒充“即时返回”。快照 success path通常会获得 message_start，但 H7-2 将缺失作为一等状态。

## 6. Usage 与 Cost

`src/services/api/claude.ts::updateUsage()` 的注释明确：streaming usage 是累计 total，不是 delta。input/cache 字段通常在 message_start 给出，后续 message_delta 可能给 0，因此 0 不覆盖已有非零值；output 等字段使用最新累计值。

message_delta 获得最终 usage 后：

1. `calculateUSDCost(resolvedModel, usage)`；
2. `addToTotalSessionCost()`；
3. 按 model 累加 input/output/cache read/cache creation/web search；
4. OTel counter 也记录类型；
5. advisor sub-usage 单独计价并递归加入 total。

non-streaming fallback 在 finally 位置单独记一次，以保证 generator `.return()` 也不漏计。不能把每个 cumulative stream event 都当 delta 相加。

`modelCost.ts` 的 price table 按 canonical model 与 fast mode选择。unknown model 使用 default price fallback，同时设置 `hasUnknownModelCost` 并提示可能不准确。当前 session cost restore 只在 session ID 匹配时恢复。快照没有 price catalog version 进入每条 ledger，因此 H7-2 将 `priceVersion` 与 usage entry 固定绑定，这是迁移设计。

## 7. Quota、Policy Limit 与 Tenant Budget

至少四者不可混写：

- `claudeAiLimits.ts` 从 provider response/error headers 提取 allowed/warning/rejected、utilization、reset、overage；interactive 可做轻量 pre-check，noninteractive 跳过并等待真实 query headers。
- `services/policyLimits` 是组织 feature restriction；多数 unknown/cache-miss fail open，essential-traffic-only 下少数 policy 例外 fail closed。它不是 token/cost quota。
- `configureTaskBudgetParams()` 把 per-request token total/remaining 作为 model pacing hint 写入 `output_config.task_budget`，它不是 provider account quota，也不是本地硬性 reservation。
- enterprise tenant budget 需要在自己的 scheduler 前做 reservation、concurrency 和 bounded queue；这是 H7-2 迁移设计，快照没有同名通用 tenant governor。

## 8. Event Queue、Retry 与 Backpressure

`SerialBatchEventUploader` 是 ordered serial uploader：

- pending buffer；最多一个 POST in flight；
- count/byte batch；
- `maxQueueSize` 满时 `enqueue()` await；
- failure 将 batch 放回队首并 exponential backoff/jitter；RetryableError 可携带 Retry-After；
- 可配置 max consecutive failures，超过后 drop batch 并计数；
- `flush()` 在 queue empty 时完成，但即使 batch 被 drop 也会正常完成，caller 要比较 `droppedBatchCount`；
- `close()` 清空 pending，并释放 enqueue/flush waiter。

这说明 backpressure 不能只看“没有 throw”。drop、close、queue time 都要成为可观察状态。该 uploader 是候选设计参考，不能自动推断所有 analytics 都经它上传。

## 9. Evaluation 边界

快照存在 prompt suggestion acceptance、tool/hook outcome、feedback 等特定事件，但没有证明一个覆盖 Agent correctness 的通用 evaluation ledger。H7-2 增加 versioned rubric + metadata outcome；事实、质量、安全、成本可以是不同维度，不能用“Tool 无异常”推导“答案正确”。

在线 evaluation 不拥有执行权；它记录 outcome 并影响后续 policy/rollout decision。阻断能力若需要，应通过明确 policy gate，而不是 observer 回调抛异常。

## 10. H7-2 候选契约

新增双语言等价实现：

- fixed-schema metadata-only `TelemetryEvent`；
- observer-only `TelemetryRecorder` + `OpenTelemetryPort`，sink failure 不改变 run；
- `UsageCostLedger` 以 attempt identity 记录 cumulative snapshot delta、price version、unknown cost；
- retry/fallback attempt 分开，idempotent event ID 与 collision fail closed；
- versioned `EvaluationLedger`；
- `TenantGovernor` 先 reserve token/cost/concurrency，per-tenant bounded FIFO queue，complete/cancel 显式释放；
- quota/report 不含 prompt/tool payload/secret。

明确不声称：生产 OTel exporter、distributed quota CAS、exact provider billing、通用 evaluation model、跨节点 queue fairness 或 price service。

## 11. 实验与反证

| 实验 | 结论 | 反证条件 |
| --- | --- | --- |
| cumulative usage | 100 -> 130 只增加 30 | total 变成 230 |
| attempt identity | retry/fallback 分账且 event id idempotent | final request 覆盖先前 attempt |
| unknown price | cost status unknown，不写 0 | dashboard 显示免费 |
| TTFT missing | 保持 undefined | 聚合进 0ms bucket |
| span identity | 并行 request/attempt 不串 | one attempt event 归错 request |
| observer failure | exporter error 不改变 run result | emit 抛回执行层 |
| redaction | event/report 无 prompt/secret/tool result | JSON 出现内容 |
| quota reservation | 并发 estimate 不超卖 | 两个 admission 同时越过 budget |
| noisy tenant | per-tenant bounded queue | 单 tenant 无限占队列 |
| completion | reservation release + actual commit | cancel/complete 后仍占 concurrency |

## 12. 事实闸门范围

重点反证：

- OTel/analytics 永远没有正文；
- truncate/hash 等价于 redaction；
- `updateUsage` 事件是增量；
- cost table 对 unknown model 精确；
- final success 足以解释 retries/fallback；
- TTFT 缺失可以按 0；
- legacy recent-span fallback 对并行安全；
- policyLimits 是 token/cost tenant quota；
- `flush()` 成功证明 uploader 无丢失；
- snapshot 已有通用 evaluation platform 或 distributed quota governor。
