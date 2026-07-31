# S3 跨章一致性审计

状态：`passed`

范围：M16-M19、H3-1 至 H3-4、根 README、Harness README、核心架构与累计回归。

## 结论

S3 可以原子发布。四章的依赖顺序、owner、术语、事实标签、实验和 Harness 契约一致，没有会影响初学者理解、运行验证、恢复、安全边界或后续 M20-M27 依赖的问题。

## 依赖与认知链

```text
M16：完整 durable history -> 有预算的 request projection
M17：轻量投影不足 -> revision-gated Compact transaction
M18：历史之外的 instruction -> discovery/trust/scope/request view
M19：跨请求和跨 session 的 memory -> extraction/recall/governed lifecycle
```

M16 依赖 M13 的四层投影和 M15 的 tool pairing；M17 只在 M16 的轻量裁剪不足后引入 history replacement；M18 没把 CLAUDE.md 冒充 system prompt 或 memory；M19 再把 compact summary、Session Memory、Auto Memory、Instruction 和 Transcript 分开。M19 为 M24 Transcript/Resume 提供了明确前置边界。

## Owner 一致性

| 状态 | 唯一 owner | S3 中的修改边界 |
| --- | --- | --- |
| durable messages / tool pairing | `ConversationStore` | expected revision + runtime lease |
| request replacement decision | `ResultBudgetLedger` | strict validation 后 CAS commit |
| compact plan / journal | `CompactCoordinator` / `CompactJournal` | prepare/committed envelope + Store replace |
| instruction source revision | `InstructionCatalog` | expected-revision publish |
| request instruction view | `InstructionPipeline` | scope/trust/dedupe projection |
| memory candidate lifecycle | `MemoryStore` | revision-gated transition |
| request memory view | `MemoryProjector` | accepted/scope/retention/budget filter |

没有把这些 revision 合并成一个全局计数，也没有让 Provider、Trace、UI 或 compact summary 获得长期 memory 写权。

## 事实与迁移边界

- Graphify 只作候选定位，所有章节均回到源码和实验核验；
- M16/M17 对缺失的 feature-gated 内部实现明确标为快照缺口；
- M18 的 `InstructionCatalog` 与 M19 的 candidate lifecycle 均标为 clean-room 设计迁移；
- M19 明确接受 `tool_use` 写入意图未关联 `tool_result` 成功的失败窗口，只称 best-effort；
- in-memory Compact journal 不冒充 crash durability，prompt guidance 不冒充 PII/DLP enforcement；
- external result store、Transcript resume、完整 CLAUDE.md discovery、persistent/vector memory 和自动 Runtime wiring 都保持 defer。

## 教学与图文

- 四章主体均按 4--7 小时深度组织，并把实验/修改挑战另计；
- M16 `15/15`、M17 `17/17`、M18 `16/16`、M19 `12/12`，合计 `60/60` Mermaid 从完整正文实际渲染；
- 所有教学闸门为 `PASS / 0`；
- M16 7 道、M17 8 道、M18 8 道、M19 8 道资深 Agent 岗面试题均结论先行，可展开源码和系统设计；
- TypeScript 先讲，Python 行为镜像，Java/Spring/LangGraph 只作迁移对照；
- M16 的阶段版本表述已由“仍是 0.3.0”修正为 M16-M19 共同闭合后发布 H3/0.4.0，避免正式版产生时间歧义。

## Harness 回归

```text
TypeScript npm test: 69/69
TypeScript strict typecheck: passed
Python integrated: 43/43
Python ConversationStore: 13/13
H2: 4/4
H1: 12/12
S0: 15/15
Integrated regression: 4/4
```

H3-4 还单独证明 candidate-before-accept、project/session scope、duplicate merge、stale revision、retention expiry、bounded recall、content-free Trace 和 superseded lifecycle。

## 发布决定

Decision: `publish S3 atomically`。

发布动作：M16-M19 `release-candidate.md` 机械复制为 `final.md`；Harness 升级为 `H3 / 0.4.0`；补齐 H3/H3-4 契约、架构和 README；更新课程设计包与 V3 当前状态。渲染 SVG 和过程文件不影响教材正文或发布判断。
