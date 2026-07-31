# M19 实现与实验报告

状态：`release-candidate`

## 事实闸门

会话 `ead924ef-e059-4a45-ba36-051e26e5b1a0`：

```text
FACT_A: REVISE / 1
FACT_B: PASS / 0
```

FACT_A 的唯一问题已经接受并进入正文：`hasMemoryWritesSince()` 只检查主 Agent 的 Write/Edit `tool_use` 路径，没有关联 `tool_result` 成功状态，因此只能称写入意图互斥和 best-effort，不能称 exactly-once 或失败安全。

## Harness H3-4

Decision: `merge + defer + reject`

Merge：独立 `MemoryStore`、`MemoryProjector`、candidate/accepted/rejected/superseded/expired 生命周期、project/session scope、provenance、revision-gated accept/update、retention、bounded recall、content-free Trace，以及 TypeScript/Python 行为镜像。

Defer：磁盘/数据库持久化、加密、PII/DLP、embedding/vector recall、distributed writer、team sync、Auto Dream 和 Transcript reducer。

Reject：观察直接进入 accepted memory、compact summary 冒充长期 memory、无 scope 全局 Map、last-write-wins、Trace 记录正文，以及让 MemoryStore 拥有 ConversationStore/CompactCoordinator。

## 实际运行结果

```text
Harness TypeScript Memory: 8/8
Harness Python Memory: 7/7
Harness TypeScript strict typecheck: passed

Integrated TypeScript Runtime: 27/27
Harness Compact: 5/5
Harness Instructions: TypeScript 7/7, Python 7/7
Harness Python Agent + Compact + Instructions + Memory + Scheduler + Stream: 43/43
H2 regression: 4/4
H1 regression: 12/12
S0 regression: 15/15
Integrated regression: 4/4
```

验证覆盖：candidate 未 accept 不可召回、scope 隔离、duplicate merge、stale revision 拒绝、retention expiry、bounded/order recall、projection 与 Trace 分离，以及 superseded lifecycle。

## 教学闸门

独立 Claude Code/DeepSeek Max 会话只读取最高需求、标杆规则与正文，结果：

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

审查会话：`d03311bb-6c48-4e09-b6ca-fa9ef4e0d279`。正文中的 12 个 Mermaid block 使用 Mermaid CLI `11.16.0` 从完整 Markdown 批量渲染，结果 `12/12`。

M19 已生成 `release-candidate.md`；S3 尚未原子发布，因此不创建 `final.md`，也不更新阶段 README。
