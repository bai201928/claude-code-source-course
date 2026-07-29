# M09 FACT_B 结果重发提示词

请只重发你在上一轮已经完成的 M09 FACT_B 最终审查结论，不重新扫描源码，不新增分析。

输出必须仍以以下三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后原样重述上一轮的实质 Issue；如果没有实质问题，明确写 `No material issues`。
