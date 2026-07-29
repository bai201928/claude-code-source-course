# FACT_A 独立盲审提示词

请完整读取 `D:\agent\Claude code最新\curriculum\units\M02\fact-gate-scope.md`，并按其范围独立研究源码。禁止读取 Graphify、M02 工作簿、草稿、代码实验或历史结论，禁止修改文件。

输出必须以三行开始：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后给出 generator 生产/消费链、yield/return/throw/close 语义、缓冲与背压边界、实质问题和无法确认项。不要报告格式偏好或无现实影响的理论漏洞。
