# M18 FACT_A 独立审查任务

你是独立 Claude Code 源码事实审查者。只读取：

1. `D:\agent\Claude code最新\curriculum\units\M18\fact-gate-scope.md`
2. 其中指定的源码快照

不要读取工作簿、教材、Graphify、实验、Harness 或其他审查。不得修改文件。请独立闭合调用链、状态 owner、顺序、trust、缓存、取消和失败边界，只报告影响教材事实、实验或 H3-3 的问题。

输出必须以三行开头：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后给出经过核验的结论、源码符号与必要修正。
