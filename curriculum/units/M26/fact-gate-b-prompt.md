# M26 FACT_B：同会话对照

继续 FACT_A 会话，只核对下面 Codex 结论和 H7-2 候选契约，不重新总结仓库、不读取 Graphify、不修改文件。

## Codex 结论

- interaction 是 user request root，LLM/tool/blocked/execution/hook 是 operation span；`AsyncLocalStorage` 传播 interaction/tool context，非 ALS span 用 strong map 保活，active map + 30 分钟 TTL 清 orphan。并行 LLM response 应传 exact span；legacy recent-span fallback 可能串接。
- analytics metadata type 的普通路径排除 string；冗长的 `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` cast 只是 code-review marker，不是编译期安全证明。sink attach 前 module queue，attach 后 microtask drain。标准 interaction prompt 默认 `<REDACTED>`，真实 user/tool content 由 env gate；beta tracing 可记录 truncated system prompt/tool/new context/model/tool result。hash/truncate 不等于 redaction，因此不能说 telemetry 永远无正文。
- `message_start` 计算 successful attempt 的 TTFT；success log 区分 successful-attempt duration 与 including-retries duration，并记录 attempt/fallback。foreground/background 529 retry policy 不同，fast-mode 可 cooldown/fallback。H7-2 对缺失 TTFT 用 unknown，不按 0。
- `updateUsage()` 明确处理 cumulative totals；input/cache 的后续 0 不覆盖起始非零。最终 message_delta usage 计算 cost 并加入 session；nonstream fallback 在 finally 计一次；advisor usage 分账加入 total。不能累加每个 cumulative event。
- price table 按 canonical model/fast mode；unknown model 用 fallback price并设置 inaccurate marker。快照没有每条 cost entry 的 price catalog version，H7-2 绑定 version 是迁移设计。
- provider quota headers、boolean feature policy limits、`output_config.task_budget` 的 per-request model pacing hint，以及企业 tenant token/cost/concurrency reservation 是四类机制。policy limits 多数 miss/unknown fail open，essential traffic 有少数 exception；task budget 也不是本地硬性 quota。
- SerialBatchEventUploader serial ordered、bounded queue/backpressure、batch bytes/count、retry/backoff/jitter、optional failure drop count。`flush()` 可在 drop 后正常完成；`close()` 丢 pending 并释放 waiter。它不能代表所有 analytics transport。
- 快照有 feature-specific outcome/feedback event，但未证明通用 Agent evaluation ledger。

## H7-2

H7-2 当前尚不存在，下面是本单元从零建立的迁移候选，而不是待审 upstream artifact：fixed-schema metadata-only telemetry、observer-only OTel port、attempt-scoped cumulative usage delta + price version/unknown cost、idempotent evaluation ledger、tenant token/cost/concurrency reservation 与 per-tenant bounded queue。实验覆盖 cumulative/delta、retry/fallback identity、unknown cost/TTFT、observer failure/redaction、quota oversubscription/noisy tenant/cancel release。

不声称 production OTel、exact provider billing、distributed quota CAS、公平跨节点 queue 或通用 evaluation model。

只报告会改变上述事实、实验或契约的实质问题。必须以下列三行开头；接受时明确 PASS / 0。

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```
