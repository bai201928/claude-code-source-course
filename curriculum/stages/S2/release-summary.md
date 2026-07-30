# S2 消息、Query、模型流与 Tool Loop 发布说明

状态：`final`

发布日期：`2026-07-30`

S2 原子发布 M10-M15，并形成累计 Mini Agent Harness `H2 / 0.3.0`。

## 发布单元

| 单元 | 正文规模 | 局部图 | 面试题 | 最终事实结论 | 教学闸门 |
| --- | ---: | ---: | ---: | --- | --- |
| M10 消息不是聊天文本：谁拥有历史，谁只看见一次快照 | 759 行 | 12 | 8 | PASS / 0 | PASS / 0 |
| M11 标杆纵切：一条用户消息怎样穿过状态、请求投影和 Tool Loop | 1006 行 | 9 | 7 | PASS / 0 | PASS / 0 |
| M12 谁在推进 Agent：从三层 Pull 到 Query 状态机 | 826 行 | 11 | 7 | PASS / 3（均已裁决落实） | PASS / 0 |
| M13 对话里存在，为什么请求里看不见：从 durable history 到模型线协议 | 746 行 | 17 | 8 | RECHECK PASS / 0 | PASS / 0 |
| M14 真实模型流：一条 SSE 怎样成为 Agent 能继续执行的消息 | 440 行 | 13 | 6 | PASS / 0 | PASS / 0 |
| M15 Tool Loop：模型说“调用工具”之后，系统怎样安全地继续 | 508 行 | 14 | 7 | RECHECK PASS / 0 | PASS / 0 |

六个单元都完成直接源码研究、独立事实 A/B、Codex 裁决、双语言实验、Mermaid 实际渲染和独立教学闸门。M13 与 M15 在同一事实会话中完成定向复审；M12 的 FACT_B 头部保留 `PASS / 3`，三个补充点已经全部接受并落实到教材，事实记录没有被重写成虚假的零问题。

## 阶段一致性

- M10-M15 按一条真实运行依赖推进：durable 消息与身份 -> 两种输入适配和全链纵切 -> Query 控制权 -> 请求投影 -> 模型流组装 -> Tool 调度与结果反馈。
- REPL 与 SDK/Headless 的长期消息 owner 保持分离；REPL 直接进入 `query()`，Headless 通过 `QueryEngine` 适配，两条路径在 `query()` 汇合，没有把 REPL 写成 QueryEngine 的消费者。
- durable conversation、Query state、API-normalized messages、wire params、observer event 与 terminal summary 始终是不同对象和通道，没有使用一个共享数组同时承担状态、请求与观测。
- M12 的 generator terminal、Abort、consumer close 与 throw 保持分层；M14 的 bounded stream 不被描述成 Provider 网络端到端背压，也不替代当前 Runtime Promise。
- M13 的 per-result Harness preview 没有冒充 Claude Code 的 aggregate API-user-group budget；外置 tool result、跨轮 replacement 与完整 compact transaction 继续留给 Context/恢复阶段。
- M14 的 indexed stream assembly、late finalize、retry/fallback/timeout/cancel 与 M15 的两条工具执行入口前后相容。tombstone/discard 只停止传播，不能回滚已经发生的副作用。
- M15 明确区分 schema validation、dynamic concurrency-safe、Hook、Permission、handler 与 Sandbox；response-complete 和 streaming executor 共享主执行链但不被写成完全等价。
- H2 的统一 ToolScheduler 是 clean-room 设计迁移：安全调用采用固定上限 worker pool，unsafe 调用形成 exclusive barrier，执行可以乱序，但 outcome、context update 和 durable tool result 按原 call 顺序提交。
- 76 张 Mermaid 图已全部实际渲染；图中的 owner、调用、投影、终止、并发与恢复边界与正文和实验一致。43 道核心面试题均采用结论先行、约两分钟口语回答，并可继续承接源码与系统设计追问。
- 全局术语、TypeScript 难点索引、源码符号地图与知识摘要已同步 S2 的稳定结论。Graphify 仅用于候选定位，没有进入教材证据或闸门输入。

## 实验与回归

独立单元实验：

- M10：TypeScript 10/10，Python 11/11；
- M11：TypeScript 4/4，Python 4/4；
- M12：TypeScript 6/6，Python 5/5；
- M13：TypeScript 9/9，Python 8/8；
- M14：TypeScript streaming assembler 4/4，Python 3/3；
- M15：TypeScript scheduler 6/6，Python scheduler 6/6。

累计 Harness 最终基线：

```text
TypeScript Config       1/1
TypeScript Runtime      25/25
TypeScript Provider     7/7
TypeScript Tool         5/5
TypeScript Scheduler    5/5
TypeScript Stream       4/4
Python Agent/Scheduler/Stream 22/22
Python ConversationStore      13/13
TypeScript strict typecheck   PASS
H2 cumulative           4/4
H1 cumulative           12/12
S0 cumulative           15/15
Integrated Agent        4/4
```

真实 Provider 冒烟与确定性协议测试保持分离。本阶段未把模型可达性冒充 Tool Loop 正确性，也未把 fake provider 测试冒充真实网络验证。Windows 环境不使用 WSL；未执行 Hash、重哈希或漂移检查。

## H2 里程碑

H2 / Harness `0.3.0` 在 H0/H1 契约上新增 revisioned ConversationStore、单 Runtime owner 与 active-run lease、请求与能力快照、strict request projection、OpenAI-compatible Provider、有界单消费者流，以及 Permission-aware 的有界并发 Tool Loop。它能够表达一次用户输入如何形成模型请求、如何把 tool call 变成受控执行、如何在失败和取消后保持配对，并让进度实时可见而不让完成顺序接管 durable conversation。

H2 有意不实现 Provider-specific SSE 到 Runtime 的完整 assistant/tool 增量消费，也不提前包含完整 Context 压缩与记忆、Hook/Skill/MCP/Plugin、多 Agent、Transcript 恢复、Sandbox、分布式执行或生产级 OTel/cost ledger。下一阶段从 Context、压缩、指令与记忆继续演进；未发布课程已经按用户授权重排到 M25 以内，但不会因合章遗漏原有主题。
