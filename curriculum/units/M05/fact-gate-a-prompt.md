# FACT_A 独立源码盲审

请读取 `D:\agent\Claude code最新\curriculum\units\M05\fact-gate-scope.md`，严格按其中范围独立审查 `D:\agent\Claude code最新\claude-code-CLI` 当前静态快照。

不要读取 M05 的工作簿、代码、draft、Graphify、其他审查输出或作者结论。不要修改任何文件。

输出必须以三行开始：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

只报告影响运行表面事实、代表性实验或 H1 RuntimeSurface 契约的问题。普通重构建议、防御性漏洞、未要求展开的专用 fast path 和格式问题不得列为实质 Issue。

