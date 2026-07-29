# M02 事实闸门记录

状态：`fact-reviewed`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max。

有效会话 ID：`af0ec5cf-0669-4124-953f-567a35909f78`

FACT_A 与 FACT_B 均从项目根目录运行，无权限拒绝，进程自然退出且未设置 Claude CLI 应用层超时。

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 5
```

盲审正确确认了 `query()`/`queryLoop()` 的 yield 与 return 类型、QueryEngine 的增量消费、非流请求的手动 `.next()`、StreamingToolExecutor 的缓存和 `Stream<T>` 的 push-to-pull 边界；但对消费者 `.return()` 穿过 `yield*` 的语义给出了错误结论，并把数项非阻断观察列为实质问题。

## 定向运行补证

Codex 使用原生 Node 运行嵌套 async generator：

```text
normal: inner after-yield -> inner finally -> outer after-yield* -> outer finally
outer.return(...): inner finally -> outer finally
```

提前 `.return()` 时，内外 `finally` 均执行，但外层 `yield*` 后代码不执行。该实验已经固化进 TypeScript 第 6 个契约测试。

## Codex 裁决

### M02-F01 `.return()` 后是否执行外层正常完成段

Decision: `rebutted`

Reason: FACT_A 声称外层会继续执行 completed 通知；原生 Node 运行结果、`src/query.ts:query()` 邻近注释及 FACT_B 的规范复核一致表明 Return completion 会关闭委托链并跳过 `yield*` 后的正常代码。

Change: 不修改正确的机制结论；新增嵌套 early-return 测试，并在正文解释 finally 与业务完成的区别。

### M02-F02 模型异常路径同时产生补位结果与 assistant 错误

Decision: `accepted`

Reason: 这是当前快照可见的错误消息组合，但不反驳本单元“throw 与业务 error message 是不同通道”的结论。

Change: 正文用缩小表述说明 catch 可能先补足 tool result，再产生 assistant 错误；不扩展为 M02 的业务错误目录。

### M02-F03 同步 helper generator 未显式 close

Decision: `rebutted`

Reason: FACT_A 自身确认 `yield*` 会自动关闭委托 generator，且该 helper 没有额外清理需求。

Change: 无。

### M02-F04 `executeNonStreamingRequest()` 的 `e.value.type`

Decision: `rebutted`

Reason: retry callback throw 会使 `await generator.next()` reject，不会成为可读取的 iterator result value。只有 `withRetry` 违反其正常 yield/return 类型契约时才会出现所述问题，本单元没有把静态类型冒充恶意输入防线。

Change: 正文明确 throw 与 IteratorResult.value 的边界。

### M02-F05 `queryLoop` 未保证所有外部资源取消

Decision: `accepted`

Reason: generator 关闭和外部资源取消确实不是同一保证，但该边界已经在工作簿中保留，具体 Node 资源、AbortSignal 和工具 discard 属于 M03/M15。

Change: 正文加入局部取消图，明确 finally 只证明控制流退出，不证明 socket、promise 或子进程已经停止。

## FACT_B

```text
GATE: FACT_B
VERDICT: REVISE
MATERIAL_ISSUES: 1
```

FACT_B 的唯一 issue 是要求撤回 FACT_A #1 自身的错误结论。它明确确认 Codex 关于 `.return()`、其余生成器语义、`Stream<T>`、背压和错误通道的摘要成立，并判定 FACT_A #2 至 #5 不构成对 M02 关键表述的实质冲突。

因此该 `REVISE` 不代表当前教材结论仍有待修事实；它是对前一阶段审查意见的纠错。经上述逐项裁决与正文边界修订，M02 可以进入教学审查。
