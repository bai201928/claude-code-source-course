# S0-S2 已确认知识摘要

状态：`S2 已发布`

S0 的目标不是让学习者记住四组 API，而是建立阅读后续 Claude Code 主线的基础动作：

```text
从类型读合法边界
-> 从异步协议读事件与完成
-> 从 Node runtime 读资源和取消
-> 从候选关系追到真实调用、owner 与可观察结果
```

## 已确认结论

- TypeScript union/generic/readonly 约束内部代码；外部数据仍需 runtime parser，状态迁移仍需领域规则。
- 同名 TaskStatus 可以属于不同领域，路径和使用点是语义的一部分。
- AsyncIterable 是消费协议，不承诺无缓冲、端到端背压或自动资源取消。
- `yield*` 正常完成可取得子生成器终值；consumer `.return()` 会关闭委托链、执行 finally，并跳过外层正常完成段。
- Bash 默认 file mode 与 `onStdout` pipe mode 是不同输出路径；TaskOutput、ShellCommand 和 runShellCommand 分别拥有不同生命周期责任。
- AbortSignal 只表示通知；timeout、cancel、kill、background、logical completion、OS exit confirmation 和 cleanup 必须分层。
- import/contains/references 是结构候选；真实运行结论需要 call site、guard、参数、owner mutation 与可观察验证。
- `QueryEngine.submitMessage()` 只有在 `shouldQuery` 为真时调用 `query()`；`tool` 出现在 `canUseTool(tool,...)` 中不等于 Tool 被执行。
- 数组 spread 创建独立容器但共享元素引用；状态追踪必须画 owner store 与 turn view。
- 流式失败不会自动回滚此前消息、usage、transcript 或外部副作用；每个提交点单独设计补偿和恢复。

## H0 能力

累计 H0 已实现 TypeScript/Python 两版：运行时消息校验、显式 RunState、异步 Query event、本地 Query skip、reason 保留、逆序幂等清理、部分失败状态和结构化 Trace。两版各 7 个行为测试通过，TypeScript strict typecheck 通过。

H0 仍不包含真实模型、Tool Loop、持久化、权限、Sandbox、后台任务或多 Agent；后续阶段只在当前契约上累计，不用 Claude Code 私有实现替换 clean-room 边界。

## S1 已确认结论

- Interactive、Print、SDK/Headless 是不同 Runtime Surface；它们可以汇合到 Core，但输入协议、状态容器、刷新与退出适配不因此相同。
- 配置来源顺序、policy provider 选择、trust-phase environment 与运行时 publication 是不同阶段；H1 用 revisioned snapshot 固定请求视图。
- Bootstrap `STATE`、AppState type/value/store、RuntimeContext、SessionState 与 RequestContext 不是一个“大状态”；REPL messages 也不归 AppState 自动拥有。
- 能力 discovery、model visibility、permission allow 与 executable registration 必须分层；runtime pool 不等于 API schemas，旧 CapabilitySnapshot 不被新 catalog 原地改写。
- Interactive 可以在 Tool Loop 的下一模型迭代 refresh tools；Headless 单次 submit 通常保持传入集合，下一 command 才重建。该非对称是快照事实，不是企业推荐默认。
- turn cancellation、logical SessionEnd、process graceful shutdown 与 abrupt termination 是四个生命周期；相同的 Ctrl+C 字样不能替代入口追踪。
- `gracefulShutdownSync` 只同步启动并保存异步 shutdown Promise；first caller 拥有 reason 与 exit code。
- cleanup registry 的 Set + `Promise.all` 没有 priority；一个 reject 或 2 秒 race 结束等待时，未完成 peer 不会被自动取消。
- Transcript flush 属于 Hook/analytics 之前的 cleanup stage，但惰性注册且与其他 handler 并发；注释中的关键性不是已实现的 registry priority。

## H1 能力

H1 在 H0 上累计 RuntimeSurface、ConfigurationSnapshot、RuntimeContext/SessionStateStore/RequestContext、CapabilityCatalog/CapabilitySnapshot/ExecutableRegistry/SystemContextBuilder 与 LifecycleCoordinator。TypeScript/Python 行为契约均已通过，H1 阶段回归为 12/12，并包含 S0 15/15。

H1 仍不包含真实模型、完整消息会话 owner、Query/Tool Loop、完整持久化、权限控制面、Sandbox、后台任务或多 Agent；S2 从消息与 Query 主循环继续演进。

## S2 已确认结论

- REPL 与 SDK/Headless 的长期消息 owner 不同：REPL 由本地 `messages/messagesRef` 直接进入 `query()`，Headless 由 `print.ts` 的 `mutableMessages` 和 `QueryEngine` 适配；两条路径在 `query()` 汇合，不能写成 REPL 必经 QueryEngine。
- durable conversation、一次 Query state、API-normalized messages 与最终 wire params 是不同对象。请求投影不能反向修改长期历史。
- envelope ID、provider response ID、tool-use ID、Transcript parent 与 session ID 各自表达不同关系；Provider `user` role 也不能替代 human/tool-result 领域分类。
- `query()` 用 `yield*` 暴露过程事件和正常 terminal；`for await` 只能观察 yielded values。Abort、consumer close、throw 与业务 terminal 是不同终止通道。
- `queryLoop()` 是显式 while 状态机。assistant、tool result、attachment、compact 或 fallback 的提交顺序会改变下一轮状态，不能用一个递归“再问一次”隐藏 owner。
- Context 不是一个全局裁剪函数：history boundary、tool-result budget、request-only context、normalization、pairing repair 与 Provider params 分属不同投影阶段和状态 owner。
- 模型流按 content index 组装；完整 block 可以早于 response terminal 交付，usage/stop reason 可能在稍后 finalize。已交付对象的受控 late mutation 与请求投影污染 durable history 是两个不同问题。
- retry、model fallback、non-streaming fallback、timeout、caller cancel 与 consumer close 的 owner 和重放风险不同。tombstone/discard 不能回滚已经发生的工具副作用。
- Tool Loop 的继续条件来自实际 assistant `tool_use` block，不依赖 `stop_reason`。schema validation、dynamic concurrency-safe、Hook、Permission、handler 和 Sandbox 是不同边界。
- response-complete 路径把连续 safe calls 组成并发 batch，unsafe call 形成 exclusive barrier；执行完成可乱序，但协议配对、context modifier 和 durable publication 需要稳定归属与顺序。
- Claude Code 快照的 streaming 与 response-complete executor 共享 `runToolUse()` 主链但并不完全等价。H2 的统一 scheduler 是设计迁移，不能倒写成快照事实。

## H2 能力

H2 / Harness `0.3.0` 在 H0/H1 上累计了 revisioned `ConversationStore`、单 Runtime owner 与 active-run lease、请求/能力快照、history/context/preview 投影、strict pairing、OpenAI-compatible Provider、有界单消费者流，以及带 safe batch、exclusive barrier、固定 worker pool 和 ordered publication 的 Permission-aware Tool Loop。TypeScript 主实现与 Python 行为镜像均通过统一回归。

H2 仍不承诺 Provider-specific SSE parser 或 Runtime streaming tool execution，也不包含完整 Context 压缩/记忆、Hook/Skill/MCP/Plugin、多 Agent、Transcript 恢复、Sandbox、分布式执行或生产级 OTel/cost ledger。后续阶段继续在该契约上演进。

## 证据边界

教材始终区分快照事实、运行验证和设计迁移。Graphify 只缩短候选定位；DeepSeek 审查意见经 Codex 裁决后才能影响教材。当前源码快照缺少若干类型文件，相关结论已经缩小表述。
