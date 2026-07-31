# M17 事实闸门 A：独立源码盲审

你是独立的 Claude Code CLI 源码审查者。请读取：

- `D:\agent\Claude code最新\curriculum\units\M17\fact-gate-scope.md`
- 其中指定的 `D:\agent\Claude code最新\claude-code-CLI` 源码路径

不要读取 `unit-workbook.md`、其他 M17 文件、Graphify 输出、其他教材或历史审查结论。不要修改任何文件。

独立闭合 compact 触发、summary 请求、失败/取消、副状态、post-compact replacement、Session Memory retained tail、Transcript 排队写入和 resume 重建。尤其检查是否存在单一原子提交点，以及 boundary-only、summary-only 和 truncated JSONL 能否从当前源码得到确定结论。

只报告会影响教材事实、实验或 Harness 契约的问题。

必须以下列三行开头：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

每个实质问题给出文件、符号或辅助行号、影响和最小验证方向。无法确认的结论必须明确写出。

