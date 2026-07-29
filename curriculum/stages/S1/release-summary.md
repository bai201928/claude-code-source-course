# S1 运行配置与生命周期壳发布说明

状态：`final`

发布日期：`2026-07-29`

S1 原子发布 M05-M09，并形成累计 Mini Agent Harness `H1`。

## 发布单元

| 单元 | 正文规模 | 局部图 | 面试题 | FACT_B | 教学闸门 |
| --- | ---: | ---: | ---: | --- | --- |
| M05 同一个 Agent，为什么需要多种运行表面 | 722 行 | 10 | 8 | PASS / 0 | PASS / 0 |
| M06 一个设置值为什么会变：从配置来源走到信任与运行快照 | 960 行 | 12 | 10 | PASS / 0 | PASS / 0 |
| M07 状态不是一个大对象：从 Bootstrap 走到一次请求的稳定视图 | 979 行 | 16 | 10 | PASS / 0 | PASS / 0 |
| M08 能力不是一张启动清单：发现目录、请求投影与执行注册表 | 892 行 | 14 | 9 | PASS / 0 | PASS / 0 |
| M09 结束不是一个动作：从一轮取消到有预算的会话与进程收尾 | 955 行 | 18 | 8 | PASS / 0 | PASS / 0 |

五个单元都完成独立 FACT_A、同会话 FACT_B、Codex 裁决、双语言实验、Mermaid 实际渲染和独立教学闸门。FACT_A 中需要修订的发现均在 FACT_B 前完成核验与裁决；所有单元的最终 FACT_B 和教学闸门均为 `PASS / 0`。

## 阶段一致性

- 运行表面、配置来源、进程/会话/请求状态、能力发现/投影/执行和生命周期收尾按真实依赖递进，没有把它们压成一个全局配置或状态对象。
- M05 的 Interactive、Headless 与 SDK 边界保持一致；对尚未发布标杆单元的引用已改为未来时态，没有把 M11 候选稿冒充已发布前置。
- M06 区分设置来源深合并、企业策略 provider 选择、信任前后环境变量投影和不可变配置快照，没有把所有来源写成同一种覆盖关系。
- M07 的 Bootstrap state、AppState store、session root 与 request snapshot 所有权一致；旧请求视图不会被后续 publication 原地改写。
- M08 区分能力发现、模型可见性、权限允许和本地可执行注册；动态刷新只在声明的边界创建新投影。
- M09 明确区分 turn cancellation、逻辑 SessionEnd、进程 graceful shutdown 与 abrupt termination；当前源码的无优先级 `Set + Promise.all` 与 H1 的分阶段收尾设计没有混写。
- TypeScript `Map`/`Set` 的首次主题覆盖已移动到 M09，后续 M10 只复用身份与去重语义；M09 的 H1 图已校正为 Surface 提供 `prepare`，由 `LifecycleCoordinator` 在 cleanup 前调用。
- 快照事实、运行验证与 Harness 设计迁移保持分层；Graphify 只用于候选定位，不是教材事实、图示或面试答案的最终证据。
- 五章共 70 张 Mermaid 图，已全部实际渲染并完成视觉检查；图中的所有权、调用、投影、取消和收尾路径与正文及实验一致。
- 全局术语、TypeScript 索引、源码符号映射与知识摘要已经同步 S1 的稳定结论。

## 回归结果

独立行为测试：

- M05：TypeScript 7/7，Python 7/7；
- M06：TypeScript 9/9，Python 9/9；
- M07：TypeScript 7/7，Python 7/7；
- M08：TypeScript 8/8，Python 8/8；
- M09：TypeScript 8/8，Python 8/8。

五个 TypeScript strict typecheck 全部通过。

`mini-agent-harness/tests/run-h1-regression.ps1`：`12/12 checks passed`，并包含 S0 `15/15` 全量回归。当前 Windows 环境不使用 WSL；未执行 Hash、重哈希、漂移检查或自动 Git 提交。

## H1 里程碑

H1 在 H0 的消息、异步、取消和追踪骨架上，新增 RuntimeSurface、ConfigurationSnapshot、RuntimeContext/RequestContext、CapabilityProjection 与 LifecycleCoordinator。它已经能够表达多运行表面适配、配置与信任投影、稳定请求快照、能力可见/可执行分离，以及有预算的分阶段收尾；尚不承诺跨 prompt 的共享消息会话状态、真实模型调用、Tool Loop、完整持久化、完整权限控制平面或 Sandbox。

下一阶段为 S2/M10：从会话消息、API 请求投影与状态所有权开始，继续形成 H2 可运行的单 Agent 主循环。后续未发布单元仍可依据真实依赖和学习闭环动态合并、拆分或调整。
