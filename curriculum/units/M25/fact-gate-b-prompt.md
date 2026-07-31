# M25 FACT_B：同会话对照

继续 FACT_A 会话，只核对下面 Codex 结论。不要重新总结仓库，不读取 Graphify，不修改文件。

## Codex 结论

- Permission 决定 capability invocation 是否被授权；Sandbox 限制真实 child process 的 filesystem/network 环境。Permission allow 不能覆盖 Sandbox deny。`autoAllowBashIfSandboxed` 仍尊重显式 deny/ask；若配置允许 weaker nested/network isolation，教材必须把降级写成边界而不是等价隔离。
- `shouldUseSandbox()` 只有在平台、dependency、enabledPlatforms 和 setting 均满足时才返回可用；`dangerouslyDisableSandbox` 仅在 policy 允许 unsandboxed commands 时绕过；`excludedCommands` 是 convenience，不是可靠匹配式 security boundary，但命中时确实使该命令离开 Sandbox，因此属于用户主动配置的隔离降级，仍要接受真实 Permission 控制。
- Shell 在 spawn 前通过 `SandboxManager.wrapWithSandbox()` 包装并在完成后 cleanup。OS enforcement 委托给 `@anthropic-ai/sandbox-runtime`，快照适配层不证明每个底层 primitive。
- 默认未启用 Sandbox 不是“Sandbox 静默失败”；显式启用但不可用时，默认警告后 unsandboxed 运行，`failIfUnavailable: true` 才拒绝启动。Native Windows 不受 runtime 支持，PowerShell 不能冒充已 sandbox；若企业策略同时要求 Sandbox 且禁止 unsandboxed command，Windows PowerShell 路径会拒绝执行。
- `convertToSandboxRuntimeConfig()` 把 domain、Read/Edit、managed-only 模式、settings/skills protection、additional working directories 与 bare Git mitigation 投影到 runtime config；settings change 同步更新 config。
- filesystem permission 检查 original/resolved path、symlink chain、dangling ancestor 与危险 Windows/UNC forms；FileWrite/Edit 有 stale-read checks。这降低绕过与竞争，但不证明彻底 TOCTOU-proof。
- 普通 settings 按 user -> project -> local -> flag -> policy 后者覆盖；managed source 采用 remote -> machine/plist -> managed file/drop-ins -> user-machine fallback 的 first-source-wins。
- remote managed settings fetch 失败时有 cache 用 stale cache，无 cache fail open；约小时级 polling。危险 remote change 可触发 security dialog，noninteractive path 跳过交互式确认；请核对这是否意味着变化直接应用，不能把“没有对话框”自动扩大为未被源码证明的其他语义。无论如何不能写成 remote policy 永远 fail closed。
- trust 前 project/local 只应用 allowlisted safe env；`subprocessEnv()` 只有在 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` 启用时 scrub 一组 credential，并非通用默认清除。
- Plugin sensitive option 不进入 model-visible Skill/Agent content；macOS storage 优先 Keychain，其他平台当前是 plaintext credential file，不能统称 cryptographically secure。
- Marketplace blocklist 先于 allowlist/download；strict known marketplace、disabled/delisted plugin、Plugin-only customization 与 MCP name/command/URL policy 提供来源约束。MCP deny wins，空 allowlist 阻止全部，managed-only 模式只接受 managed allow；SDK-managed placeholder 因 CLI 不 spawn/connect 而例外。
- schema/path validation 和 cache/content hash 不证明 publisher authenticity；快照不支持通用 Plugin signature-verification 保证。

## H7-1 候选契约

实现 revisioned `PolicyEngine`、带 worker identity/policy revision 的 execution envelope、filesystem/network/process constraint、trusted-boundary `SecretRef` resolution、extension provenance decision、fail-closed checks 与 metadata-only SecurityReport。它只提供 port 和 deterministic fake，不声称真实 OS Sandbox、native Windows isolation、complete TOCTOU elimination、universal secret stripping、signature verifier 或 production distributed policy service。

代表性实验：stale policy、Permission allow + Sandbox deny、required Sandbox unavailable、filesystem/network/process denial、secret 不进入 model envelope/report、unknown/untrusted extension、effect 前 cancellation。

只报告会改变上述快照事实、实验或 H7-1 契约的实质问题。必须以下列三行开头；接受时明确 PASS / 0。

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```
