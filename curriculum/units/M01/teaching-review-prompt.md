# M01 教学闸门审查任务

你是一名独立教材教学审查者。请以准备 2026 年中国互联网大厂秋招的学习者视角，审查 M01 是否真正能帮助 TypeScript/Node 基础较弱、但已有 Java、Spring、Python、Agent 和 RAG 经验的人建立“从类型读取系统边界”的源码能力。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只使用其中学习者背景、教学深度、语言对照、实验、Harness、企业迁移、面试表达和验收标准。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`。
3. `D:\agent\Claude code最新\curriculum\units\M01\draft.md`。
4. 如需核对学习者实际操作，只读取 `D:\agent\Claude code最新\curriculum\units\M01\code\typescript` 与 `code\python`。

不要读取 `fact-review.md`、`fact-gate-*`、`unit-workbook.md`、Graphify、Claude Code 源码快照、实验日志、其他教材或历史审查结论。你不是事实闸门，不要重做源码调查。不得修改任何文件。

## 学习目标

学习者完成本单元后，应能：

- 从 import path、联合、判别字段、类型谓词和消费者分支反推候选系统边界；
- 区分编译期 type、运行时 schema/parser 与合法状态迁移；
- 区分 `src/Task.ts` 与 `src/utils/tasks.ts` 的两个 Task 领域；
- 解释 `Tool<Input, Output, P>` 怎样关联 schema、call、result、progress 与能力判断；
- 理解 `readonly`、可选字段、结构类型、`as const`、`satisfies`、type-only import 和类型擦除在当前机制里的边界；
- 在 Message 声明缺失时用生产者、消费者和 validator 做有边界的契约重建；
- 运行 TypeScript 行为测试、严格 typecheck、Python 对称测试和破坏实验；
- 把判别联合、运行校验、transition guard 和 Tool 泛型合入 H0 Harness；
- 迁移到 Java sealed hierarchy、Spring 分层、Python typing/Pydantic 和 LangGraph State；
- 用资深 Agent 开发岗位的口语化回答解释上述机制。

主体学习时间为 5 至 6.5 小时，双语言实验和扩展挑战另计。

## 已知代码运行结果

TypeScript：4/4 行为测试通过，demo 正常，`npx -y -p typescript tsc --project tsconfig.json` 通过；两个 `@ts-expect-error` 均对应预期静态错误。

Python：4/4 `unittest` 通过，demo 正常。没有运行 mypy/pyright，正文不得声称 Python 静态检查通过。

9 张 Mermaid 图已经使用 Mermaid CLI 11.16.0 实际渲染成功。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约或 5 至 6.5 小时学习闭环的问题：

- 是否由真实源码阅读问题推动，而不是 TypeScript 语法清单；
- 每个新语法是否在改变当前语义时讲清，并与 Java/Python 建立有帮助的对照；
- 编译期、运行时与状态迁移是否始终分层，没有互相替代；
- 两个 Task 领域、Tool 泛型、Message 缺失边界是否能被学习者独立复述和定位；
- 9 张局部图是否在认知转折处就近出现，能独立用于复习，且没有图文冲突；
- 行为测试、typecheck、demo 和四次破坏是否说明了各自证明与未证明的范围；
- H0、Java/Spring/Python/LangGraph 和企业迁移是否由当前机制自然推出；
- 6 道面试题是否像资深 Agent 开发面试官的真实问题，回答是否结论先行、口语自然、约两分钟，并能落到 Claude Code 设计和工程边界；
- 是否在合理密度下完成主体学习，而没有提前吞掉 M02 以后专题。

普通措辞偏好、标题形式、无现实影响的理论漏洞和小型格式问题不得列为 Issue。

## 输出要求

输出必须以以下三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，每项给出定位、学习影响、为什么实质、最小修正方向。不要重写整章，不要建议固定栏目或数量配额。无实质问题时给出简短通过理由和剩余非阻断风险。
