# M15 事实闸门 B：同会话对照

继续当前 FACT_A 会话。现在对照 Codex 的研究结论，只检查错误、重要遗漏、证据不足或推断冒充事实，不重复总结仓库。

## Codex 结论

- `needsFollowUp` 由实际 assistant `tool_use` block 设置，不信任 stop reason。
- gate 开启时，完整 block 一到就进入 `StreamingToolExecutor`；关闭时 response 完成后走 `runTools()`。
- safe/unsafe 在 schema parse 后调用 `isConcurrencySafe(parsedInput)` 动态判断；异常保守 unsafe。
- response-complete 路径把连续 safe calls 分 batch 并发、unsafe 单独成 exclusive barrier；safe context modifiers 在 batch 结束后按 block 原顺序应用。
- streaming executor 状态是 queued/executing/completed/yielded；safe 可并发，unsafe 需要独占并形成调度屏障；progress 立即可见，safe final result 可按完成推进并靠 ID 配对。
- streaming executor 当前不支持 concurrent safe tool 的 context modifier，只应用 unsafe modifier；这与 response-complete path 不完全等价。
- 两条 scheduler 共用 `runToolUse()`：lookup -> schema -> validateInput -> PreToolUse -> permission resolution -> call -> result mapping -> PostToolUse，异常走 PostToolUseFailure。接受 FACT_A 的补充：PreToolUse Hook allow 不是无条件放行，deny/ask rule 仍能覆盖或要求交互；Hook deny 直接拒绝。
- Hook/permission 可以返回 updated input；源码有 observable clone 与 actual call input 的边界。
- unknown、invalid、denied、hook stop、throw、abort 都必须生成 user-role paired tool_result。
- 只有 Bash error 触发 sibling abort；普通 read/web failure 不取消兄弟。`sibling_error` 不向父 Query abort；permission-dialog 等非 sibling 的 per-tool child abort 由显式 listener 冒泡父 Query。user `interrupt` 只取消声明 cancel behavior 的工具。
- abort 后 Query Loop 必须 drain executor 或补 missing results。fallback discard 防旧 ID result 泄漏但不能回滚副作用。
- 工具结束后 Query Loop normalize result、更新 context，先完成全部 tool results 再加入普通 attachments，next state 组合 history + assistant + toolResults 并发起下一轮。

## 拟验证实验

双语言 deterministic executor 测 safe-safe 并发、unsafe barrier、bounded concurrency、paired invalid/deny/error/cancel、progress、Bash-like sibling cascade、ordered context modifiers 和 next-request completeness。

## Harness 决策

合入统一 executor core、显式 plan、bounded concurrency、exact pairing 和 outcome；Provider SSE 触发、durable idempotency、Hook/MCP 完整 ABI 延后；拒绝无差别 Promise.all 和省略错误结果。

必须以下列三行开头：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

仅报告实质问题，普通边缘问题不阻断。不得修改任何文件。
