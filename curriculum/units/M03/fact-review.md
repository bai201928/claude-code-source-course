# M03 事实闸门记录

状态：`fact-reviewed`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max。

有效会话 ID：`c9c0e5fd-944f-4665-9341-3a2e2d37768b`

FACT_A 与 FACT_B 均自然退出，未设置 Claude CLI 应用层超时，无权限拒绝。

## FACT_A

```text
GATE: FACT_A
VERDICT: PASS
MATERIAL_ISSUES: 1
```

盲审确认了 BashTool、runShellCommand、Shell.exec、ShellCommandImpl、TaskOutput、AbortController 与 graceful shutdown 的主链、所有权和平台边界。它把 `createCombinedAbortSignal()` 不传递来源 reason 列为一项 H0 契约问题，同时确认当前 Bash 主链不使用该 helper。

## Codex 裁决

### M03-F01 combined signal 丢失 reason 是否破坏 H0

Decision: `rebutted`

Reason: 快照 helper 的 `combined.abort()` 确实不传 reason，正文已经将其作为快照事实明确写出；Bash 主链传递原始 `abortController.signal`。M03 clean-room H0 没有复用该 helper，而是有意实现保留 parent/timeout reason 的 `CancellationScope`，并标为设计迁移。

Change: 不修改正确的机制结论。保留正文中快照 helper 与 H0 设计的并列边界，避免学习者把两者混同。

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

FACT_B 逐项核对并确认：

- BashTool 手动消费 async generator，progress 与最终 ExecResult 的通道分开；
- file mode、pipe mode、TaskOutput 与 progress race 的叙述准确；
- timeout、abort、kill、background 和 cleanup 的状态/所有权边界准确；
- ShellCommand result 是逻辑完成，不等于 OS `exit` 确认；
- child 与 combined 两种取消组合的 reason 语义准确；
- H0 的更强退出确认和 reason 保留均已正确标为设计迁移；
- 双语言实验比较生命周期顺序而不比较平台裸退出码，契约有效。

结论：M03 没有待修的实质性事实问题，可以进入教学闸门。
