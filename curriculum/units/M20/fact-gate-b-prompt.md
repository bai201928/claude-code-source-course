# M20 事实闸门 B：同会话对照

继续当前 M20 FACT_A 会话，只检查下面的 Codex 裁决和拟写入边界。不要重新总结仓库，不要读取 Graphify、M20 工作簿、Harness、教材草稿或其他单元。

## Codex 机制摘要

- 外层 `callTool()` 先处理 unknown tool 和入口 abort，再进入 streamed wrapper 与 `checkPermissionsAndCallTool()`。内层顺序是 schema、`validateInput`、PreToolUse、Hook/Permission 合流、最终 allow、`tool.call()`、PostToolUse 或 PostToolUseFailure、paired result。
- 多个 Hook 并行执行，permission behavior 单调聚合为 `deny > ask > allow`；但 result 是按完成顺序被消费，updatedInput、reason/source 并不是一个强一致、确定顺序的 provenance ledger。多个改写可能呈现 last-observed/完成顺序覆盖。
- Hook allow 只可能跳过普通 interactive prompt；`checkRuleBasedPermissions()` 中的 whole-tool deny/ask、tool-specific deny/content ask 和 bypass-immune safety check 仍可覆盖。requires-interaction 未被 updatedInput 满足或 `requireCanUseTool` 为真时仍走 `canUseTool`。
- 初始 schema 和 `validateInput` 只在 PreToolUse 前完整执行一次。Hook/Permission/user 的 fresh updatedInput 可能在 permission 内被 `inputSchema.parse()`用于 `checkPermissions`，但没有统一重跑 `safeParse + validateInput`；parse 非 abort 异常还会被记录后继续。
- interactive path 用 permission queue 与 resolve-once race；headless/async 无 dialog 时先跑 PermissionRequest Hook，无决定即 deny。Hook failure 不自动 allow；auto classifier unavailable 的 fail-open/fail-closed 受 feature gate 控制。
- 外层入口、Hook 执行和 permission adapters 多处检查 abort；最终 allow 到 `tool.call()` 之间没有执行器级最后取消检查。具体 handler 可能协作观察 signal，但不是统一强保证。
- validation fail、PreHook stop、permission non-allow、handler throw/abort 与成功都由总编排生成原 `tool_use_id` 的 paired result；Hook attachment 不能替代它。
- `preventContinuation` 与阻止当前 handler 不同：仅设置该标志而没有 deny/block/abort 时，当前工具仍可能执行，成功后追加 stopped-continuation attachment。
- PostToolUse/PostToolUseFailure 都发生在副作用或错误之后。Post block/stop 只能影响后续 continuation/可见反馈；不能撤销已发生的文件、网络或进程副作用。非 MCP result 在 PostHook 前装配，MCP output 可由 PostHook 更新后再映射。
- Permission 决定是否授权调用/如何改写输入；Sandbox 决定获准 Bash 实际在什么资源边界内运行。sandbox 状态可影响 Permission，但 allow 不等于隔离。

## 对 FACT_A 的最小校正

1. FACT_A 摘要把 `toolExecution.ts:415` 叫作 pipeline 进入检查。精确 owner 是外层 `callTool()`，它在调用 `streamedCheckPermissionsAndCallTool()` 前检查；`checkPermissionsAndCallTool()` 内没有同等入口或 pre-effect 复查。
2. FACT_A 对 Hook `permissionBehavior` 的单调聚合正确，但请复核多个 Hook 的 `updatedInput`、reason/source 是否可能因 `all(hookPromises)` 完成顺序和外层变量覆盖而非确定性选择。
3. 请复核 `preventContinuation` 是否单独阻止当前工具调用，还是只有 blockingError/deny、abort/stop 才阻止，标志本身在工具成功后才表现为 continuation attachment。
4. FACT_A 列出的 paired exits 应区分 outer `callTool()` catch 与 inner handler catch，但只要教材称总编排保证配对即可。

## H4-1 迁移契约

Clean-room Harness 不复制上述弱保证，而采用：

- immutable、revisioned `DecisionContext`；
- Hook rewrite 后统一重跑 schema 与 semantic validator；
- Hook proposals、rule winner、human/headless resolver 都保留 content-free provenance；
- final allow 后、handler side effect 前再检查 AbortSignal；
- 一个 call 由 finalizer 恰好提交一个 paired result；
- PostHook block 明确只阻止 continuation，不宣称回滚。

这属于设计迁移，不得反推为 Claude Code 当前事实。

## 输出要求

只报告影响快照事实、教材关键表述、实验有效性或 H4-1 契约的问题；无现实影响的问题不要列出。必须以下列三行开头：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如果接受上述边界，明确写 `PASS / 0`；若有问题，给出最小修正和源码理由。
