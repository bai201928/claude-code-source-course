# M03 研究工作簿

状态：`final`

Graphify 只用于候选定位；以下结论均回到当前 `claude-code-CLI/` 静态快照核验。

## 1. 核心问题与边界

核心问题：为什么已经理解 `async/await` 和 async generator，仍会误判一个长命令的启动、输出、timer、取消、进程退出和资源清理顺序？

本单元沿 Bash 长命令闭合 Node event loop、microtask/timer、Readable stream、child process、`AbortController`/`AbortSignal`、process signal 与 cleanup。Bash 权限和 Sandbox 留到 M22/M39；Tool 并发留到 M15；后台 Task 的完整生命周期留到 M36。

风险：R2。代表性风险是把 abort 当作进程已退出，把 generator finally 当作所有资源已清理，或把 background 当作 cancel。

## 2. 真实调用链

```text
BashTool.call
-> runShellCommand async generator
-> Shell.exec(command, abortSignal, 'bash', options)
-> child_process.spawn(..., signal 不直接传入)
-> wrapSpawn / ShellCommandImpl
-> result Promise + timeout + abort listener + TaskOutput
-> runShellCommand Promise.race(result, progress signal)
-> BashTool.call 手动 next，转发 progress 并取得 ExecResult
```

## 3. 源码锚点与决定性语义

- `src/tools/BashTool/BashTool.tsx:BashTool.call`：手动 `.next()` 消费 `runShellCommand`，progress 进入 `onProgress`，done 时取得 `ExecResult`。
- `runShellCommand()`：初始 progress threshold、共享 TaskOutput poller、`Promise.race(resultPromise, progressSignal)`、显式/自动后台化、finally 停止 polling。
- `src/utils/Shell.ts:exec()`：若 signal 已 aborted 则不 spawn；创建 shell command、TaskOutput 与输出 fd；调用 `spawn()` 时故意不传 `signal`，由 ShellCommand 用 tree-kill 管理进程树。
- `src/utils/ShellCommand.ts:ShellCommandImpl`：拥有 child、status、timeout、abort listener、result resolver、stream wrappers 和 size watchdog。
- `src/utils/combinedAbortSignal.ts:createCombinedAbortSignal()`：合并两个 signal 与 timeout，并返回 cleanup 清 timer/listener；当前实现合并 abort 时不保留来源 reason。
- `src/utils/abortController.ts:createChildAbortController()`：父 abort 单向传播给 child，child abort 不反向传播；WeakRef 避免父强持有废弃 child。
- `src/utils/cleanupRegistry.ts` / `gracefulShutdown.ts`：全局 cleanup 并行执行，graceful shutdown 以 2 秒 race 限制清理，再执行有预算的 hooks 与 analytics flush。

## 4. 输出与 Stream 边界

默认 Bash file mode 将 stdout/stderr 指向同一个文件 fd，按平台处理 append/write 语义；进度由 TaskOutput 轮询文件尾部。提供 `onStdout` 时进入 pipe mode，Node Readable 的 data listener 经 StreamWrapper 写入 TaskOutput，调用方还可并列监听同一 data chunk。

结论：Node Stream 既可能以 event 模式消费，也可能是文件 fd/轮询链；不能把所有 Bash 输出画成 `child.stdout.on('data')`。

## 5. timeout、abort、background 不是同一个动作

- 构造 ShellCommand 时注册 timeout 和 abort listener。
- timeout 若允许自动后台化且已有 callback，则 background；否则调用 `#doKill(SIGTERM)`，逻辑结果码用于 timeout 标记，实际进程树由 tree-kill 以 SIGKILL 请求终止。
- abort reason 为 `'interrupt'` 时 `#abortHandler()` 不 kill，让上层有机会把命令转后台；其他 reason 调用 `kill()`。
- `background()` 将状态改为 backgrounded，清除前台 timeout/abort listener；file mode 启动输出大小 watchdog，pipe mode spill buffer。进程继续运行。
- `cleanup()` 只清 stream listener、TaskOutput、timer/listener 与引用，不负责 kill；调用时机必须在完成/被 kill 后，或由后台 owner 接管。

## 6. 退出、结果与清理

ShellCommand 监听 child `exit` 而不是 `close`，避免继承 fd 的孙进程让前台永久等待；随后从 TaskOutput 读取输出并 resolve result。调用方 `await shellCommand.result` 后，Shell.ts 还通过更早注册的 `.then()` 同步处理 cwd 文件，使 cwd 更新在调用方继续前完成。

取消请求只表示 signal 已 aborted；只有 child exit/error 或内部 kill 主动 resolve exit code 后，result 才收敛。clean-room 实验需分别记录 `abort.requested`、`kill.sent`、`child.exit` 和 `cleanup.finished`。

## 7. 实验与反证

TypeScript/Python 验证：event-loop 基本顺序、流式 stdout/stderr、正常 child 完成、外部取消后等待退出、timeout 后等待退出、cleanup 幂等与所有权。

反证条件：abort 后 result 在 child exit 前报告 completed；timeout timer 未清导致已完成 run 后再次修改状态；cleanup 执行两次副作用；stdout 事件在最终结果中丢失。

## 8. H0 候选

- `CancellationScope`：父/子或组合 signal，保留 reason，提供 cleanup。
- `ResourceScope`：注册有顺序且幂等的 disposer，取消请求与 close confirmation 分开。
- `ProcessPort`：输出事件、exit confirmation、kill policy。
- `Clock`：timer 可替换，测试不用真实长等待。

初步裁决：`merge` Cancellation/Resource/Clock 契约；真实进程树 kill 保持 adapter 能力，不塞进通用事件端口。

事实闸门结果：FACT_A `PASS / 1`，FACT_B `PASS / 0`。FACT_A 唯一观察是快照 `createCombinedAbortSignal()` 不保留 reason；该事实已在正文明确标注，且 Bash 主链不使用该 helper。FACT_B 确认 H0 `CancellationScope` 保留 reason 是独立设计迁移，不构成快照或 H0 契约缺陷。

## 9. 证据边界

Claude Code Shell/Bash/cleanup 行为是快照事实；双语言 child-process 实验是运行验证；H0 ResourceScope 与企业取消协议是设计迁移。Windows clean-room 实验不证明 POSIX process group 的全部信号行为。
