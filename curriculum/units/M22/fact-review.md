# M22 事实双闸门与 Codex 裁决

状态：`fact-reviewed`

审查会话：见 `fact-session-id.txt`

## FACT_A

```text
GATE: FACT_A
VERDICT: BLOCK
MATERIAL_ISSUES: 6
```

FACT_A 的六项计数主要来自提示要求反证的错误命题。审查者确认：connected 与目录可用分离；本地 passthrough 不执行远端 JSON Schema；取消不等于远端回滚；session retry 不保证 exactly-once；client 不声明 sampling；pending request 需要走真正 close 链才能拒绝。这些均与 Codex 工作簿一致，并非正文缺陷。

FACT_A 对 annotations 使用了“可绕过权限”的扩大表述，尚未完成整个 Permission 链核验，因此不直接采纳；Codex 保留精确结论：远端 hint 直接进入 read-only、并发、destructive/open-world 分类，但不替代 M20 Permission。

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同一会话逐项接受八项 Codex 结论：connection union 与 initialize 顺序；client roots/elicitation/no-sampling；分类型 list/catch；server-qualified name；remote JSON Schema 与本地 passthrough；annotation hint 与 Permission；close/cache/reconnect/session retry；非 exactly-once；abort/timeout 非远端回滚；初始化 elicitation cancel 与 cwd roots 数据边界。

## Codex 裁决

FACT_A 的计数项均为已成功反证的错误命题或已在 FACT_B 收窄的扩大表述。FACT_B `PASS / 0` 后无需第三轮事实审查。H4-3 的 protocol-neutral port、generation、immutable snapshot、idempotency key、retry policy 与 metadata-only trace 均标记为 clean-room 迁移。
