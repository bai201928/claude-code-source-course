# M09 研究工作簿：结束不是一个动作，从一轮取消到有预算的会话与进程收尾

状态：`release-candidate`

风险：`R2`

本文件是作者工作区，不是教材正文。Graphify 只用于定位候选中心；下列调用关系、预算和状态边界均已回到当前 `claude-code-CLI/` 源码快照核验。

## 1. 单元问题与边界

Agent CLI 中的“结束”至少有四种语义：

```text
取消当前 turn
!= 结束当前逻辑 session
!= 结束当前 OS process
!= 无清理保证的 hard termination
```

本单元要回答：用户按 Esc/Ctrl+C、输入 `/exit`、执行 `/clear` 或 `/resume`、收到 SIGTERM、终端断开时，究竟结束哪个生命周期；哪些状态被保留，哪些 hook 和 cleanup 会运行，系统最多等待多久，超时后还在运行的 Promise 会发生什么。

边界：

- 承接 M03 的 AbortSignal 基础、M05 的运行表面、M07 的状态 owner、M08 的 request snapshot；
- 只讲主会话退出与能够证明生命周期契约的 task/MCP cleanup，不提前展开 Runtime Task、后台调度或完整 MCP 协议；
- SessionEnd 只讲触发点、输入 reason、预算和状态清理，不提前展开 Hook 配置与匹配系统；
- Transcript 只讲退出前 flush 和恢复提示，不提前展开链重建与恢复算法；
- 不把所有 CLI 子命令和每个直接 `process.exit()` 路径强行统一为一个结论。

## 2. 精简源码地图

| 机制 | 路径与符号 | 决定性语义 |
| --- | --- | --- |
| 安装进程 handler | `src/entrypoints/init.ts:init` -> `setupGracefulShutdown()` | safe env 后、较多高层设施启动前注册 signal/异常观察 |
| 全局信号入口 | `src/utils/gracefulShutdown.ts:setupGracefulShutdown` | non-print SIGINT、SIGTERM、非 Windows SIGHUP、orphan check 进入关机 |
| 关机 owner | `src/utils/gracefulShutdown.ts:gracefulShutdown` | `shutdownInProgress`、failsafe、清理阶段、SessionEnd、analytics、forceExit |
| 同步外壳 | `gracefulShutdownSync` | 只设置 exitCode 并启动/保存异步 Promise，不同步完成清理 |
| 清理目录 | `src/utils/cleanupRegistry.ts` | Set 登记/unregister；`Promise.all` 并发启动，无 phase/priority |
| Interactive 正常退出 | `src/interactiveHelpers.tsx:renderAndRun` | root 退出后 await `gracefulShutdown(0)` |
| `/exit` | `src/commands/exit/exit.tsx:call`、`components/ExitFlow.tsx` | bg session 可只 detach；普通路径进入 `gracefulShutdown(..., prompt_input_exit)` |
| Headless 完成/中断 | `src/cli/print.ts` | 正常末尾用 sync 外壳；流式 SIGINT 先 abort 当前 controller，再启动 graceful shutdown |
| turn 取消 | `src/screens/REPL.tsx:onCancel`、`src/query.ts` | 保存 partial assistant、abort reason、可生成 interruption message，不结束 session/process |
| session 边界 | `commands/clear/conversation.ts`、`REPL.tsx` resume path | clear/resume 也运行 SessionEnd，随后开启新逻辑 session |
| SessionEnd | `src/utils/hooks.ts:getSessionEndHookTimeoutMs/executeSessionEndHooks` | 默认 1.5 秒，可配置；reason 区分 clear/resume/logout/prompt exit/other |
| Transcript flush | `src/utils/sessionStorage.ts:getProject/Project.flush` | 首次创建 Project 时懒注册；等 active drain、queue 和 tracked writes |
| 活跃资源 | `tasks/LocalShellTask`、`LocalAgentTask`、`services/mcp/client.ts` | 创建时注册清理，自然完成时 unregister，退出时终止或关闭资源 |
| 新版公开行为 | `repos/official/anthropics/claude-code/CHANGELOG.md` | SIGINT/SIGTERM、SessionEnd timeout、SSH flush、损坏行恢复等公开修复记录 |

## 3. 四个生命周期不能混写

### 3.1 turn cancellation

Interactive `onCancel()` 会结束 query guard、保留已流出的 assistant 文本、清理 loading/token budget，再按当前 UI 状态取消 permission/prompt/remote/local query。普通 local query 使用：

```text
abortController.abort('user-cancel')
```

随后 controller 从组件状态清掉。`query.ts` 观察 abort reason；普通 user cancel 可生成用户中断消息，`interrupt` reason 则可能由后续排队输入承担上下文。

这条路径不运行 SessionEnd，不刷新整个进程 cleanup registry，也不调用 process exit。Partial messages 和会话状态仍属于当前 session。

Headless SIGINT 是组合动作：先 abort 当前 turn，再调用 `gracefulShutdown(0)` 结束 process。不能把它简化成“SIGINT 只是取消请求”。

### 3.2 logical session transition

`/clear` 与 Interactive `/resume` 在切换前运行：

```text
executeSessionEndHooks('clear' | 'resume')
-> 清理当前 session hooks
-> 初始化下一 session 的 SessionStart/状态
```

OS process 没有退出。因此 `SessionEnd` 是逻辑 session 边界事件，不是 process-exit 的同义词。

### 3.3 process shutdown

主流程入口包括：

- Interactive root 正常退出；
- 普通 `/exit`、Ctrl+D 等汇入 exit flow；
- Headless 正常完成；
- SIGINT、SIGTERM、SIGHUP/orphan detection；
- 部分 fatal path 的 `gracefulShutdownSync`。

`shutdownInProgress` 让关机 owner 首次调用获胜；后续调用直接返回。exit code 与 reason 由第一个进入者决定。

### 3.4 abrupt termination / bypass

SIGKILL 无法运行 JS 清理。源码中也仍存在面向短命子命令或特定错误 UI 的直接 `process.exit()`，不能宣称所有退出都通过 graceful owner。恢复能力必须依赖持续增量持久化，而不是只依赖进程末尾 finally。

## 4. 关机实际阶段与预算

当前 `gracefulShutdown()` 的主顺序：

```text
first caller sets shutdownInProgress
-> resolve SessionEnd timeout
-> arm overall failsafe = max(5s, hook budget + 3.5s)
-> set process.exitCode
-> synchronous terminal reset + early resume hint
-> run cleanup registry, wait at most 2s
-> execute SessionEnd hooks, default overall 1.5s
-> profile/cache-eviction event
-> analytics shutdown, wait at most 500ms
-> optional final stderr message
-> forceExit(exitCode)
```

需要精确表述的点：

1. `cleanupTerminalModes()` 用 sync write，并在所有异步阶段前执行；目的不是业务持久化，而是即使后续卡住也尽量恢复终端。
2. resume hint 也提前输出；但只有 TTY + Interactive + persistence enabled + session file already exists 才显示。
3. 2 秒 cleanup stage 调用的是整个 registry。注释说 session data 最关键，真实实现不是专属 priority queue。
4. `runCleanupFunctions()` 把 Set 转成数组后 `Promise.all(fn())`：handler 按插入顺序被调用，但并发完成；没有完成顺序保证。
5. 任一 cleanup reject 会使 `Promise.all` 提前 reject；其他 Promise 不会自动取消，仍可能在背景继续。外层吞掉错误并进入 SessionEnd。
6. 2 秒 `Promise.race` 超时同样只停止等待，不会取消 cleanup handler；未完成任务可能和后续阶段重叠，直到自然完成或进程被强制结束。
7. SessionEnd 获得 AbortSignal 与 per-hook/overall cap，比 cleanup registry 更接近合作式取消。
8. analytics 的 500ms race 也只限制等待；丢失慢 analytics 是显式可接受代价。
9. overall failsafe 默认 5 秒；自定义更长 SessionEnd budget 时，failsafe 随之扩展，避免用户预算被旧 5 秒硬截断。

## 5. 清理目录的所有权与动态注册

`cleanupRegistry.ts` 的 owner 是模块级 `Set<cleanupFn>`：

- 资源创建成功后登记 cleanup；
- `registerCleanup` 返回 unregister；
- background shell/agent 在自然结束或显式 kill 后 unregister，避免关机重复处理陈旧资源；
- session Project、history、watcher 等在首次使用时懒注册；未使用的设施不占清理路径；
- 关机时 snapshot 当前 Set 并并发调用。

这比把所有清理写在一个巨型 `finally` 更可扩展，但当前快照没有 phase、priority、dependency 或 handler-level status。教材不能从注释推导出源码不存在的严格优先级。

## 6. Transcript 与 remote persistence

`Project.flush()`：

```text
cancel delayed flush timer
-> await active drain
-> drain remaining queue
-> await non-queue tracked writes
```

退出 cleanup 随后 re-append title/tag metadata，使 tail-based resume listing 仍能看到它们。

`isShuttingDown()` 还会阻止新的 remote transcript persistence；本地已排队写入由 flush 负责。这表达了一个关机原则：进入 stopping 后不再接受无限新工作，否则 drain 永远不能收敛。

但由于 transcript flush 与其他 cleanup 同在并发 registry 中，本单元只说“cleanup stage 位于 hooks/analytics 之前，并包含 transcript flush”，不说“所有其他 cleanup 必须等 transcript 完成”。

## 7. 失败、重复信号与恢复边界

- cleanup/hook/analytics 错误多数被吞掉，关机继续推进；这是 availability 决策，不代表清理成功。
- `shutdownInProgress` 防止重复执行，但后续信号不会重置 reason 或 exit code，也不会建立第二套 cleanup。
- overall failsafe 会同步恢复终端、尝试打印 hint，再 force exit。
- `process.exit()` 若因死 TTY 的 EIO 抛错，production fallback 为 SIGKILL；测试环境重抛以便观察。
- orphan check 只在非 Windows 且 stdin 是 TTY 时安装；Windows 不应画 SIGHUP 路径。
- 当前公开 CHANGELOG 还记录了 unclean transcript 行跳过、SIGTERM 清理进程树等恢复改进；这些只能标为新版公开行为，不能倒推快照内每条内部路径。

## 8. 实验假设与反证条件

独立 TypeScript/Python 实验验证改进后的生命周期契约，并用一个 snapshot-shaped 对照实验暴露当前 registry 的语义：

1. `Promise.all` registry 会启动所有 handler，完成顺序不等于注册顺序；若后续 handler 未启动，则假设失败。
2. 一个 handler reject 后，registry await 可以提前失败，但另一个 handler仍能随后完成；若 rejection 自动取消其他 Promise，则假设失败。
3. 改进 LifecycleManager 的 phase 必须按 `critical -> resource -> best-effort` 串行，phase 内并发且用 all-settled 隔离错误。
4. phase timeout 必须产生可解释报告和 AbortSignal；不能把超时伪装成 cleanup success。
5. 第一次 shutdown 返回的 Promise/报告被后续调用复用；后续 reason/exitCode 不得覆盖 owner。
6. stopping 后拒绝新注册；已 unregister handler 不运行。
7. recovery hint/terminal prepare 在慢 cleanup 前发生。
8. overall deadline 不足时跳过剩余低优先级阶段并触发 failsafe callback；critical 结果保留。

## 9. H1 候选契约

拟新增：

```text
LifecycleCoordinator
  state: running | stopping | stopped
  register(name, tier, handler) -> unregister
  shutdown(reason, exitCode, budgets) -> one shared ShutdownReport

tier order:
  critical -> resource -> best-effort

surface adapter owns:
  OS signal wiring
  terminal restore / recovery hint output
  final process exit
```

设计迁移：

- Core/Harness 不直接 `process.exit`；外部 Surface 把 report 映射为进程退出。
- 每个 handler 收到 AbortSignal/cooperative cancellation；timeout 记录 `timed-out`，不假装 Promise 被物理取消。
- phase 内 `allSettled`，避免一个错误让 manager过早进入下一 phase。
- report 记录 first reason、exit code、tier、started/settled/status/duration 与 skipped stage。
- 关键 transcript/checkpoint 属于 critical；子进程/MCP/LSP 属于 resource；analytics 属于 best-effort。
- recovery hint 来自已持久化 session identity，不等待低优先级网络调用。

这是从当前快照的问题迁移出的 clean-room 契约，不冒充 Claude Code 现有 registry API。

## 10. 事实闸门重点

- `gracefulShutdownSync` 是否真的同步；
- 各运行表面的 SIGINT/SIGTERM 与正常退出路径是否共享相同取消动作；
- shutdown 第一次调用、exit code/reason、重复信号语义；
- registry 并发、reject/timeout 后未完成 Promise 的真实行为；
- transcript flush 是否真有严格优先级；
- SessionEnd 在 clear/resume/process exit 三类边界的差异；
- overall failsafe 与自定义 hook timeout 的公式；
- terminal reset、resume hint、analytics 和 forceExit 的相对顺序；
- bg detach、direct process.exit、SIGKILL 等 bypass；
- 快照事实与当前官方 CHANGELOG 行为的版本边界。
