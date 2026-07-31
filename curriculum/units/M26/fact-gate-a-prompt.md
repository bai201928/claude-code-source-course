# M26 FACT_A：独立源码盲审

请读取 `curriculum/units/M26/fact-gate-scope.md`，独立审查当前源码快照。不要读取 Codex 工作簿、Graphify 或候选正文。

重点反证：trace identity 是否会在并行中串接；正文是否可能进入 telemetry；truncate/hash 是否是 redaction；usage event 是累计还是 delta；cost 对 retry/fallback/advisor/unknown model 如何处理；TTFT 与 duration 的定义；provider quota、policy limit 和 tenant budget 是否相同；event uploader 的 flush/drop/backpressure；是否存在通用 evaluation ledger。

只报告影响教材事实、实验或 clean-room H7-2 契约的问题。每个问题给路径、符号、决定性分支和影响；无法确认处明确标记。不得修改任何文件。

必须以下列三行开头：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```
