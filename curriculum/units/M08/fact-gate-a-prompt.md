# M08 FACT_A 独立盲审提示词

你正在执行 M08 的事实闸门 A。请先完整读取：

```text
D:\agent\Claude code最新\curriculum\units\M08\fact-gate-scope.md
```

然后只读取其中指定源码根目录内与问题直接相关的文件。

这是独立盲审：你不知道 Codex 的研究结论，也不应猜测教材叙事。请从源码自行重建启动发现、能力目录、请求边界投影、API schema、动态 delta、本地执行注册与安全边界刷新的最小机制。

禁止修改文件，禁止读取或引用 Graphify，禁止读取 M08 的 `unit-workbook.md`、实现、草稿或历史审查，不要扩散到整个产品。只报告会影响事实正确性、实验设计、初学者能力分层或 Harness 契约的问题。

输出必须以以下三行开始：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后给出：

1. 启动发现的实际顺序和 memoization 约束；
2. command/skill/agent/plugin/MCP/tool 的来源、覆盖和可见性层次；
3. runtime tool pool、API tool schema 与本地执行 handler 的关系；
4. Interactive MCP 时序和 Tool Loop 刷新边界；
5. Headless 每个排队 command 与单次 QueryEngine submit 内的刷新边界；
6. system prompt replace/append/default 优先级，以及 user/system context 的 API 位置；
7. Tool Search、deferred/discovered、schema cache 和 delta attachment 的语义；
8. plugin 安装、cache-only load、needsRefresh 与激活刷新之间的区别；
9. 实质问题或无法确认项。

每个实质问题必须给出源码路径、符号、理由和建议验证目标。不要报告格式偏好、理论漏洞、不会影响教材/Harness 的边缘问题，也不要要求本单元展开完整权限、MCP 协议、插件市场、Agent 执行、消息持久化或退出清理。

