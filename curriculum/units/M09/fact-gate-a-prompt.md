# M09 FACT_A 独立盲审提示词

你正在执行 M09 的事实闸门 A。请先完整读取：

```text
D:\agent\Claude code最新\curriculum\units\M09\fact-gate-scope.md
```

然后只读取其中指定源码根目录和官方 CHANGELOG 中与问题直接相关的文件。

这是独立盲审：你不知道 Codex 的研究结论，也不应猜测教材叙事。请从源码自行重建 turn cancellation、logical SessionEnd、process graceful shutdown 与 hard termination 的最小生命周期模型。

禁止修改文件，禁止读取或引用 Graphify，禁止读取 M09 的 `unit-workbook.md`、实现、草稿或历史审查，不要扩散到整个产品。只报告会影响事实正确性、实验设计、初学者生命周期理解或 Harness 契约的问题。

输出必须以以下三行开始：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后给出：

1. 启动注册与各运行表面退出/信号入口；
2. turn cancel、SessionEnd、process shutdown、hard termination 的边界；
3. `gracefulShutdownSync` 与首次调用 owner 的真实语义；
4. terminal、resume hint、cleanup、hooks、analytics、force exit 的顺序和预算；
5. cleanup registry 的并发、错误、超时和未完成 Promise 语义；
6. transcript flush、remote persistence suppression 与恢复边界；
7. clear/resume/exit 的 SessionEnd 差异；
8. Interactive/Headless/background/direct-exit/SIGKILL 的非对称与 bypass；
9. 快照事实、新版公开行为、推断和无法确认项；
10. 实质问题或建议验证目标。

每个实质问题必须给出源码路径、符号、理由和建议验证目标。不要报告格式偏好、理论漏洞、不会影响教材/Harness 的边缘问题，也不要要求本单元展开完整 Task、MCP、Hook、Transcript 或 Sandbox。
