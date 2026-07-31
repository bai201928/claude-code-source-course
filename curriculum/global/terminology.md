# 全局术语表

状态：`S3 已发布`

本表只保存后续单元需要复用的稳定术语。具体教学解释仍以来源单元为准。

| 术语 | 课程中的稳定含义 | 不能混同 | 来源 |
| --- | --- | --- | --- |
| 编译期类型 | TypeScript 对内部表达式和控制流的静态约束 | 运行时输入验证、合法状态迁移 | M01 |
| 运行时验证 | 对 JSON、Tool 输入、文件/网络数据执行的真实检查 | `as` 断言、type annotation | M01 |
| 判别联合 | 用稳定字面量字段选择合法变体和分支 | 自动状态机、运行时 schema | M01 |
| Runtime Task | `src/Task.ts` 的运行任务生命周期 | `src/utils/tasks.ts` 的协作任务清单 | M01 |
| Work-item Task | `src/utils/tasks.ts` 的协作任务记录 | Runtime Task | M01 |
| Promise | 一个异步终值或 rejection | 多次事件、自动取消、自动背压 | M02 |
| AsyncIterable | 可以逐次异步消费的协议外观 | 无缓冲、单一实现、端到端背压 | M02 |
| AsyncGenerator | 同时是 async iterator 与 producer 的语言对象 | 外部资源生命周期的完整 owner | M02 |
| `yield*` | 委托事件、throw/return/close 到子 iterator，并在正常完成时取得终值 | `for await` 的普通消费 | M02 |
| early close | consumer `.return()` 关闭 iterator 链并运行相关 finally | 业务 completed、外部资源已停止 | M02-M03 |
| file mode | Bash 默认将 stdout/stderr 写入同一输出文件并由 TaskOutput 轮询 | `child.stdout.on('data')` pipe mode | M03 |
| pipe mode | 提供 `onStdout` 时用 Node Readable 事件处理输出 | 所有 Bash 调用的默认路径 | M03 |
| cancel request | one-shot 通知与 reason | kill 已发出、进程已退出、资源已清理 | M03 |
| background | 前台 owner 向后台 Task owner 转移控制 | cancel、kill、Promise 丢弃 | M03 |
| logical completion | 组件内部结果已收敛 | OS `exit`、process tree/resource confirmation | M03 |
| owner | 对状态或资源生命周期负最终责任的组件 | 只读取、持有临时视图或记录 Trace 的组件 | M03-M04 |
| turn view | 为一次运行创建的消息数组视图 | 跨 turn 的 mutable owner store、深不可变副本 | M04 |
| static edge | import、contains、references 等结构关系 | 真实运行调用或调用频率 | M04 |
| runtime call | 到达具体 call site 后发生的调用 | 名字命中、传参、callback 定义 | M04 |
| TraceEvent | clean-room Harness 中可观察调用、状态、分支和失败的结构化事件 | Graphify 边、无限日志、业务状态 owner | M04/H0 |
| 快照事实 | 当前本地源码或测试可直接确认的内部事实 | 新版公开承诺、clean-room 设计 | M01-M04 |
| 运行验证 | 独立实验实际观察到的结果 | Claude Code 私有实现事实 | M01-M04 |
| 设计迁移 | 课程为 Mini Agent Harness/企业系统提出的方案 | 对 Claude Code 当前实现的描述 | M01-M04 |
| Runtime Surface | Interactive、Headless、SDK 等外部输入输出与进程适配边界 | Agent Core、消息 owner、输出格式字符串 | M05 |
| internal client type | Claude Code 运行中记录请求来源的内部标签 | 用户使用的 SDK、运行表面选择器 | M05 |
| ConfigurationSnapshot | H1 中带 revision、effective value 与 provenance 的不可变配置视图 | Claude Code 当前 getter 的原生返回形状、全局即时热更新 | M06 |
| policy provider | remote、MDM、managed file、HKCU 中选出的单一有效管理来源 | 多个 policy 来源深合并 | M06 |
| Bootstrap state | 进程早期、模块级的一次性初始化事实 | AppState store、跨请求业务 session | M07 |
| AppState store | 保存当前 AppState root 并发布更新的具体 store 实例 | AppState 类型、整个 Claude Code 会话、REPL messages owner | M07 |
| RuntimeContext | H1 中不可变的进程/运行依赖容器 | 可热变的 SessionState、请求临时 view | M07 |
| RequestContext | 在请求边界冻结 runtime/config/session revision 的稳定视图 | live AppState、显式 fresh read | M07 |
| capability discovery | 系统已经发现某个能力定义 | 模型可见、权限允许、本地 handler 已注册 | M08 |
| CapabilitySnapshot | H1 在请求或模型迭代边界产生的不可变能力投影视图 | 永久启动清单、ExecutableRegistry | M08 |
| ExecutableRegistry | 保存本地可调用 handler 并在 dispatch 时 fail closed | 模型 schema 列表、权限授权 | M08 |
| turn cancellation | 停止当前一轮工作并保留 reason，通常保留逻辑 session | SessionEnd、process exit、资源已确认终止 | M09 |
| logical SessionEnd | clear/resume/exit 等逻辑会话边界事件 | OS process 一定退出、全局 cleanup 一定运行 | M09 |
| process graceful shutdown | first owner 在有限预算内组织进程级收尾并最终退出 | hard termination、所有 cleanup 必然成功 | M09 |
| abrupt termination | SIGKILL/直接 bypass 等没有 JavaScript 收尾保证的终止 | graceful shutdown、cancel request | M09 |
| LifecycleCoordinator | H1 中拥有 lifecycle state、分层 cleanup 与共享 report 的进程无关核心 | Claude Code 当前 Set registry、OS signal/最终 process exit owner | M09/H1 |
| durable conversation | 跨模型迭代保留的消息事实与 tool pairing 状态 | 某一轮 Query state、请求视图、Provider payload | M10-M13 |
| ConversationStore | H2 中 durable conversation membership、revision 与 pairing 的唯一 owner | REPL React state、Provider adapter、Transcript 数据库 | M10/H2 |
| envelope ID | 本地消息节点身份 | Provider response ID、tool-use ID、Transcript parent | M10 |
| provider response ID | 同一次模型响应及其流式片段的分组身份 | 本地 envelope 唯一键 | M10/M14 |
| tool-use ID | assistant 调用与 user-role tool result 的协议配对键 | 数组位置、执行完成顺序、trace ID | M10/M15 |
| progress event | 可提前观察、可丢且不推进 conversation revision 的过程事件 | durable message、final tool result | M10/M15 |
| Query state | `queryLoop()` 当前运行的控制状态与下一轮输入 | 入口长期消息 owner、Provider request | M11-M12 |
| terminal value | generator 正常完成时通过 `return` 产生的终值 | 最后一个 yielded event、`for await` 可直接取得的值 | M12 |
| run channel | durable state、observer events 与 terminal summary 中的一条独立协议 | 一个共享 event 数组 | M12/H2 |
| RequestProjector | 从 immutable conversation snapshot 派生本轮模型可见请求的纯边界 | durable store mutation、Provider HTTP adapter | M13/H2 |
| history start | 只选择当前请求可见历史起点的 policy | 删除或截断 durable history | M13 |
| request-only context | 只注入当前 ModelRequest 的临时上下文 | 持久化 user message、系统长期记忆 | M13 |
| protocol assembler | 按 index 把 Provider stream event 组装为完整业务 block，并在 finalize 边界补终态 | Tool Loop、ConversationStore owner | M14 |
| consumer close | 下游放弃继续消费并触发 iterator/source cleanup | 业务 completed、所有外部副作用已回滚 | M12/M14 |
| ToolExecutionPlan | H2 对一个 assistant tool-call block 的 immutable 批次计划 | 工具执行结果、Permission 决策 | M15/H2 |
| concurrency-safe | 某个工具在当前已验证输入下允许与相邻安全调用并发 | 工具名永久无副作用、Permission allow、Sandbox | M15 |
| exclusive barrier | 必须等待前批完成并阻止后批越过的单工具批次 | 全局锁、所有工具永远串行 | M15/H2 |
| ordered publication | 执行可乱序完成，但 outcome、context update 与 durable result 按原 tool-call 顺序提交 | 强制工具串行执行 | M15/H2 |
| ResultBudgetLedger | H3 中跨模型迭代冻结 exact replacement decision 的 revisioned owner | durable tool output、全请求硬 token 上限 | M16/H3 |
| Compact transaction | 从 immutable history 准备 summary/replacement，经 revision 与 journal 边界提交 | 原地截断、crash durability 已自动成立 | M17/H3 |
| Instruction Pipeline | 把 source、trust、scope 和动态 delta 投影为一次请求可见 instruction view | system prompt、Permission enforcement、长期 Memory | M18/H3 |
| Session Memory | 当前 project/session 的滚动 `summary.md`，主要服务 Session Memory compact | 跨 session Auto Memory、compact summary本身 | M19 |
| Auto Memory | 按 canonical git root持久化的 topic files与 `MEMORY.md`索引 | Session Memory、Instruction、Transcript | M19 |
| relevance recall | 从 topic header选择、限量读取并作为当前请求attachment投影 | 所有 memory永久注入 system prompt | M19 |
| memory candidate | H3 clean-room中尚未 explicit accept、不可 recall 的观察 | Claude Code 当前已存在的统一状态机、accepted长期事实 | M19/H3 |
