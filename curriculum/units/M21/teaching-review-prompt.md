# M21 教学闸门

这是一个新的独立教学审查会话。不要读取 Graphify、Claude Code 源码、M21 工作簿、事实审查、Harness 实现、其他单元正文或历史聊天，也不要修改任何文件。

只读取：

1. `D:\agent\Claude code最新\2.md` 中学习者背景、教学深度、图文、实验、Harness、迁移与面试要求；
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`；
3. `D:\agent\Claude code最新\curriculum\units\M21\draft.md`。

M21 的目标是让 TypeScript 接近零基础、已有 Java/Python/Agent 应用经验的学习者，在 4--7 小时主体学习中真正理解 Skill/Plugin 从来源、发现、物化、命名、注册、请求快照到刷新/卸载的生命周期，并能把显式冲突、信任、不可变快照和 execution lease 迁移到自己的 Harness。

只报告会影响初学者理解、图文一致、实验有效性、Harness 契约或面试表达的实质问题。检查正文是否是连续认知旅程，是否在后续认知转折处就地给出足够的局部图，是否清楚区分快照事实和 H4-2 设计迁移，实验是否可推翻结论，以及面试回答是否像资深大厂 Agent 开发岗现场可说出的结论先行约两分钟回答。普通措辞和格式偏好不算 Issue。

必须以下列三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

若无实质问题，明确 `PASS / 0` 并简述为什么达到标杆；不要重写教材。
