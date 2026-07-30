# M15 事实闸门与 Codex 裁决

事实会话：`1fdf0d91-deec-4dfc-83d6-20d607140770`

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 4
```

- A1 follow-up 不依赖 stop reason：工作簿已有，确认。
- A2 双 scheduler 与 gate、schema 后 safe 分类：工作簿已有，确认。
- A3 PreToolUse allow 仍受 deny/ask rule 覆盖：接受并补入权限顺序。
- A4 streaming concurrent context modifier 被丢弃，而 response-complete 会按原 block 顺序应用：工作簿已有，确认并提高为实验点。
- 补充：`sibling_error` 不冒泡父 Query；permission-dialog 等其他 tool child abort 由显式 listener 冒泡。接受并补入。

## FACT_B

```text
GATE: FACT_B
VERDICT: REVISE
MATERIAL_ISSUES: 2
```

- B1 Bash sibling cascade 与 per-tool interrupt behavior 只在 streaming executor：接受。response-complete path 明确写为共享 abort、无 cascade。
- B2 deprecated alias fallback 只在 `runToolUse()`，streaming `addTool()` 可能提前 unknown：接受并记录为第二个路径差异。

## Harness 裁决

快照事实保留两条路径的不对称。Clean-room Harness 不复制差异，而以设计迁移形式统一 executor core，并显式选择：safe batch、exclusive barrier、bounded concurrency、exact pairing、ordered context modifier、alias resolution、interrupt 和 sibling-failure policy。Provider SSE 触发时点继续 defer。

## FACT_B 定向复审

```text
GATE: FACT_B_RECHECK
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同会话确认：两条 scheduler 的 sibling cascade、interruptBehavior、alias fallback 和 context modifier 差异均已准确限定；统一 Harness executor 被清楚标记为设计迁移，没有新实质冲突。
