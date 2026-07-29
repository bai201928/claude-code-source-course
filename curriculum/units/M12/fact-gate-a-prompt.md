# FACT_A 独立盲审提示词

你正在执行 M12 的事实闸门 A。请先完整读取 `fact-gate-scope.md`，然后只读取其中指定源码根目录内与问题直接相关的文件。

这是独立盲审：你不知道 Codex 的研究结论。请从源码自行重建 `query()` / `queryLoop()` 的 generator 委托、入口消费者、模型与工具的嵌套流、跨迭代 state、yield 前后提交顺序，以及正常完成、取消、错误和 consumer close 的差异。

禁止修改文件，禁止读取或引用 Graphify，禁止扩散审查到 Context、API streaming 或 Tool Permission 的完整专题。只报告会影响事实正确性、实验设计或 Harness 行为契约的问题。

输出必须以以下三行开始：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后给出：

1. generator 与消费者的精简控制链；
2. producer local state 与 outer durable/UI state 的所有权；
3. 代表性 yield/continue/return 顺序；
4. 取消、throw 与 consumer close；
5. 实质问题或无法确认项。

每个实质问题必须给出源码路径、符号、理由和建议验证目标。不要报告格式偏好、理论漏洞或不影响教材核心质量的边缘问题。

