# M23 FACT_A：独立源码盲审

完整读取 `D:\agent\Claude code最新\curriculum\units\M23\fact-gate-scope.md`，再独立阅读指定源码。不要读取 M23 工作簿、Graphify、Codex 结论、Harness、教材草稿或其他单元，不要修改文件。

重点反证：所有 Task 共享一个状态机；Work-item owner 已是 expiring lease；所有 Subagent 都随 parent cancel；Team 只是多个 Subagent；inbox `read` 等于业务 ack 且有 dedupe；scheduler PID lock/inFlight 已保证 exactly-once；shutdown 只是 leader abort child。

必须以下列三行开头：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

无 Issue 时仍给出支持 FACT_B 的精简机制摘要、最关键 crash/cancel 边界与无法确认项。
