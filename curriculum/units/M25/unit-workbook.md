# M25 研究工作簿：Sandbox、Managed Policy 与扩展供应链

状态：`researched`

风险：`R3 -> R2`。安全结论容易把“有配置”误写成“已强制执行”，或把应用层检查误写成 OS 隔离，因此先按 R3 反证；边界闭合后以 R2 的代表性失败实验验收。

## 1. 单元问题与边界

本单元回答：一个工具已经通过模型可见性、Permission 和 Hook，为什么仍不能直接等价为“可以安全执行”？系统还需要怎样把策略、执行环境、秘密与扩展来源压到真正的副作用边界？

前置：M20 已解释 Tool/Permission/Hook 决策链，M21-M22 已解释 Skill/Plugin/MCP 的发现、注册与连接，M24 已解释 Transcript 与恢复。M25 不重复这些机制，而是纵向检查它们在安全边界上能否互相替代。

本单元包含：

- Permission 与 Sandbox 的职责分离；
- settings/permission 到 Sandbox runtime config 的投影；
- filesystem 路径、symlink、UNC 与读后写竞争；
- managed settings 的来源、刷新与失败语义；
- model context、subprocess、secure storage 三个秘密边界；
- Marketplace、Plugin、MCP 的来源和策略控制；
- H7-1 的 revisioned policy、worker envelope、secret reference 和 extension provenance。

本单元不包含：

- M26 的 telemetry、evaluation、usage/cost 和 quota；
- M27 的部署、灰度、回滚和容灾；
- `@anthropic-ai/sandbox-runtime` 内部未随快照提供的 OS primitive；
- “完全消除 TOCTOU”“所有子进程默认清密”“所有扩展均有签名验证”等无法由快照证明的承诺。

## 2. Graphify 候选与直接核验

Graphify 只把 `sandbox-adapter.ts`、`filesystem.ts`、`managedEnv.ts`、`securityCheck.tsx`、`marketplaceManager.ts`、`pluginPolicy.ts` 和 `mcp/config.ts` 聚到候选子图。以下结论均来自随后直接阅读源码，不以图关系为证据。

## 3. Permission 与 Sandbox

### 3.1 两个问题

- Permission 回答某次 capability invocation 是否被规则、Hook 或用户授权。
- Sandbox 回答实际 child process 能触达哪些 filesystem/network/process 资源。

`src/tools/BashTool/shouldUseSandbox.ts::shouldUseSandbox()` 先要求 `SandboxManager.isSandboxingEnabled()` 为真；只有 policy 允许 unsandboxed command 时，`dangerouslyDisableSandbox` 才能绕过。`excludedCommands` 的源码注释明确把它定义为 convenience，而不是 security boundary。

`src/utils/Shell.ts` 在 spawn 前调用 `SandboxManager.wrapWithSandbox()`，并在完成后走 Sandbox cleanup。真正执行限制委托给 `@anthropic-ai/sandbox-runtime`；快照适配层只证明配置、包装和生命周期，不证明底层每一种 OS 隔离 primitive。

### 3.2 可用性与启动

`src/utils/sandbox/sandbox-adapter.ts::isSandboxingEnabled()` 同时检查：

1. 平台支持；
2. runtime dependency；
3. `enabledPlatforms`；
4. `sandbox.enabled`。

显式启用但不可用时，REPL/print 会暴露原因。默认行为是警告后 unsandboxed 运行；`failIfUnavailable: true` 才拒绝启动。Native Windows 不在 runtime 支持平台内，PowerShell 路径还显式避免把 unsupported Windows 冒充 sandboxed execution。

不能从“settings 中写了 sandbox”推出“当前进程已经在 Sandbox 中”。

### 3.3 自动允许仍不覆盖 deny/ask

`autoAllowBashIfSandboxed` 只改变某些 Bash permission 的交互决策，显式 deny/ask 仍优先。Permission allow 也不应消除 Sandbox runtime denial。

## 4. Settings 到 runtime restriction 的投影

`src/utils/sandbox/sandbox-adapter.ts::convertToSandboxRuntimeConfig()` 把合并设置投影为：

- WebFetch/domain allow/deny -> network allow/deny；
- Edit/Read rules -> filesystem allow/deny；
- current directory、temporary directory 和 additional working directories；
- settings、managed drop-ins 与 `.claude/skills` 的 deny-write；
- bare Git repository 的 deny-write 与 command 后 scrub。

`allowManagedSandboxDomainsOnly` 与 managed-read-only 模式会排除低信任来源的 allow。settings change listener 同步调用 `BaseSandboxManager.updateConfig()`；显式 permission 更新还可调用 `refreshConfig()`，降低旧配置窗口。

这是一条 projection pipeline，不是“permission 规则原样传给内核”。投影必须保守，且 runtime config revision 应与将要执行的 worker 对齐。

## 5. Filesystem 与 TOCTOU 边界

`src/utils/permissions/filesystem.ts` 检查 original path、symlink chain、resolved path、dangling symlink 的 deepest existing ancestor，并对 UNC/suspicious Windows forms 采用更强处理。FileWrite/FileEdit 还要求先读、检查 timestamp/content，并在写入前再次确认当前状态。

这些检查降低 path bypass 与 stale write 风险，但应用层 `check -> use` 仍不能证明不存在 OS 级 race。教材应把它们描述为纵深防御的一层；Sandbox/OS enforcement 才是外层约束。Native Windows 下尤其不能声称已有进程级隔离。

## 6. Managed Settings

### 6.1 普通设置与 managed source 不是同一种合并

普通 settings 的默认 precedence 是：

```text
user -> project -> local -> flag -> policy
```

后来源覆盖前来源。managed source 的选择则是 first-source-wins：remote，HKLM/macOS plist，managed file 与按字母序 drop-ins，最后 HKCU fallback。两种规则不能混写成一个列表。

### 6.2 Remote policy 的失败语义

remote managed settings fetch 失败时：

- 有 cache：继续使用 stale cache；
- 无 cache：当前实现 fail open；
- 背景轮询约每小时一次。

危险 remote settings 变化会触发 security dialog；noninteractive path 不展示该 dialog。危险项包括会执行 shell 的 helper、非 allowlisted env 与 Hooks。不能写成“remote policy 永远 fail closed”。

policy change 会通知 settings listeners，并使 Sandbox 等下游刷新配置。但 refresh 本身不等于已运行 worker 的原子撤销，H7-1 需要显式 policy revision 检查。

## 7. Secret 边界

秘密有三个不同暴露面：

1. model-visible content；
2. trusted execution boundary 的 environment/argv；
3. host storage 与 logs/reports。

Project/local settings 在 trust 前只应用 safe allowlist env；trust 后才可能应用 merged env。host-managed provider 与 SSH tunnel variables 有专门保护。

`subprocessEnv()` 只在 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` 启用时清除一组已定义 credential；这不是默认、通用、完备的 secret stripping。

Plugin sensitive option 存入 `secureStorage`；macOS 优先 Keychain，其他平台当前落到 plaintext credential file。Skill/Agent 的 model-visible content 遇到 sensitive placeholder 时不会注入真实值。不能把非 macOS storage 称为 cryptographically secure。

H7-1 因此只让 model envelope 携带 `secretRef`，由 trusted worker boundary 解析；report 永远只保留 ref ID/count/status，不含 value。

## 8. Plugin、Marketplace 与 MCP 供应链

### 8.1 已有控制

- Marketplace blocklist 优先 allowlist，并在下载前检查。
- `strictKnownMarketplaces` 限制允许的 source。
- `enabledPlugins[id] = false` 阻止 install/enable。
- 配置允许时可自动卸载 delisted plugin。
- URL credential 与 custom header value 在 logs/progress 中脱敏。
- `strictPluginOnlyCustomization` 可禁止 loose user/project customization surface。
- MCP policy 支持 name、command、URL allow/deny；deny wins，空 allowlist 等价于全部阻止。
- `allowManagedMcpServersOnly` 把 allow decision 限于 managed settings；SDK-managed placeholder 例外，因为 CLI 不负责 spawn/connect。

### 8.2 没有被证明的控制

Marketplace schema、path check 和 cache/content hash 不证明 publisher authenticity。快照不能支持“所有 Plugin 有签名验证”的结论。MCP allow 也不等于 transport/process 被 Sandbox。H7-1 用明确 provenance/trust decision，unknown/untrusted 默认拒绝，但仍不冒充 PKI/signature verifier。

## 9. 状态所有者

| 状态 | Owner | 可修改者 | 只观察者 |
| --- | --- | --- | --- |
| merged settings | settings subsystem | source loaders/policy refresh | Tool、Sandbox projector |
| Sandbox runtime config | SandboxManager/runtime | initialize/refresh | command caller |
| Permission decision | decision pipeline | rules/hooks/user resolver | Tool dispatcher |
| path read state | ToolUseContext | successful read/write/edit | permission UI/model |
| managed policy cache | remote managed settings service | fetch/poll/cache loader | merged settings |
| sensitive Plugin values | secure storage | plugin option save/delete | model content 只见 placeholder |
| extension policy | plugin/MCP policy resolver | managed/user settings | loader/connector |
| H7-1 policy revision | `PolicyEngine` | trusted control plane | worker request |
| H7-1 secret value | `SecretResolver` | trusted host store | model/report 不可见 |

## 10. H7-1 候选契约

新增 TypeScript/Python 等价实现：

- revisioned `PolicyEngine`；
- `ExecutionEnvelope`，包含 worker identity 与 expected policy revision；
- filesystem/network/process capability constraints；
- `SecretRef` 只在 trusted execution boundary 解析；
- extension provenance/trust decision；
- policy stale、worker mismatch、sandbox unavailable、secret missing、extension unknown 时 fail closed；
- metadata-only `SecurityReport`。

实现只提供 `SandboxPort` 和 deterministic fake，不能声称真实 OS Sandbox、native Windows isolation、complete TOCTOU elimination、distributed policy service 或 signature verification。

## 11. 实验假设与反证条件

| 实验 | 要确认的结论 | 反证条件 |
| --- | --- | --- |
| stale revision | 旧 policy snapshot 不得执行 | worker 仍运行 effect |
| permission/sandbox | Permission allow 不能越过 Sandbox deny | denied path/domain 被执行 |
| required sandbox | runtime 不可用时 fail closed | 自动 unsandboxed fallback |
| capability projection | fs/network/process 独立限制 | 任一限制被另一层 allow 覆盖 |
| secret boundary | model envelope/report 无明文 | serialization 出现 secret value |
| extension trust | unknown/untrusted default deny | 无 provenance 仍执行 |
| cancellation | effect 前取消不触发 worker | worker 调用次数增加 |

## 12. 事实闸门范围

重点反证：

- Permission allow 等价于安全执行；
- `sandbox.enabled` 等价于 Sandbox 已生效；
- excludedCommands 是安全边界；
- remote managed settings 永远 fail closed；
- `subprocessEnv()` 默认清除所有秘密；
- secureStorage 在所有平台均为加密存储；
- Marketplace hash/schema 等价于 publisher signature；
- path/symlink 检查完全消除 TOCTOU；
- Native Windows 已有 snapshot 证明的 process sandbox。
