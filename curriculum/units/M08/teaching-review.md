# M08 教学闸门记录

状态：`teaching-reviewed`

审查会话：`c5fefc03-6651-4bfb-8b1f-c1c6c06ecaae`

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

## 通过依据

- 正文由 Read、Deploy、Search 在两次请求中的可见性变化持续驱动，没有退化成 Command、Skill、Agent、Tool、MCP 与 Plugin 的目录拼装。
- discovery、runtime pool、policy/request projection、API schemas 与 registry dispatch 的边界清楚，模型可见没有被误写成授权或本地可执行。
- command 不同消费者的同名解析、Interactive/Headless 刷新差异、慢 MCP 与不可变旧 snapshot 均形成了可以复述和画出的运行模型。
- default/custom/append prompt、system context、meta user context 与 capability delta attachment 分开表达，CLAUDE.md 没有被笼统描述为直接拼入 system prompt。
- 14 张图分布在启动发现、同名解析、工具池、刷新、prompt、Tool Search、delta、Plugin 激活和 Harness 集成等认知转折处；全部实际渲染成功，且两张过宽图已经调整为可读布局。
- 双语言实验包含假设、反证、代表性破坏和结论边界；TypeScript/Python 各 8/8，H1 capability tests 各 6/6，累计回归 10/10 且保留 S0 15/15。
- H1 的五个能力角色自然承接 M06 配置 revision 与 M07 状态/request snapshot，没有建立平行示例系统；CapabilitySnapshot 还保留 boundary、mode、provider 和 model 供请求与执行追踪对齐。
- Java/Spring、RAG、LangGraph、灰度、紧急撤权与可观测性都由能力投影和控制面/数据面边界自然推出。
- 9 道资深 Agent 开发岗问题均结论先行，以口语化回答连接 Claude Code 决定性机制、失败边界和企业系统设计。

## 非阻断风险

- Command 数组来源与各消费者的不同去重规则需要学习者回看局部图巩固，但正文、图和源码锚点已经足以完成当前闭环。
- Plugin 状态机没有展开每一项 cache 清理和组件重载细节；这不影响“物化不等于当前进程激活”的核心理解，完整内部机制留给后续 Plugin 专题。

以上两项不影响事实正确性、初学者理解、实验有效性或 Harness 契约，不阻断进入 `release-candidate`。
