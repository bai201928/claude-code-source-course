# M17 事实闸门与 Codex 裁决

事实会话：`2b3c8acb-ba3c-463a-b4f2-7961002ba244`

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 7
```

### A1 traditional compact 精确顺序

Decision: `accepted`

Reason: SessionStart 位于 boundary/summary 创建之前；Prompt Cache baseline、`markPostCompaction()`、同步 metadata re-append 和可选 KAIROS 写入位于 PostCompact 之前。

Change: 工作簿和正文按真实顺序画图，不把 SessionStart 或 PostCompact 写成原子提交后的 observer。

### A2 Session Memory 是 gate 开启时的 first attempt

Decision: `accepted`

Reason: `autoCompactIfNeeded()` 先调用 `trySessionMemoryCompaction()`，返回 `null` 才进入 traditional compact。

Change: 教材以 SM-first/traditional-fallback 表述，并列出不适用与超阈值 fallback。

### A3 boundary 使用双字段

Decision: `accepted`

Reason: Transcript writer 对 compact boundary 固定写 `parentUuid: null`，旧 parent 只进入 `logicalParentUuid`。

Change: 区分 reachable resume chain 与逻辑/UI 关联，禁止写成物理链连续。

### A4 普通 hook 失败不回滚 compact

Decision: `accepted with correction`

Reason: 接受 hook failure 是 advisory result。修正 FACT_A 的边界：逐 hook timeout、abort、进程失败和解析失败也在 `executeHooksOutsideREPL()` 内被 catch 成 `succeeded: false`；潜在抛出来自 matching/config 等更外层基础设施。

Change: 正文不把单 hook timeout/cancel 描述成 compact transaction abort。

### A5 summary 后副作用逐步发生

Decision: `accepted`

Reason: `readFileState`、nested memory paths、cache baseline、post-compaction marker、metadata append 等在 `CompactionResult` 返回前分阶段改变，失败无统一 rollback。

Change: 教材明确 partial-commit window；H3-2 用 prepare/commit 分离，不复制该窗口。

### A6 gated implementation 缺失

Decision: `accepted`

Reason: 当前快照缺少 reactive compact、context collapse 和部分 KAIROS 实现。

Change: 只讲可见 gate、接口和调用位置，不补造内部算法。

### A7 Transcript enqueue 不等于 crash durable

Decision: `accepted`

Reason: per-file queue 延迟 drain，普通 local entry 以 `void enqueueWrite()` 入队；flush 可收敛正常路径，但无 compact WAL、fsync 或 hard-crash guarantee。

Change: 正文拆分 enqueue、append、flush 与 resume-visible chain 四层保证。

## FACT_B

```text
GATE: FACT_B
VERDICT: REVISE
MATERIAL_ISSUES: 1
```

### B1 circuit breaker 函数归属

Decision: `accepted`

Reason: recursion/gate/token threshold 在 `shouldAutoCompact()`；consecutive-failure short circuit 和失败计数更新在 `autoCompactIfNeeded()`。

Change: 工作簿、FACT_B 结论和后续正文均已按职责拆分。

## FACT_B 定向复审

```text
GATE: FACT_B_RECHECK
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同一会话确认函数归属已准确闭合。

## Codex 补证

- `reAppendSessionMetadata()` 使用同步 `appendFileSync`，但无 `fsync`，所以只称 append 调用完成，不称 hard-crash durable。
- `parseJSONL()` 跳过 malformed/truncated 行；不完整 summary 不会污染为有效消息。
- QueryEngine 等待 `recordTranscript()` 也不等于 local append 完成；只有相应模式继续显式 flush。
- graceful shutdown 优先 flush，但 cleanup 仍受约 2 秒外层预算限制。
- boundary-only 对小文件完整解析与大文件 pre-boundary skip 可能产生不同恢复结果；快照无统一 recovery marker，因此教材保持审慎边界。

## 最终事实边界

- `快照事实`：threshold/gate/circuit 分工、SM-first、traditional 顺序、受限 summary、PTL retry、post-compact ordering、query continuation、hook 结果化、append-only chain、queue/flush 和 preserved relink；
- `快照弱保证`：summary 后辅助状态可能先变化，Transcript enqueue/append/flush 非原子，normal shutdown 不覆盖 hard crash；
- `快照缺口`：reactive compact、context collapse、KAIROS 内部实现与 boundary-only 的统一恢复协议不存在；
- `运行验证`：双语言 CompactTransaction 故障注入只证明课程行为契约；
- `设计迁移`：revision-gated plan/commit、summary provenance、repair report、original-history fallback 和 metadata-only trace。
