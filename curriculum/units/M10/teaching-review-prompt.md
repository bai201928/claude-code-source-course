# M10 教学闸门审查任务

你是一名独立的教材教学审查者。请以准备 2026 年中国互联网大厂 Agent 开发岗、具有 Java/Spring/Python/Agent/RAG 经验但 TypeScript/Node/React 基础较弱的学习者视角，审查 M10 是否真正建立“消息所有权、请求快照、身份分层、持久化平面和工具配对”的源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只用其学习者背景、教学深度、源码理解、实验、Harness、企业迁移、面试表达和验收要求。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`：用户确认的 M11 质量标杆规则。
3. `D:\agent\Claude code最新\curriculum\units\M10\draft.md`。
4. 下面给出的必要前置、学习目标与已知运行结果。

不要读取 `fact-review.md`、`fact-gate-*`、`unit-workbook.md`、Graphify、源码快照、implementation report、其他教材或历史审查结论。你不是事实闸门，不要重做全仓库源码调查。不得修改文件。

## 必要前置摘要

- M01 已讲 TypeScript discriminated union、runtime validation 与“类型声明不能替代边界校验”。
- M02-M04 已讲异步事件、owner/observer/turn view，以及数组 view 不随 owner 后续 append 增长。
- M05 已区分 Interactive 与 SDK/Headless runtime surface。
- M07 已建立 RuntimeContext、SessionStateStore、RequestContext 与 revisioned snapshot 的基本边界。
- M09 已讲 Set/Map identity、生命周期所有权和有预算收尾。
- M10 应聚焦消息 owner、浅快照、身份、domain kind、durable/ephemeral、tool pairing 和 H2 ConversationStore，不应重复 M11 的完整用户输入到模型纵切，不应提前完整展开 M12 Query Loop、M13 Context/API normalization、M15 工具调度或后期 Transcript/fork/compact。

## 学习目标

学习者完成后应能：

- 区分 REPL `messagesRef` owner 与 React render state，以及 Headless `print.ts mutableMessages` 与 QueryEngine 字段的别名边界；
- 解释数组 spread 固定什么、不固定什么，并用 stream late mutation 说明 shallow view 的后果；
- 区分 envelope UUID、provider response ID、tool-use ID、Transcript parent 与 SDK session/tool-parent ID；
- 说明 provider role 为什么不是完整领域类型，human input 与 user-role tool result 为什么必须分开；
- 区分 internal memory、provider API、SDK event 和 durable Transcript 四个平面；
- 解释 progress/attachment 的不同投影，以及并行工具为何形成需要恢复补偿的 DAG；
- 判断 missing、orphan、duplicate、gap tool result 在什么边界失败；
- 运行、破坏并修复 TypeScript/Python ConversationStore 实验；
- 把单 owner、expected revision、immutable publication、ephemeral progress 和 fail-closed pairing 接入 H2；
- 迁移到 Java/Spring、RAG、LangGraph 和企业级存储/幂等/可观测性；
- 用结论先行、口语化约两分钟回答资深 Agent 开发岗相关追问。

主体学习时间为 4 至 7 小时，双语言运行、破坏实验和企业方案另计。

## 已知实验与图示结果

- M10 独立 TypeScript ConversationStore `10/10`，strict typecheck 通过；Python `11/11`；
- demo 显示旧 turn view 保持 revision 1 与三个成员，owner 在 tool result 后前进到 revision 2 与四个成员，progress 不推进 durable revision；
- 累计 H2-in-progress `4/4`，完整包含 H1 `12/12` 与 S0 `15/15`；
- 正文 `12/12` Mermaid 图已用 Mermaid CLI `11.16.0` 实际渲染并逐图查看；别名重绑定与 SDK identity 图在视觉检查后已定向修正并再次全量渲染；
- 正文包含 8 道资深 Agent 开发岗问题，每题给出结论先行、可在约两分钟内口述的回答。

你需要审查正文是否让学习者知道这些结果证明什么，不要重新执行命令。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约或 4 至 7 小时学习闭环的问题：

- 是否由“一条消息为什么不能只是聊天文本和一个共享数组”持续推进，而不是把类型、ID、表格和函数拼成目录；
- REPL ref/state 与 Headless alias/rebind 是否能被学习者独立复述，且没有把条件式静态边界写成已复现产品 bug；
- shallow array view、readonly、freeze、deep clone 和 stream late mutation 是否在改变语义处讲清；
- 多类 ID、role/domain kind、四个消息平面、progress/attachment 和并行 DAG 是否由局部图与源码解释形成可复习心智模型；
- pairing 的 store-valid/request-ready、repair/fail-closed 与 strict/non-strict 边界是否清楚；
- 双语言实验是否有假设、反证、代表性破坏和结论边界，不用“测试通过”替代理解；
- H2 是否自然承接 H1，并明确新增 owner、revision、失败语义、兼容边界和未实现范围；
- Java/Spring、RAG、LangGraph、事务、幂等、outbox、隐私与可观测性是否由当前机制自然推出；
- 12 张图是否分布在认知转折处，方向、标签、所有权和正文一致；
- 8 道面试题是否像资深面试官追问，回答是否第一句给结论、机制准确、口语自然并能承接源码和系统设计追问；
- 教学密度是否足以支撑主体 4 至 7 小时，又没有完整提前后续 M11-M15 或 Transcript 专题。

普通措辞偏好、标题形式、不影响学习的小缺失、无现实影响的理论漏洞和要求完整展开后续单元不得列为 Issue。

## 输出要求

输出必须以以下三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，每项给出：定位、学习影响、为什么实质、最小修正方向。不要重写整章，不要建议新增固定栏目或配额。如无实质问题，给出简短通过理由和剩余非阻断风险。
