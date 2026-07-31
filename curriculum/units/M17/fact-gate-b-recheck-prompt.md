# M17 事实闸门 B 定向复审

继续当前 M17 FACT_A/FACT_B 会话，只复核上轮唯一问题是否闭合，不重复审查其他已确认内容。

Codex 已修正函数边界：

```text
shouldAutoCompact()
-> query-source recursion guard
-> feature/config gate
-> token threshold decision

autoCompactIfNeeded()
-> consecutive-failure circuit breaker
-> Session Memory first
-> traditional compact fallback
-> failure-count update
```

教材、工作簿、实验和 Harness 不再把 circuit breaker 归给 `shouldAutoCompact()`。

请只回答该问题是否闭合。必须以下列三行开头：

```text
GATE: FACT_B_RECHECK
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

不得修改任何文件。
