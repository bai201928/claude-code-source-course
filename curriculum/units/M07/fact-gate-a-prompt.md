# M07 FACT_A 独立盲审提示词

你正在执行 M07 的事实闸门 A。请先完整读取：

```text
D:\agent\Claude code最新\curriculum\units\M07\fact-gate-scope.md
```

然后只读取其中指定源码根目录内与问题直接相关的文件。

这是独立盲审：你不知道 Codex 的研究结论，也不应猜测作者拟写入教材的叙事。请从源码自行重建模块加载、Bootstrap、`init/setup`、Interactive/Headless AppState store、React 订阅、请求实时读取/快照以及 AppState 变更副作用的最小机制。

禁止修改文件，禁止读取或引用 Graphify，禁止读取 M07 的 `unit-workbook.md`、实现、草稿或历史审查，不要扩散到整个产品。只报告会影响事实正确性、实验设计、初学者状态所有权模型或 Harness 契约的问题。

输出必须以以下三行开始：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后给出：

1. 独立确认的初始化时序；
2. Bootstrap 与 AppState 的创建、生命周期和 owner；
3. Interactive、Headless 与临时 Provider 的关系；
4. store 的提交、observer、subscriber、异常和取消订阅语义；
5. React selector、闭包、fresh read 与 request snapshot 的边界；
6. AppState 更新的外部副作用；
7. 实质问题或无法确认项。

每个实质问题必须给出源码路径、符号、理由和建议验证目标。不要报告格式偏好、理论漏洞、不会影响教材/Harness 的边缘问题，也不要要求本单元展开完整消息、权限、MCP、Task 或退出清理机制。

