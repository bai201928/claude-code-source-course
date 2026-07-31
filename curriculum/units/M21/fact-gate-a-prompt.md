# M21 FACT_A：独立源码盲审

请完整读取：

D:\agent\Claude code最新\curriculum\units\M21\fact-gate-scope.md

然后独立审查其中给出的源码。不要读取 Graphify、M21 工作簿、Codex 结论、Harness、教材草稿或其他单元，不要修改文件。

重点反证五种常见误写：Skill 文件直到调用才读取；frontmatter valid 就等于可信；plugin version/cache 就等于签名完整性；namespace 保证全局无冲突；reload 是跨 commands/agents/hooks/MCP/LSP 和 in-flight request 的单一原子事务。

必须以下列三行开头：

~~~text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
~~~

无 Issue 时仍给出足以支撑 FACT_B 的机制摘要和无法确认项。
