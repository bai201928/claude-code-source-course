# M21 事实双闸门与 Codex 裁决

状态：`fact-reviewed`

审查会话：见 `fact-session-id.txt`

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 5
```

FACT_A 的五项计数来自提示中要求反证的五个常见误写。审查者逐项证明这些说法不成立，所得事实与 Codex 工作簿一致；它们不是 Codex 现有结论的五个反例。审查同时留下三个需要在同会话收敛的边界：sensitive `userConfig` 的占位符实现、本地与 Plugin/MCP Skill 的 shell 展开差异、MCP/LSP 消费配置时的 secret substitution。

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同一会话逐项接受以下结论：

- `SKILL.md` 全文在发现阶段读入，调用阶段才把正文投影到消息并执行允许的展开；
- 本地 Skill 按 canonical realpath 去同文件重复，不按逻辑名称去重；总命令数组使用 first-match winner；
- Plugin namespace 不包含完整 `plugin@marketplace` 来源身份，不能保证全局无冲突；
- source policy、schema/path validation、ref/SHA/version cache 约束来源与物化，但不等于通用签名真实性；
- `refreshActivePlugins()` 是多阶段刷新编排，不是 commands/agents/MCP/LSP/Hooks 与 in-flight execution 的单一事务；
- removed Hook pruning 和 orphan cache cleanup 有各自时序，不能写成卸载立即撤销所有已开始执行；
- H4-2 的显式冲突、完整来源身份、不可变快照、信任端口和 execution lease 是 clean-room 增强，不是快照事实。

## Codex 裁决

FACT_A 的五个编号项全部判定为 `rebutted`：它们是被审查者成功否定的错误命题，不要求修改工作簿。FACT_B 为 `PASS / 0`，无需第三轮事实审查。

正文会把 sensitive `userConfig` 收窄为已核验的 Skill/Agent prompt 占位符边界，不泛化为所有 Hook/MCP/LSP 消费路径都绝不接触 secret。
