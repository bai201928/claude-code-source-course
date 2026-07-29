# M04 教学闸门审查任务

你是一名独立教材教学审查者。请以准备 2026 年中国互联网大厂秋招的学习者视角，审查 M04 是否真正能帮助 TypeScript/Node 基础较弱、但已有 Java、Spring、Python、Agent 和 RAG 经验的人，学会把代码图、搜索结果和类型关系追成可验证的运行、状态与失败解释。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只使用学习者背景、教学深度、语言对照、实验、Harness、企业迁移、面试表达和验收标准。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`。
3. `D:\agent\Claude code最新\curriculum\units\M04\draft.md`。
4. 如需核对学习者操作，只读取 `D:\agent\Claude code最新\curriculum\units\M04\code\typescript` 与 `code\python`。

不要读取 `fact-review.md`、`fact-gate-*`、`unit-workbook.md`、Graphify 输出、Claude Code 源码快照、实验日志、其他教材或历史审查结论。你不是事实闸门，不要重做源码调查。不得修改任何文件。

## 必要前置摘要

M01 已讲判别联合、运行校验和状态 owner；M02 已讲 Promise、AsyncGenerator、`yield*`、`for await` 与部分失败；M03 已讲 event loop、AbortSignal、资源 owner 与 requested/exited/cleanup。M04 应把这些能力收敛为源码追踪方法，但不能退化成 checklist 或重复前几章。

## 学习目标

学习者完成本单元后，应能：

- 区分名字命中、import、contains、references、call site、callback、branch execution、state mutation 和 observable behavior；
- 正确使用 Graphify/rg 找候选，并回源码核验一个 EXTRACTED 真关系和一个 INFERRED 假关系；
- 沿 ask -> QueryEngine -> processUserInput -> shouldQuery -> query/local result 追 caller、guard、参数和事件；
- 识别 QueryEngine owner state 与 turn-local array view，理解浅数组复制的边界；
- 说明依赖注入为何要求同时找调用点、类型协议和 composition root；
- 追踪 query event 对消息、transcript、usage 与 SDK yield 的不同副作用；
- 解释 partial event 后 throw 为何不自动回滚已写状态；
- 运行 TypeScript/Python Trace 实验并用失败输入推翻错误调用边；
- 把 TraceEvent、owner mutation 与跨语言行为测试骨架合入 H0；
- 迁移到 Spring Bean/AOP、Python callable、LangGraph conditional edge 和企业代码图/运行 trace 治理；
- 用资深 Agent 开发岗位的两分钟口语回答源码追踪、DI、状态、失败和可观测性问题。

主体学习时间为 5 至 6.5 小时，双语言实验、反证练习和扩展挑战另计。

## 已知运行结果

TypeScript：5/5 行为测试通过，demo 正常，strict typecheck 通过。Python：5/5 `unittest` 通过，demo 正常。

共享契约覆盖：主路径真实调用与 owner mutation、本地分支 Query 调用数为 0、请求数组视图长度分离、Tool 作为实参但不执行、partial event 后失败保留已写状态。

13 张 Mermaid 图已使用 Mermaid CLI 11.12.0 逐张实际渲染成功。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约或 5 至 6.5 小时学习闭环的问题：

- 是否由一个可证伪问题推动，而不是源码阅读技巧列表；
- 静态结构关系、真实调用、条件分支、数据流、owner mutation 与运行证据是否层层递进；
- Graphify 是否始终只是导航，真/假关系是否回到源码和实验；
- ask、QueryEngine、processUserInput、shouldQuery、query event 形成可跟踪纵切，又没有提前完整吞掉 M10-M15；
- TypeScript callback/closure、array spread、for-await 与 DI 是否在改变语义时就地讲清；
- 13 张图是否位于认知转折处，每张能独立复习，且图文、方向、owner 和分支一致；
- 双语言运行命令、5 项测试和六次破坏是否说明证明与未证明范围；
- H0、Java/Spring、Python、LangGraph 与企业 trace 治理由当前方法自然推出；
- 8 道面试题是否像资深 Agent 开发面试官的真实追问，回答是否结论先行、口语自然、约两分钟，并落到 Claude Code 例子与工程边界；
- 是否完成 S0 源码阅读基础的收敛，而非用工具或模板替代判断。

普通措辞偏好、标题形式、无现实影响的理论漏洞和小型格式问题不得列为 Issue。

## 输出要求

输出必须以以下三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，每项给出定位、学习影响、为什么实质、最小修正方向。不要重写整章，不要建议固定栏目或数量配额。无实质问题时给出简短通过理由和剩余非阻断风险。
