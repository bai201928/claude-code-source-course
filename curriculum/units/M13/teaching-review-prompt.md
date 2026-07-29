# M13 独立教学闸门任务

你是一名独立的教材教学审查者，也是一名熟悉 Agent Harness、Context Pipeline 和 Provider 协议的互联网大厂资深面试官。请审查 M13 是否真正帮助 TypeScript/Node 基础较弱、但已有 Java、Spring、Python、Agent 和 RAG 经验的学习者建立从 durable conversation 到模型 wire request 的源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只读取学习者背景、教学深度、语言对照、实验、Harness、企业迁移、面试表达和最终验收标准。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`：用户已确认的 M11 质量标杆规则。
3. `D:\agent\Claude code最新\curriculum\units\M13\draft.md`。
4. 本提示词中的前置摘要、学习目标和运行上下文。

不要读取源码快照、Graphify、`unit-workbook.md`、`fact-review.md`、`fact-gate-*`、实验实现、`implementation-report.md`、其他教材、全局知识文件或历史审查输出。你不是事实闸门，不要重新调查仓库。不得修改任何文件。

## 必要前置摘要

- M10 已讲 durable message owner、identity、tool-use/result pairing 与 immutable snapshot。
- M11 已让学习者走过 REPL 与 SDK/Headless 两入口在 `query()` 汇合，再经过请求投影、模型、tool loop 与第二次请求的完整纵切。
- M12 已讲 Query Loop 的 pull、producer-local state、durable/UI owner、terminal 和取消；M13 不应重复整章控制流。
- M14 才完整讲 SSE、流式 assistant 聚合、重试、usage 和成本；M16-M18 才完整讲 Context view、snip/microcompact、autocompact、外置结果存储与 Prompt Cache edit。M13 应解释这些机制在请求链中的接口和顺序，但不能补造缺失实现或吞并后续专题。

## M13 学习目标

学习者完成主体后应能：

- 区分 durable conversation、`messagesForQuery`、`messagesForAPI` 与 wire params 四层对象；
- 沿一次运行解释 compact boundary、tool-result budget、snip/microcompact/collapse/autocompact 接口、user context、normalize、pairing 和 params 的顺序；
- 解释浅数组复制、独立 replacement state 和 request-local context 对所有权的影响；
- 把 `normalizeMessagesForAPI()` 理解为过滤、转换、合并、重排和校验的协议编译器；
- 解释 repair 与 strict 的产品取舍，不把 synthetic result 当真实执行；
- 运行 TypeScript/Python 实验，反证全局预算、无状态重算、投影改写 source 和错误 context 层位；
- 理解累计 Harness 的 merge/defer/reject 取舍，并迁移到 Java/Spring、RAG、LangGraph 和企业治理；
- 面对资深 Agent 开发岗追问时，用结论先行、口语化约两分钟回答，并承接源码、恢复、缓存和系统设计追问。

主体学习边界为 4 至 7 小时；双语言实验、破坏修改和深入挑战另计。

## 已知运行上下文

正文对应的验证结果：

```text
TypeScript M13 contract tests: 9 passed
TypeScript strict typecheck: passed
Python M13 unittest: 8 passed
M13 双语言 demo: passed
正文 Mermaid: 17/17 实际生成 SVG
累计 Harness: H2 4/4、H1 12/12、S0 15/15、Integrated Agent 4/4
TypeScript integrated Agent: 23/23
Python integrated Agent: 12/12
```

你只审查正文是否让学习者理解这些观察证明什么，以及命令、图、实验推理和 Harness 边界是否相互支持；不要读取实现或重新运行命令。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约、面试表达或 4 至 7 小时学习闭环的问题：

- 是否从真实请求差异问题推进，而不是函数名、图和知识点拼装；
- 四层对象及其 owner/mutation boundary 是否可独立复述；
- boundary、预算 state、user context、normalize、pairing 和 params 的因果顺序是否清楚；
- TypeScript 浅复制、Set/Map 可变性与 Java/Python 对照是否在改变机制的位置讲清；
- 章首总图后，重要认知转折是否有就近、可独立复习的局部图；
- 图的箭头、状态、所有权与正文陈述是否一致；
- 实验是否有预测、观察、反证和真实修错，而不只是测试通过；
- Harness 是否准确区分已合入的 per-result preview 与延后的 aggregate budget/replacement persistence；
- Java/Spring、RAG、LangGraph 和企业治理是否从当前机制自然推出；
- 8 道面试问题是否像资深岗位真实追问，答案是否第一句给结论、口语自然、约两分钟可组织，并能落到 Claude Code 与系统边界；
- 是否守住 M13 范围，没有完整提前 M14 或 M16-M18。

普通措辞偏好、标题形式、无现实影响的边缘漏洞和不影响学习的小缺失不得列为 Issue。

## 输出要求

必须以下列三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，每项给出正文定位、学习影响、为什么实质、最小修正方向。不要重写整章，不要建议新增固定栏目、题量或图量配额。如无实质问题，简述通过理由与剩余非阻断风险。

