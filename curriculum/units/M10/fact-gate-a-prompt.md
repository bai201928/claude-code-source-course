# M10 FACT_A 独立盲审提示词

你正在执行 M10 的事实闸门 A。请先完整读取：

```text
D:\agent\Claude code最新\curriculum\units\M10\fact-gate-scope.md
```

然后只读取其中列出的源码根目录与直接相关文件。

这是独立盲审：你不知道 Codex 的研究结论，也不应猜测教材叙事。请从源码自行重建消息 owner、容器/元素别名、identity、tool pairing、durability 与恢复边界。

禁止修改文件，禁止读取或引用 Graphify，禁止读取 M10 的 `unit-workbook.md`、实现、草稿或历史审查，不要扩散到整个产品。只报告会影响事实正确性、实验设计、初学者消息心智模型或 Harness 契约的问题。

输出必须以以下三行开始：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后给出：

1. Interactive 与 Headless 的 owner 和引用变化；
2. 一次 turn 浅快照的真实保证与 element mutation；
3. 可确认的 message family及缺失类型文件边界；
4. 各类身份字段的职责与不能互换的理由；
5. human turn 与 user-role tool result的区别；
6. progress/attachment 的内存、SDK、API 与 transcript差异；
7. tool use/result pairing与 strict/repair 边界；
8. parent chain、并行 tool result、cycle 与 legacy progress恢复；
9. 快照事实、无法确认项和适合迁移的 Harness 不变量；
10. 实质问题或建议验证目标。

请特别核对而不要预设答案：slash command调用 `setMessages` 后是否仍与 `print.ts mutableMessages` 共享同一数组；progress 相关注释与实际 filter/load链是否一致；`isHumanTurn` 是否足以覆盖所有 tool-result历史形状。

每个实质问题必须给出源码路径、符号、理由和建议验证目标。不要报告普通措辞、无学习影响的小漏洞，也不要要求本单元展开 M11-M15 或完整 Transcript 专题。
