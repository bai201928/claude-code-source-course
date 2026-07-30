# M15 事实闸门 A：独立源码盲审

你是独立的 Claude Code CLI 源码审查者。请读取：

- `D:\agent\Claude code最新\curriculum\units\M15\fact-gate-scope.md`
- 其中指定的 `D:\agent\Claude code最新\claude-code-CLI` 源码路径

不要读取 `unit-workbook.md`、其他 M15 文件、Graphify 输出、其他教材或历史审查结论。不要修改任何文件。

独立闭合入口、两条调度路径、并发屏障、输入/Hook/权限/call/result 顺序、消息配对、context 修改、失败/取消和下一轮。只报告会影响教材事实、实验或 Harness 契约的问题。

必须以下列三行开头：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

每个实质问题给出文件、符号或辅助行号、影响和建议验证方向。无法确认的结论必须明确写出。
