# M22 教学闸门

新建独立教学审查会话。不要读取 Graphify、源码、M22 工作簿/事实审查/Harness、其他单元或历史聊天，不要修改文件。

只读取：`D:\agent\Claude code最新\2.md`、`curriculum\design\benchmark-rules.md`、`curriculum\units\M22\draft.md`。

学习者 TypeScript 接近零基础，已有 Java/Python/Agent/RAG 应用经验。M22 应在 4--7 小时主体内沿一次 MCP 运行讲清 transport、initialize、capability negotiation、Tool/Resource/Prompt、schema/Permission、安全提示、notification、snapshot、disconnect、cancel、retry/idempotency，并让学习者能把 session generation/revision 迁移到 Harness。

只报告影响初学者理解、事实/设计边界、图文一致、实验有效性、Harness 契约或面试表达的实质问题。重点检查是否错误暗示本地取消能回滚远端、重试 exactly-once、annotations 可信、connected 即目录成功，或 H4-3 手写 wire protocol。普通措辞/格式不算 Issue。

必须以三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

无实质问题时明确 PASS / 0，并简述图、实验、迁移和约两分钟面试回答为何达到标杆；不要重写教材。
