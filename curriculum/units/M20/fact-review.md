# M20 事实双闸门与 Codex 裁决

状态：`fact-reviewed`

审查会话：见 `fact-session-id.txt`

## FACT_A

```text
GATE: FACT_A
VERDICT: PASS
MATERIAL_ISSUES: 0
```

独立 Claude Code/DeepSeek Max 源码盲审确认：

- Tool ABI、初始 schema、`validateInput`、PreToolUse、Permission、handler、PostHook 与 paired `tool_result` 的主链成立；
- 多个 PreToolUse Hook 并行运行，permission behavior 按 `deny > ask > allow` 单调聚合；
- Hook allow 仍受 explicit deny/ask、tool-specific rule、content ask 与 bypass-immune safety check 约束；
- fresh `updatedInput` 没有统一重跑 schema 与业务 `validateInput` 的强保证；
- interactive permission 使用 resolve-once 竞争收敛，headless/async 路径在 PermissionRequest Hook 无决定或失败时拒绝；
- allow 与 `tool.call()` 之间没有统一执行器级最终 abort 复查；
- PostToolUse/PostToolUseFailure 发生在副作用或失败之后，不能回滚；
- 总编排为成功、验证失败、拒绝、Hook stop、handler throw 和 abort 形成原 ID 的配对结果；
- Permission 决定授权，Sandbox 决定获准 Bash 的隔离边界，两者不可互换。

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同一会话对照审查接受 Codex 的四项精确化：

1. 入口 abort 的 owner 是外层 `callTool()`；内层 `checkPermissionsAndCallTool()` 没有同等的 pre-effect 复查。
2. 聚合 behavior 虽然安全单调，但 `updatedInput`、reason 与 source 依 Hook 完成顺序消费；多个改写可能由最后观察到的完成结果覆盖，不能称确定性的 provenance ledger。
3. `preventContinuation` 单独存在时不阻止当前 handler；没有 deny/block/abort，工具仍可执行，停止 continuation 的 attachment 在之后出现。
4. paired result 是外层与内层共同构成的总编排保证，不应错误归给单个 inner catch。

## Codex 最终边界

M20 教材采用以下表述：

- `[FACT]`：当前快照采用并行 Hook 与单调 permission 聚合，但 input rewrite 与 provenance 选择没有形成有序、revisioned transaction。
- `[FACT]`：初始输入完整验证不等于所有后续改写都完整再验证。
- `[FACT]`：多处取消检查不等于 final allow 到副作用之间存在统一最后闸门。
- `[FACT]`：PostHook 能改变后续 continuation 或可见结果，不能撤销已经发生的文件、网络或进程副作用。
- `[FACT]`：总编排保证工具调用获得 paired result；Hook attachment 不能替代 result。
- `[DESIGN]`：H4-1 使用有序 Hook、immutable revisioned context、每次改写后的 schema + semantic revalidation、显式 metadata evidence、pre-effect abort recheck 和一次结果 finalizer。这些更强保证不得反推成 Claude Code 当前实现。

两道事实闸门均无实质 Issue，不需要第三次事实复审。
