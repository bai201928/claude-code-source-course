# M17 实现与实验报告

状态：`teaching-reviewed`

## 实现范围

M17 在不连接真实 Provider、不修改 Claude Code 源码快照的前提下，完成了两层 clean-room 验证。

独立 CompactTransaction 实验：

- TypeScript `compact-transaction.ts` 与 `compact-transaction.test.ts`；
- Python `compact_transaction.py` 与 `test_compact_transaction.py`；
- 两种语言都覆盖 summary 取消、prepared 后取消、stale revision、完整提交与恢复、tool pair retained-tail、boundary-only、summary-only 和 malformed provenance；
- report 只含 transaction ID、revision、计数、状态和 reason，不含 summary、用户消息或工具正文。

累计 Harness H3-2：

- TypeScript `agent/compact.ts` 与 `agent/compact.test.ts`；
- Python `compact.py` 与 `test_compact.py`；
- `AgentRuntime.compact()` 与普通 `submit()` 共享 ConversationStore 的 single-flight run lease；
- immutable prepare plan、expected-revision commit、prepared/committed journal、tool-pair-aware retained tail、leading system preservation、parent rebase、三态 recovery report 和 metadata-only Trace；
- `contracts/h3-2-contract.md` 固化 clean-room 行为与持久化边界。

## 事实闸门裁决

事实会话：`2b3c8acb-ba3c-463a-b4f2-7961002ba244`。

```text
FACT_A: REVISE / 7
FACT_B: REVISE / 1
FACT_B_RECHECK: PASS / 0
```

接受并闭合的关键修正：

- `shouldAutoCompact()` 负责递归、配置和 token threshold；失败熔断与计数属于 `autoCompactIfNeeded()`；
- Session Memory 在 gate 开启时先尝试，返回 `null` 后才进入 traditional compact；
- traditional 顺序精确到 PreCompact、summary fork/fallback、PTL retry、summary validation、副状态清理、attachment、SessionStart、boundary/summary、cache/metadata side effects、PostCompact、result；
- 普通逐 hook timeout、abort、进程和 parse failure 被结果化，通常不形成 compact rollback；
- summary 成功后仍可能在 `CompactionResult` 前改变辅助状态，没有 whole-state rollback；
- boundary Transcript entry 使用 `parentUuid:null`，旧 parent 只进入 `logicalParentUuid`；
- enqueue、filesystem append、flush 和 resume-visible chain 是不同完成点；
- preserved segment 的 malformed/missing chain 在 prune 前返回，保留完整 pre-compact history；
- boundary-only 在小文件完整解析与大文件 pre-boundary skip 下可能不同，快照没有统一 recovery marker；
- reactive compact、context collapse 与部分 KAIROS 内部实现缺失，不补造。

## Mini Agent Harness 裁决

Decision: `merge + defer + reject`

Merge：

- Runtime-owned `CompactCoordinator`；
- snapshot/prepare/commit 分离；
- Store expected revision 与 run lease；
- prepared/committed recovery envelope；
- tool-use/result-aware retained-tail expansion；
- leading system prompt preservation与 parent chain rebase；
- `restored | fell_back | repair_required` content-free report；
- TypeScript/Python 行为镜像及累计回归。

Defer：

- crash-durable journal、JSONL framing、checksum、fsync 与 multi-process writer；
- Transcript append、resume chain materialization 与 persistent summary object；
-真实 summary Provider、token threshold、Session Memory 与 Prompt Cache 协作；
- preserved-segment relink 和大/小文件统一恢复 marker。

Reject：

- summary 阶段原地清空 ConversationStore；
- 无 revision 的 last-write-wins replace；
- 从任意字符或任意 envelope 下标保留 suffix；
- 只写 boundary、无 provenance 的“压缩完成”记录；
- recovery report 写入 summary 或用户正文；
- 把 in-memory journal 宣称为 crash durable。

## 实际运行结果

```text
M17 TypeScript independent CompactTransaction: 8/8
M17 Python independent CompactTransaction: 8/8
M17 independent TypeScript strict typecheck: passed

Harness TypeScript Compact integration: 5/5
Harness Python Compact integration: 5/5
Harness TypeScript strict typecheck: passed
Harness Python Agent + Compact + Scheduler + Stream: 29/29

H2 cumulative regression: 4/4
H1 regression: 12/12
S0 regression: 15/15
Integrated Agent regression: 4/4
```

## 当前证据边界

- `快照事实`：auto gate/threshold/circuit、traditional compact 顺序、受限 summary、PTL retry、post-compact ordering、Query continuation、hook 结果化、Session Memory retained segment、Transcript queue 与 resume relink；
- `快照弱保证`：summary 后辅助状态可能先变化，enqueue/append/flush 非原子，graceful shutdown 不覆盖 hard crash；
- `快照缺口`：缺失 feature-gated implementation 及 boundary-only 的统一恢复语义；
- `运行验证`：独立实验与 Harness 回归只证明 clean-room 契约；
- `设计迁移`：revision-gated plan/commit、explicit recovery state、provenance、original fallback 和 metadata-only Trace。

## 教学闸门

独立 Claude Code/DeepSeek Max 会话完整读取最高需求、标杆规则与正文，结果：

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

审查会话：`fc904761-2d5e-468b-b4a4-f6a0ebbce42b`。正文中的 17 个 Mermaid block 使用 Mermaid CLI `11.16.0` 从完整 Markdown 批量渲染，结果 `17/17`。

M17 已具备生成 `release-candidate.md` 的条件；S3 尚未原子发布，因此不创建 `final.md`，也不更新阶段 README。
