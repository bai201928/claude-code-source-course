# FACT_A 独立源码盲审

请读取 `D:\agent\Claude code最新\curriculum\units\M04\fact-gate-scope.md`，严格按其中范围独立审查 `D:\agent\Claude code最新\claude-code-CLI` 当前静态快照。

不要读取 M04 的工作簿、代码、draft、Graphify、其他审查输出或作者结论。不要修改任何文件。

输出必须以三行开始：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

只报告影响事实正确性、代表性实验或 H0 追踪契约的问题。普通重构建议、防御性漏洞、无教学影响的边缘分支和格式问题不得列为实质 Issue。
