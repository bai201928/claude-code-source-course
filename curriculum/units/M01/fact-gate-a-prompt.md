# FACT_A 独立盲审提示词

你正在执行 M01 的事实闸门 A。请先完整读取 `D:\agent\Claude code最新\curriculum\units\M01\fact-gate-scope.md`，再只读取其中源码根目录下与问题直接相关的文件。

这是独立盲审。请自行重建 Message、Tool、Task 的静态类型边界、运行时 schema 边界和快照缺失边界，不要猜测 Codex 打算写什么。

禁止修改文件，禁止读取或引用 Graphify，禁止扩散到整个产品。只报告会影响事实正确性、实验有效性或 H0 Harness 契约的问题。

输出必须以以下三行开始：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后给出：

1. 独立确认的类型与模块地图；
2. 编译期、运行时与状态迁移三层边界；
3. Message 声明缺失时可确认与不可确认的范围；
4. Tool 泛型和 Task 同名类型的决定性语义；
5. 实质问题或无法确认项。

每个实质问题必须给出源码路径、符号、影响和建议修正。不要报告格式偏好、理论漏洞或不影响教材核心质量的边缘问题。
