# M25 事实闸门审查与裁决

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 7
```

独立盲审确认了 Permission/Sandbox 分层、Sandbox 四个启用条件、Native Windows 边界、remote managed settings cache/poll、secret substitution/subprocess env、Marketplace/MCP policy、无通用 publisher signature guarantee 与 filesystem TOCTOU 边界。

它特别要求正文显式说明：

- `excludedCommands` 虽不是可靠匹配式 security boundary，但命中后确实使命令离开 Sandbox；
- weaker nested/network isolation 是配置的能力降级；
- noninteractive remote managed settings path 跳过危险变化的交互确认；
- Native Windows 在 policy 要求 Sandbox 且禁止 unsandboxed command 时拒绝 PowerShell。

## Codex 裁决

| Issue | Decision | Reason | Change |
| --- | --- | --- | --- |
| M25-A1 Permission 与 Sandbox 淆合 | accepted | `checkSandboxAutoAllow` 仍先看 deny/ask，runtime restriction 独立 | 正文用两问模型和纵深防御链 |
| M25-A2 默认未启用被称为 silent failure | rebutted | 默认未启用不是运行失败；只有显式启用但不可用才触发告警/拒绝语义 | 明确区分 disabled 与 unavailable |
| M25-A3 excluded command 风险 | accepted | 命中后 `shouldUseSandbox=false`，隔离确实降级；但 Permission 仍是实际授权控制 | 不再只写“不是边界”，同时写清退出 Sandbox 的效果 |
| M25-A4 Native Windows | accepted | runtime unsupported；严格 enterprise policy 下 PowerShell fail closed | 加入 Windows 决策分支图 |
| M25-A5 noninteractive remote policy | accepted | `securityCheck` 返回 `no_check_needed`，危险变化不走交互确认 | 加入 headless 风险和企业迁移建议 |
| M25-A6 secret 三个暴露面 | accepted | model substitution、subprocess env 与 host storage 的保证不同 | 按模型/执行/存储三条边界展开 |
| M25-A7 publisher authenticity | accepted | schema/path/hash 不能证明发布者真实性 | H7-1 只做 provenance allow，不冒充签名验证 |

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同一会话逐条接受 Codex 校准结论与 H7-1 契约，无剩余实质问题。
