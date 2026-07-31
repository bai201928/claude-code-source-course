# M22 FACT_A：独立源码盲审

完整读取 `D:\agent\Claude code最新\curriculum\units\M22\fact-gate-scope.md`，再独立阅读指定源码。不要读取 M22 工作簿、Graphify、Codex 结论、Harness、草稿或其他单元，不要修改文件。

重点反证：connect 成功等于所有能力目录成功；MCP JSON Schema 在本地 Zod 层完整验证；annotations 可直接信任；onclose callback 自动 reject pending request；timeout/abort 等于远端副作用取消；session retry 天然 exactly-once；Claude Code client 声明 sampling。

必须以下列三行开头：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

无 Issue 时仍给出支持 FACT_B 的精简机制摘要与无法确认项。
