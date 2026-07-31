# M25 FACT_A：独立源码盲审

请读取 `curriculum/units/M25/fact-gate-scope.md`，在不知道 Codex 结论的前提下独立审查当前源码快照。

重点寻找能反证常见安全误解的决定性源码：Permission allow 是否等于隔离；Sandbox 配置是否等于实际启用；excluded command 的安全地位；native Windows 行为；managed policy 失败和缓存；secret 是否进入模型、子进程和持久层；Plugin/Marketplace/MCP 是否有 publisher authenticity/signature guarantee；路径检查是否完整消除 TOCTOU。

不要总结整个仓库，不要读取 Graphify，不要修改任何文件。只报告会改变本章事实、安全实验或 clean-room Harness 契约的问题。每个问题给出路径、符号、决定性分支和影响；无法从快照确认的内容明确标出。

必须以下列三行开头：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后给出精简机制摘要、最危险的错误表述和仍无法确认的边界。
