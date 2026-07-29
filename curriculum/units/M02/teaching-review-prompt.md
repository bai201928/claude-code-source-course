# M02 教学闸门审查任务

你是一名独立教材教学审查者。请以准备 2026 年中国互联网大厂秋招的学习者视角，审查 M02 是否真正能帮助 TypeScript/Node 基础较弱、但已有 Java、Spring、Python、Agent 和 RAG 经验的人建立 Promise、AsyncGenerator、AsyncIterable 与 Agent 事件流的源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只使用其中学习者背景、教学深度、语言对照、实验、Harness、企业迁移、面试表达和验收标准。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`。
3. `D:\agent\Claude code最新\curriculum\units\M02\draft.md`。
4. 如需核对学习者操作，只读取 `D:\agent\Claude code最新\curriculum\units\M02\code\typescript` 与 `code\python`。

不要读取 `fact-review.md`、`fact-gate-*`、`unit-workbook.md`、Graphify、Claude Code 源码快照、实验日志、其他教材或历史审查结论。你不是事实闸门，不要重做源码调查。不得修改任何文件。

## 必要前置摘要

M01 已经讲过判别联合、类型收窄、泛型、编译期类型与运行时验证的区别。本单元可以复用这些概念，但仍须就地解释 `IteratorResult.done`、`AsyncGenerator<Y,R,N>` 和事件联合怎样改变当前控制流。

## 学习目标

学习者完成本单元后，应能：

- 区分 Promise 的一次终值与 AsyncIterable 的多次事件；
- 解释 async generator 的惰性、逐次 pull、yield、return、throw、consumer `.return()` 和 finally；
- 区分 `yield*` 委托、`for await` 消费与手动 `.next()`，并说明终值是否可见；
- 沿 `query()`/`queryLoop()`、`QueryEngine.submitMessage()`、非流请求和 StreamingToolExecutor 跟踪异步值与状态副作用；
- 说明 AsyncIterable 不等于无缓冲、端到端背压或自动资源取消；
- 区分 iterator rejection 与业务 error event，理解部分事件不会自动回滚；
- 运行 TypeScript/Python clean-room 实验并完成有目的的破坏；
- 把统一异步事件端口合入 H0，并迁移到 Python、Java Reactive Streams、Spring 和 LangGraph；
- 用资深 Agent 开发岗位的两分钟口语回答把语法讲到流控、取消、错误和多消费者设计。

主体学习时间为 5 至 6.5 小时，双语言实验和扩展挑战另计。

## 已知代码运行结果

TypeScript：6/6 行为测试通过，demo 正常，`npx --yes --package typescript tsc -p .` 严格检查通过。

Python：5/5 `unittest` 通过，demo 正常。Python 版用显式 `run.completed` event 表达完成，不声称 async generator 能携带 return value。

13 张 Mermaid 图已使用 Mermaid CLI 11.12.0 逐张实际渲染成功。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约或 5 至 6.5 小时学习闭环的问题：

- 是否由真实 Agent 事件过程推动，而不是异步语法清单；
- Promise、AsyncGenerator、AsyncIterable、IteratorResult、yield*、for-await 和手动 next 是否在改变当前语义时讲清；
- 正常完成、throw、consumer early-close、finally 与外部资源取消是否始终分层；
- Query、QueryEngine、非流请求、Tool progress 和 Stream queue 是否形成可跟踪叙事，而不是函数目录；
- 13 张图是否在真实认知转折处就近出现，每张能独立用于复习，且图文、方向、所有权和失败路径一致；
- 测试、typecheck、demo 和五次破坏是否说明各自证明与未证明的范围；
- Python/Java/Spring/LangGraph 对照、H0 与企业背压治理是否由当前机制自然推出；
- 7 道面试题是否像资深 Agent 开发面试官的真实追问，回答是否结论先行、口语自然、约两分钟，并能落到 Claude Code 设计和工程边界；
- 是否达到主体学习深度，又没有提前吞掉 M03 的事件循环/Node 资源取消、M12 Query 状态机、M14 模型流重试或 M15 工具并发。

普通措辞偏好、标题形式、无现实影响的理论漏洞和小型格式问题不得列为 Issue。

## 输出要求

输出必须以以下三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，每项给出定位、学习影响、为什么实质、最小修正方向。不要重写整章，不要建议固定栏目或数量配额。无实质问题时给出简短通过理由和剩余非阻断风险。
