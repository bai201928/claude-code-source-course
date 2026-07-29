# M08 教学闸门审查任务

你是一名独立的教材教学审查者。请以准备 2026 年中国互联网大厂 Agent 开发岗、具有 Java/Spring/Python/Agent/RAG 经验但 TypeScript/Node 基础较弱的学习者视角，审查 M08 是否真正建立“能力发现、请求投影与安全执行边界”的源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只用其学习者背景、教学深度、源码理解、实验、Harness、企业迁移和面试表达要求。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`：用户确认的 M11 质量标杆规则。
3. `D:\agent\Claude code最新\curriculum\units\M08\draft.md`。
4. 下面给出的前置摘要、学习目标与代码运行结果。

不要读取 `fact-review.md`、`fact-gate-*`、`unit-workbook.md`、Graphify、源码快照、implementation report、其他教材或历史审查结论。你不是事实闸门，不要重做全仓库调查。不得修改文件。

## 必要前置摘要

- M05 已区分 Interactive、Print、SDK/Headless 运行表面，表面负责输入输出适配，不能改写 Core 语义。
- M06 已建立带 revision 的不可变配置快照，并区分普通配置来源、flag 与 policy。
- M07 已区分 Bootstrap、RuntimeContext、SessionState 与 RequestContext，明确 live state、request snapshot 和显式 refresh 的边界。
- M08 应在这些边界上增加能力目录、请求/模型迭代投影、可执行注册表和系统上下文构建，不应重新发明平行状态系统。

## 学习目标

学习者完成后应能：

- 解释为什么 discovered、model-visible、permission-allowed 与 executable registration 不能合并为一个 `enabled`；
- 画出 Command、Skill、Agent、built-in Tool、MCP Tool 与 Plugin 从发现到当前请求可见的主要路径，并知道不同消费者没有统一的同名覆盖规则；
- 区分本地 runtime tool pool、API-visible schemas、deferred Tool Search 与执行时 handler 查找；
- 说明 Interactive 为何不等待慢 MCP，工具在何种安全边界进入下一模型迭代；
- 准确比较 Interactive 与 Headless 的工具刷新粒度，不把它们写成完全相同；
- 区分 default system prompt、custom replacement、append、systemContext、meta userContext 和 capability delta attachment；
- 解释 CLAUDE.md 在当前快照中为何不能笼统称为“直接拼进 system prompt”；
- 说明 schema cache、delta attachment 与 Plugin materialization/activation 各自可能造成的陈旧视图；
- 运行 TypeScript/Python clean-room，观察 catalog revision、projection reason、immutable snapshot、deferred discovery 与 fail-closed dispatch；
- 把 M06/M07 接入 H1 的 CapabilityCatalog、CapabilityProjector、CapabilitySnapshot、ExecutableRegistry 与 SystemContextBuilder；
- 迁移到 Java/Spring、RAG 和 LangGraph，并设计 tenant/policy/model 投影、revision、trace、灰度与紧急撤权；
- 用结论先行、口语化约两分钟回答资深 Agent 开发岗相关追问。

主体学习时间为 4 至 7 小时，双语言实验、破坏与企业练习另计。M08 不应提前完整展开 Permission、MCP wire protocol、Plugin marketplace、Agent execution、Transcript 或 M09 生命周期清理。

## 已知实验与图示结果

- M08 独立 TypeScript 8/8、Python 8/8，TypeScript strict 通过；
- H1-in-progress 10/10，保留 S0 15/15 和 M05-M07 回归；
- H1 `CapabilitySnapshot` 保留 catalog revision、boundary、mode、provider 与 model，TypeScript/Python capability tests 各 6/6；
- 正文 14/14 Mermaid 图已实际渲染成功，并对过宽的工具池与 delta 图做了可读性修正；
- 正文包含 9 道资深 Agent 开发岗问题，每题给出结论先行的口语回答。

你需要审查正文是否让学习者知道这些结果证明什么，不要重新执行命令。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约或 4 至 7 小时学习闭环的问题：

- 是否由 Read、Deploy、Search 在两次请求中的可见性变化持续推进，而不是把 Command、Skill、Agent、Tool、MCP 和 Plugin 拼成目录；
- 五层能力模型和不同消费者的同名解析差异，是否能被学习者独立复述与画出；
- runtime pool、request projection、Tool Search、permission 与 registry dispatch 是否真正分开，是否避免把模型可见误写成授权；
- Interactive/Headless 刷新边界、慢 MCP 时序与旧 snapshot 是否讲清，是否避免“启动清单永久冻结”或“异步更新立即污染当前流”的极端结论；
- prompt replacement/append、system/meta-user channel、CLAUDE.md 和 delta attachment 是否在改变语义处讲清；
- schema cache 与 Plugin 激活是否形成可操作的状态模型，而不是只列源码名；
- 14 张图是否在认知转折处帮助首次理解与复习，方向、术语、状态、正常/失败路径和正文是否一致；
- TypeScript/Python 实验是否有假设、反证、破坏与结论边界，不用“测试通过”替代理解；
- H1 是否自然承接 M06/M07，并明确新增契约、owner、失败语义、兼容边界与可观测字段；
- Java/Spring、RAG、LangGraph、灰度、撤权和 observability 是否由当前机制自然推出；
- 面试问题是否像资深面试官追问，回答是否第一句给结论、约两分钟可口述、能承接源码与系统设计追问。

普通措辞偏好、标题形式、不影响学习的小缺失、完整 Permission/MCP/Plugin/Transcript 实现和理论漏洞不得列为 Issue。

## 输出要求

输出必须以以下三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，每项给出定位、学习影响、为什么实质、最小修正方向。不要重写整章，不要建议新增固定栏目或配额。如无实质问题，给出简短通过理由和剩余非阻断风险。
