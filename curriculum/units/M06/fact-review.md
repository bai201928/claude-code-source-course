# M06 事实闸门记录

状态：`fact-reviewed`

事实会话：`0710da42-ecaf-4b56-b9d9-50143248b23a`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max；主审模型为 `deepseek-v4-pro[1m]`，进程均自然退出，无应用层超时、无权限拒绝。

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 3
```

盲审确认了默认来源顺序、三类合并/选择规则、缓存、trust 前后环境变量、headless 和远程策略热更新。它提出：remote per-source/merged validation 路径分歧、whole-file Zod rejection、safe allowlist 包含 provider switch 变量。

Codex 裁决：

- remote cache 分歧是真实边界，但正常 fetch 在入缓存前已验证；记录而不为理论坏缓存扩张实验；
- whole-file schema rejection 影响学习和实验，接受并加入失败路径；
- `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` 可在 trust 前从 project/local 生效，接受并与 attacker-controlled base URL 重定向明确区分；
- FACT_A 的“headless 等于无需信任”被驳回；准确说法是产品内无交互 gate、调用者必须预先信任目录。

## FACT_B 与定向纠错

初次 FACT_B 对照给出矛盾的 `PASS / 2`，其中一项误称 CLI inline `--settings` 直接写 `flagSettingsInline`。Codex 回到 `main.tsx:loadSettingsFromFlag()` 发现当前快照实际写内容哈希临时文件并设置 `flagSettingsPath`；`setFlagSettingsInline()` 是 `print.ts` SDK control path。

同一会话定向复核后，审查者撤回误读并确认：

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

## Codex 追加发现：显式来源过滤改变迭代顺序

实现实验前，Codex 发现 `getEnabledSettingSources()` 没有按 `SETTING_SOURCES` 重新排序，而是：

```text
new Set(allowed)
-> add(policySettings)
-> add(flagSettings)
-> Array.from
```

同一 FACT 会话补审确认：

```text
GATE: FACT_B_ORDER
VERDICT: REVISE
MATERIAL_ISSUES: 1
```

实际顺序：

| 输入 | 当前快照迭代顺序 |
| --- | --- |
| 默认 | user -> project -> local -> flag -> policy |
| `user,project,local` | user -> project -> local -> policy -> flag |
| `local,user` | local -> user -> policy -> flag |
| 空列表 | policy -> flag |

这直接改变最终值，不能作为无关漏洞忽略。教材已修正为“默认/设计意图”和“显式参数的快照行为”两层；clean-room 同时验证 compatibility order，并让 H1 使用显式 canonical order，避免复制偶然 Set 顺序。

## 最终收口

完成兼容顺序实验和 H1 canonical contract 后，同一会话做最终定向对照：

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

审查者确认 `FACT_B_ORDER` 的问题已由条件化教材表述、双顺序函数、provenance 和回归测试完整闭合。

## 结论

M06 事实范围在接受上述修正后闭合。正文不得无条件声称 policy 始终最后覆盖，也不得把 `--setting-sources` 只描述成不会改变优先级的过滤器。最终 FACT_B 已通过，不重开全量盲审。
