# M27 FACT_A：独立源码盲审

请读取 `curriculum/units/M27/fact-gate-scope.md`，独立审查当前源码快照。不要读取 Codex 工作簿、Graphify、H7-3 实现或候选正文。

重点寻找过度外推：把窄 Query DI 当完整 composition root、把 CLI update/lock 当多 worker rollout、把 bounded graceful shutdown 当全部完成保证、把 best-effort settings migration 当数据库事务、把 bridge version/epoch 当通用 release protocol，以及声称快照已有 canary/rollback/DR。

只报告影响教材事实、实验或 clean-room H7-3 契约的问题。每个问题给路径、符号、决定性分支和影响；无法确认处明确标记。不得修改任何文件。

必须以下列三行开头：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```
