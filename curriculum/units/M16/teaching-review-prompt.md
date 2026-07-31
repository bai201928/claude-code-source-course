# M16 独立教学闸门任务

你是一名独立的教材教学审查者，也是一名熟悉 Agent Harness、Context Pipeline、Prompt Cache、并发状态、恢复和企业 RAG 治理的互联网大厂资深面试官。请审查 M16 是否真正帮助 TypeScript/Node 基础较弱、但已有 Java、Spring、Python、Agent 和 RAG 经验的学习者，建立“完整历史如何被投影为一次模型请求”的源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只读取学习者背景、教学深度、语言对照、实验、Harness、企业迁移、面试表达和最终验收标准。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`：用户已确认的 M11 质量标杆规则。
3. `D:\agent\Claude code最新\curriculum\units\M16\draft.md`。
4. 本提示词中的前置摘要、学习目标和运行上下文。

不要读取源码快照、Graphify、`unit-workbook.md`、`fact-review.md`、`fact-gate-*`、实验实现、`implementation-report.md`、Harness 源码、其他教材、全局知识文件或历史审查输出。你不是事实闸门，不要重新调查仓库。不得修改任何文件。

## 必要前置摘要

- M10 已讲 durable message owner、identity、tool-use/result pairing 与 immutable snapshot。
- M11 已让学习者走过用户输入、请求投影、模型、Tool Loop 和第二次请求的完整纵切。
- M12 已讲 AsyncGenerator pull、producer-local state、durable/UI owner、terminal、abort、close 和 throw。
- M13 已讲 durable/query/API/wire 四层请求投影与 strict pairing，并实现 per-result preview。
- M14 已讲 streamed block、Provider boundary、usage 与 bounded stream。
- M15 已讲并行 Tool Scheduler、ordered publication、Permission 和 exactly-once paired results。
- M17 才系统讲 full compact summary transaction、commit point、取消与恢复；M18-M19 再讲指令和 Memory。M16 只闭合 summary 之前的 Context view、预算与轻量裁剪。

## M16 学习目标

学习者完成主体后应能：

- 区分 durable history、`messagesForQuery`、normalized API messages 和 Provider wire payload 的 owner 与语义；
- 解释最后 compact boundary 为什么是 read projection，以及浅复制为何仍可能污染嵌套内容；
- 区分消息创建前的 per-tool persistence 与请求阶段的 aggregate final-group budget；
- 解释为什么 progress、attachment 和同 response ID fragments 不能错误拆分 tool-result group；
- 区分 fresh、frozen、reapplied replacement，解释 exact preview 对 Prompt Cache 和 resume 的意义；
- 准确限定 cache-sharing fork、AgentTool resume 与 teammate 的不同 state provision；
- 分开字符、估算 token、API usage、message group 和 wire payload，不把启发式预算冒充硬窗口；
- 沿 snip、cached/time-based microcompact、context collapse、autocompact、blocking check 走完可确认的顺序，并识别缺失 feature 模块和 cached-MC gate 缺口；
- 解释 attachment 为什么必须在全部 tool results 后加入，以及 request-only `prependUserContext()` 为什么 model-visible 但不写回 Query state；
- 运行 TypeScript/Python 实验，用反证验证 orphan suffix、aggregate overage、copy-on-write、byte-stable replacement、strict-before-commit 和 stale writer rejection；
- 准确描述 Harness H3-1 的 merge/defer/reject 边界，不把 clean-room revision ledger 冒充快照实现；
- 把机制迁移到 Java/Spring、RAG、LangGraph 和企业 Context 治理；
- 面对资深 Agent 开发岗追问时，用结论先行、口语化约两分钟回答，并能承接源码和系统设计追问。

主体学习边界为 4 至 7 小时；双语言实验、破坏修改和深入挑战另计。

## 已知运行上下文

正文对应的验证结果：

```text
M16 TypeScript independent context budget: 8/8
M16 Python independent context budget: 8/8
M16 TypeScript strict typecheck: passed

Harness TypeScript Runtime: 27/27
Harness TypeScript Provider/Tool/Scheduler/Stream: 21/21
Harness Python Agent/Scheduler/Stream: 24/24
Harness Python ConversationStore: 13/13
H2/H1/S0 and integrated cumulative regressions: passed

Mermaid render from complete draft: 15/15
```

你只审查正文是否让学习者理解这些观察证明什么，以及命令、图、实验推理和 Harness 边界是否相互支持；不要读取实现或重新运行命令。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约、面试表达或 4 至 7 小时学习闭环的问题：

- 是否从“完整历史存在但模型只见请求投影”的真实矛盾推进，而不是 Context 函数目录；
- durable/query/API/wire 四层 owner 是否能被独立复述；
- history boundary、shallow copy、copy-on-write 与 strict post-validation 是否不会混淆；
- per-tool persistence 和 aggregate group budget 的时点、owner、单位与失败语义是否清楚；
- final group 边界是否解释到 progress、attachment、same-response fragment 和 excluded/self-bounded overage；
- replacement state 是否讲清 stable prefix、fresh/frozen/reapply、fork/resume/teammate 差异和可变 Map 的并发边界；
- char/token/API usage/group/wire 是否严格分层；
- snip/microcompact/collapse/autocompact 是否准确守住可见接口和 M17 边界，快照缺口有没有被误包装为推荐设计；
- request-only user context、attachment 时点和 cache edit 的位置是否可画出且不会与 durable state 混淆；
- TypeScript spread/Readonly/Map/Set/await 与 Java/Python 对照是否在真正改变机制的位置讲清；
- 章首总图后，重要认知转折是否有就近、可独立复习的局部图；15 张图的箭头、状态、所有权与正文是否一致；
- 实验是否有预测、观察、反证、破坏和修复，而不只是测试通过；
- Harness H3-1 是否准确区分快照事实、运行验证和 revision ledger 设计迁移，以及 merge/defer/reject 边界；
- Java/Spring、RAG、LangGraph 和企业迁移是否从当前 owner、预算、提交点和失败语义自然推出；
- 7 道面试题是否像资深岗位真实追问，回答是否第一句给结论、口语自然、约两分钟可组织，并能落到 Claude Code 与工程边界；
- 是否守住 M16 范围，没有提前吞并完整 compact transaction、Transcript 恢复、Instructions 或 Memory。

普通措辞偏好、标题形式、无现实影响的边缘漏洞和不影响学习的小缺失不得列为 Issue。

## 输出要求

必须以下列三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，每项给出正文定位、学习影响、为什么实质、最小修正方向。不要重写整章，不要建议新增固定栏目、题量或图量配额。如无实质问题，简述通过理由与剩余非阻断风险。
