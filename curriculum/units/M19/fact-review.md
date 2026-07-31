# M19 事实闸门与 Codex 裁决

事实会话：`ead924ef-e059-4a45-ba36-051e26e5b1a0`

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 1
```

独立审查确认了 Session Memory、Auto Memory、相关性召回、Auto Dream、Compact Summary 与 Transcript 的 owner/scope 分离；确认了 Session Memory 的阈值、per-session 文件、fork Edit 限制、SM-first compact/fallback、Auto Memory 的 canonical git-root 路径、MEMORY.md/topic file 分工、extractMemories 的 coalescing/soft drain、relevance prefetch 的 zero-wait/取消/dedupe，以及 Auto Dream 的 time/session/PID lock gates。

### Issue 1：接受

`src/services/extractMemories/extractMemories.ts` 的 `hasMemoryWritesSince()` 只检查 assistant `tool_use` 中的 Write/Edit 路径，不关联对应 `tool_result` 的成功或 `is_error`。因此主 Agent 发出写入意图但实际写入失败时，后台提取仍会跳过并推进 cursor，当前轮事实可能不会被后续提取重试。

Codex 决策：`accepted`。教材、实验和 Harness 必须把“意图互斥”与“成功写入”分开，不能宣称该快照提供 exactly-once 或失败安全的主写入/后台提取互斥。

### A 的证据边界

当前快照不存在独立 `candidate/accepted` Memory 状态机、TTL、revision CAS、redaction enforcement 或事务性多文件 commit。Session Memory 是 per-session `summary.md`，Auto Memory 是 per-project topic files/index，相关性召回是 request-time attachment，Auto Dream 是跨 session consolidation fork。A 未确认的 init 调用位置属于待定项，不进入正文断言。

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

事实 B 在同一会话中对照 Codex 摘要，确认五类实体的 owner/scope/lifecycle、直接文件写入边界、Session Memory 不跨 session、prompt guidance 不等于 enforcement，以及 `tool_use` 意图与写入成功之间的失败窗口均表述准确。教材必须保留“尝试写入”“best-effort 互斥”和“不能宣称 exactly-once/失败安全”的限定。
