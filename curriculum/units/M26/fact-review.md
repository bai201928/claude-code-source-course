# M26 事实闸门审查与裁决

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 6
```

独立盲审确认了 trace identity、analytics 内容边界、cumulative usage 与 quota/policy/task-budget 分层，并要求 H7-2 和通用 evaluation ledger 明确标为 clean-room 新设计。

## Codex 裁决

| Issue | Decision | Reason | Change |
| --- | --- | --- | --- |
| M26-A1 H7-2 尚不存在 | accepted | M26 开始前只有 H7-1；H7-2 是本单元新建契约 | 正文和契约均标记 design migration，不称上游实现 |
| M26-A2 无通用 evaluation ledger | accepted | 快照只有 feature-specific event、cost/limit 机制；不能外推统一质量账本 | 分开讲快照事实与 `EvaluationLedger` 迁移设计 |
| M26-A3 quota/policy/task budget 混写风险 | accepted | 响应头、组织功能 policy、请求 pacing hint 的 owner/来源/执行点不同 | 正文四分法再加入本地 tenant reservation |
| M26-A4 metadata 类型不是安全证明 | accepted | 普通路径排除 string，但显式 `never` cast 是人工审查标记；beta tracing 可含截断正文 | 明确 truncate/hash 不等于 redaction，H7-2 使用 closed metadata schema |
| M26-A5 streaming usage 是累计值 | accepted | `updateUsage()` 覆盖累计 snapshot；轮次之间才用 `accumulateUsage()` | H7-2 先 cumulative-to-delta，再记账，并以 `100 -> 130` 实验反证 |
| M26-A6 legacy LLM span fallback 并发串线 | accepted | 传 exact span 是并行安全主路径；省略 span 的 recent-span fallback 可能误配 | 正文讲 exact identity，并把 fallback 限制放入并发图和面试追问 |

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同一会话接受校准后的快照结论、事实边界和 H7-2 候选范围，无剩余实质问题。
