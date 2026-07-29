# FACT_B 同会话对照提示词

继续 FACT_A 会话，把你的独立源码结论与以下 Codex 摘要、教材关键表述和实验逐项对照。只在发现明确冲突时定向回读源码；不要扩大到 M03 之外的系统，也不要修改任何文件。

## Codex 机制摘要

- `BashTool.call` 手动 `.next()` 消费 `runShellCommand()`：中间值转交 `onProgress`，`done: true` 的 value 才是最终 `ExecResult`。
- `runShellCommand()` 调用 `Shell.exec()`，先等待 result 或 progress threshold；进入进度模式后用 `Promise.race(resultPromise, progressSignal)` 反复等待结果或轮询通知，并在 `finally` 停止 TaskOutput polling。
- `Shell.exec()` 在 spawn 前检查已取消 signal；默认 Bash 是 stdout/stderr 共用输出文件的 file mode，只有提供 `onStdout` 时才进入 Node Readable 的 pipe mode。spawn 不直接接收 AbortSignal，终止由 `ShellCommandImpl` 的 tree-kill 路径管理。
- `ShellCommandImpl` 拥有 child、status、timeout、abort listener、result resolver、TaskOutput/StreamWrapper 和 watchdog。`background()` 是所有权转移，child 继续运行；`cleanup()` 清 listener、timer、wrapper 和引用，本身不 kill。
- abort reason 为 `interrupt` 时当前层不 kill，给上层后台化机会；其他 reason 调用 kill。`#doKill()` 发出 tree-kill 请求后主动 resolve 内部 exit-code promise，所以 ShellCommand result 是逻辑完成，不保证已观察到 OS `exit`。
- 监听 child `exit` 而非 `close` 是为了避免继承 stdio fd 的孙进程延长前台等待；不能据此宣称所有后代和 fd 已关闭。
- `createChildAbortController()` 单向传播 parent reason；`createCombinedAbortSignal()` 汇合输入与 timeout，但当前调用 `combined.abort()` 不传 reason，并返回显式 cleanup。
- `cleanupRegistry` 以 `Promise.all` 并行清理；`gracefulShutdown` 为 cleanup、SessionEnd hooks 和 analytics 分别设置预算，并有总体 failsafe，最终 force-exit。

## 教材关键边界

教材已经明确写出：

1. `createCombinedAbortSignal()` 当前不保留来源 reason；需要区分 user、timeout、parent failure 的消费者不能假定该 helper 已编码原因。
2. Bash 主链传递原始 `abortController.signal`，没有把 combined helper 描述成该主链的一部分。
3. H0 clean-room `CancellationScope` 有意保留 parent/timeout reason。这是作者的设计迁移，不是 Claude Code 快照事实，也不复用 `createCombinedAbortSignal()`。
4. H0 `ProcessPort` 把 `termination requested` 与 `exit confirmed` 分开；它采用比快照 ShellCommand result 更强的确认契约，正文显式说明两者不同。
5. timeout、cancel、kill 和 background 是不同动作；`AbortSignal.aborted` 不等于进程已经退出，background 也不等于 cancel。
6. 默认 file mode 与 `onStdout` pipe mode 分开讲，未把所有 Bash 输出误写为 `child.stdout.on('data')`。

## 运行实验

TypeScript clean-room 测试 5/5、demo 和 strict typecheck 均通过；Python 测试 5/5 和 demo 均通过。测试覆盖 event-loop 基本顺序、流式 stdout/stderr、正常 child 完成、外部取消、timeout 和幂等逆序 cleanup。

代表性取消生命周期在两种实现中均为：

```text
cancel.requested
-> process.exited
-> cleanup.finished
```

TypeScript 在当前 Windows 环境观察到 `exitCode: null, signal: SIGTERM`；Python 返回平台相关 numeric exit code。共享契约只比较生命周期顺序和领域状态，不比较裸退出码。

## 对 FACT_A Issue #1 的待裁决边界

FACT_A 把 `createCombinedAbortSignal()` 丢失 reason 称为“H0 契约缺陷”，但同时确认当前 Bash 主路径不使用该 helper。请重新核对：

- 若你的意思是“快照 helper 存在潜在组合风险”，教材已经准确呈现，应不再算教材或 H0 的 material issue。
- 若你认为当前 M03 的 clean-room H0 契约仍有真实缺陷，请指出具体代码路径、失败输入和错误观察；不能仅以快照 helper 的行为推导 clean-room 实现也丢失 reason。
- 不评估未来假设调用方的恶意用法；只检查当前快照事实、代表性实验和 H0 已声明契约。

输出必须以三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

只报告事实错误、重要遗漏、证据层次混淆或实验/H0 契约无效。无问题写 `No material issues`。
