# M09 FACT_B 同会话对照提示词

继续刚才的 FACT_A 会话。请把阶段 A 的独立结论与下面 Codex 已核验的机制摘要、运行实验和 clean-room 候选契约逐项对照。不要重新扩散阅读整个源码树；只有发现明确冲突时，才回到相关路径和符号定向核验。

## Codex 机制摘要

### 四种“结束”不是同一个生命周期

```text
turn cancellation
!= logical SessionEnd
!= process graceful shutdown
!= abrupt termination
```

- Interactive `REPL.tsx:onCancel()` 保存已有 partial assistant、结束 query guard，并按当前 UI/remote/local 分支取消当前工作；普通 local query 使用 `abortController.abort('user-cancel')`。它不运行全局 cleanup registry，不运行 SessionEnd，也不退出进程。
- `/clear` 与 Interactive `/resume` 在同一 OS process 内调用 `executeSessionEndHooks('clear' | 'resume')`，随后切换到新的逻辑 session 状态。SessionEnd 是逻辑会话边界，不是 process-exit 的同义词。
- 普通 `/exit`、Interactive root 正常结束、Headless 正常结束及 SIGINT/SIGTERM/SIGHUP 等路径可进入 process graceful shutdown；但 background `/exit` 可只 detach，特定短命/错误路径的直接 `process.exit()` 与 SIGKILL 会绕过这条所有权路径。
- Headless print SIGINT 是组合动作：`print.ts` 的专用 handler 先 abort 当前 controller，再调用 `gracefulShutdown(0)`；全局 SIGINT handler 对 `-p/--print` 主动跳过。Interactive 的按键级 Ctrl+C/Esc 处理不能自动等同于外部 OS SIGINT。

### 启动注册、同步外壳与首次调用所有权

`entrypoints/init.ts:init` 在 safe environment 应用后、较多高层设施启动前调用 memoized `setupGracefulShutdown()`。全局 handler 处理 non-print SIGINT、SIGTERM，以及非 Windows SIGHUP/orphan detection；uncaught exception/rejection handler在这里记录事件，但不能因此推导所有 fatal path 都完成 graceful shutdown。

`gracefulShutdownSync()` 只同步设置 `process.exitCode`，启动 `gracefulShutdown()` 并把 catch 后的 Promise 保存到 `pendingShutdown`。它不等待 cleanup 完成。`pendingShutdown` 可由测试 helper 观察。

`gracefulShutdown()` 的 `shutdownInProgress` 使第一个进入者拥有 reason、exit code 和本次 shutdown 执行；后续调用直接返回，不启动第二套 cleanup，也不覆盖第一个调用者的数据。

### 实际阶段与预算

当前快照中的顺序是：

```text
first caller marks shutdown in progress
-> resolve SessionEnd budget
-> arm failsafe = max(5s, hook budget + 3.5s)
-> set exitCode
-> synchronous terminal cleanup + early resume hint
-> cleanup registry, wait at most 2s
-> SessionEnd hooks, default overall 1.5s
-> profile report + cache eviction hint
-> analytics, wait at most 500ms
-> optional final stderr message
-> forceExit
```

2 秒 cleanup 与 500ms analytics 都使用 `Promise.race` 限制“等待时间”，不会物理取消 loser。SessionEnd 获得 `AbortSignal.timeout(...)` 和总预算，更接近合作式取消。Failsafe 在自定义 SessionEnd 预算较大时随之扩展。

`cleanupRegistry.ts` 是模块级 `Set`，`runCleanupFunctions()` 使用 `Promise.all(Array.from(set).map(fn => fn()))`。handler 按 Set 插入顺序被同步调用，但异步完成并发且无完成顺序/priority 保证。一个 reject 会让 `Promise.all` 早失败，peer 不会自动取消；外层吞掉错误后进入下一阶段。2 秒 race 超时也不会取消未完成 handler。

`sessionStorage.ts:getProject()` 首次创建 Project 时惰性注册 transcript flush。`Project.flush()` 取消 delayed timer，等待 active drain，排空队列，再等待 tracked non-queue writes。它属于 hooks/analytics 之前的 cleanup stage，但与该 registry 的其他 handler 并发，没有专属 priority，也不能证明最先注册或最先完成。

进入 shutdown 后，`sessionStorage.ts:persistToRemote()` 通过 `isShuttingDown()` 拒绝新的 remote transcript persistence。Codex 定向搜索只确认 `print.ts` 和 `sessionStorage.ts` 使用 `isShuttingDown()`；没有在 `main.tsx` 找到调用。

### SessionEnd 的状态可见性

`/clear` 调用可以从 `clearConversation` 参数接收 `getAppState/setAppState`，Interactive `/resume` 显式提供 `store.getState/setAppState`。process shutdown 的 `gracefulShutdown()` 只会转发调用者实际传入的 options；常见 `/exit`、signal、`renderAndRun` 和 Headless 调用通常没有传 AppState options。因此三类 SessionEnd 虽使用相同 timeout helper，hook 对 session-derived AppState 的可见性不能概括为完全相同。

Cache eviction hint 固定发送 `scope: 'session_end'` 和 `last_request_id`；当前代码没有把 shutdown reason 写入该事件。`reason` 进入 `executeSessionEndHooks(reason, ...)`。

### 运行验证

对当前 `cleanupRegistry.ts` 形状的独立实验观察到：

```json
["slow:start","fail:start","registry:rejected","after-await","slow:done"]
```

它验证了所有 handler 被启动、一个 reject 使 await 早结束、慢 peer 没有被取消且随后仍能完成。

M09 TypeScript/Python 独立 clean-room 实验各通过 8 个测试；H1 合入后的全量回归为 `12/12`，包含 S0 `15/15`，生命周期模块双语言各 `8/8`。

## clean-room LifecycleCoordinator 候选契约

Harness 新增：

```text
state: running -> stopping -> stopped
first shutdown request -> one shared Promise/Task and ShutdownReport
tier order: critical -> resource -> best-effort
same tier: parallel start + isolated result
```

- handler 接收合作式取消信号；timeout 记录 `timed-out`，不声称底层工作已物理取消；
- 一个 handler 失败不阻断 peer 或后续层；
- overall deadline 用尽时把未开始的低优先级工作记为 `skipped` 并触发 failsafe callback；
- `prepare` 在异步 cleanup 前运行，可尽早恢复外部表面并产生基于已持久化 identity 的 recovery hint；
- stopping 后拒绝新注册，unregister 幂等；
- Surface adapter 拥有 OS signal wiring、终端恢复/提示和最终 process exit，Coordinator 核心不直接调用 `process.exit()`。

上述 `critical/resource/best-effort` 是从当前快照限制迁移出的 Harness 设计，不冒充 Claude Code 的现有 registry API 或实现。

## 对 FACT_A 中不直接采纳表述的复核

请特别检查以下 Codex 裁决；它们不是要求你迎合，而是要求回到具体源码判断：

1. 不采纳“transcript flush 是 registry 第一个条目”的说法；惰性注册时间依赖首次 Project 创建，且 registry 无 priority。
2. 不采纳“`main.tsx` 使用 `isShuttingDown()` 防止新 command”的说法；请给出真实 call site，若存在则指出路径和行号。
3. 不采纳“shutdown reason 传入 cache eviction hint”的说法；当前 event payload 只有固定 scope 与 last request id。
4. 不把 Interactive Ctrl+C 按键行为与外部 OS SIGINT handler 合并成一条路径。
5. 不概括 `/clear`、`/resume`、process exit 三者都拥有等价 AppState access；应根据各 call site 是否传 options 判断。
6. `gracefulShutdownSync` 不是通过 `void` 丢弃 Promise；它把 catch 链赋给 `pendingShutdown`，但调用者仍不 await。

## 审查要求

只检查事实错误、重要遗漏、证据不足、生命周期/所有权/预算混淆，以及实验或 Harness 契约不能验证正文结论的问题。普通措辞偏好、完整 Task/MCP/Hook/Transcript/Sandbox 展开、专有源码重构建议和不会影响学习/Harness 的边缘问题不构成 Issue。

输出必须以以下三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后按 Issue 列出源码路径与符号、与 FACT_A 和 Codex 摘要的对照、为什么影响教材或 Harness，以及应接受的修正或定向验证。没有实质问题时明确写 `No material issues`。
