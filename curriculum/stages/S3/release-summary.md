# S3 原子发布说明：Context、压缩、指令与记忆

状态：`released`

S3 原子发布 M16-M19，并把 Mini Agent Harness 从 `H2 / 0.3.0` 推进到 `H3 / 0.4.0`。

## 四个正式单元

- [M16 模型为什么看不见全部历史](../../units/M16/final.md)：Context view、aggregate result budget、replacement ledger、snip/microcompact 边界与 strict post-projection validation；
- [M17 上下文装不下时谁能改写历史](../../units/M17/final.md)：Compact transaction、safe boundary、取消、journal、fallback 与 recovery；
- [M18 文件存在不等于模型看见](../../units/M18/final.md)：CLAUDE.md、Rules、system prompt、trust、scope、dynamic attachment 与 instruction request view；
- [M19 记忆不是一段更长的 Prompt](../../units/M19/final.md)：Session Memory、Auto Memory、relevance recall、Auto Dream 与 governed candidate lifecycle。

## 质量门槛

四章都完成 Graphify 候选定位、直接源码核验、事实 A/B、Codex 裁决、双语言实验、教学闸门和 Harness merge/defer/reject。M16 与 M17 在同一事实会话中完成定向复审；M19 的事实 A `REVISE / 1` 已接受并写入教材，最终事实 B 为 `PASS / 0`。四个教学闸门均为 `PASS / 0`。

四章共有 60 张 Mermaid 图，均从完整 Markdown 实际渲染。Context 投影、Compact transaction、Instruction delivery、Memory extraction/recall 的局部图可以独立用于复习，没有把大纲目录画成伪架构。

## H3 里程碑

H3 保留 H2 的单 Agent Tool Loop，并新增：

- aggregate tool-result budget、exact replacement replay 和 revisioned ledger；
- revision-gated Compact prepare/commit/recovery 与 tool-pair-safe retained tail；
- scoped/trusted/revisioned InstructionCatalog/InstructionPipeline；
- candidate-gated MemoryStore/MemoryProjector、scope/provenance、retention 和 bounded recall；
- content-free projection、compact、instruction 和 memory reports/Trace；
- TypeScript 主实现与 Python 行为镜像。

当前累计基线：TypeScript `69/69`、strict typecheck PASS、Python integrated `43/43`、Python ConversationStore `13/13`、H2 `4/4`、H1 `12/12`、S0 `15/15`、集成回归 `4/4`。

## 明确边界

H3 仍不声称实现 crash-durable Transcript/Resume、外置结果存储、完整 CLAUDE.md discovery、自动 Runtime instruction/memory wiring、persistent/vector memory、PII/DLP enforcement、Hook/Skill/MCP/Plugin、Subagent/Team、Sandbox 或分布式执行。

下一阶段是 S4/M20：从 Tool permission 与执行治理进入 Hook、Skill、MCP、Plugin、Task 和多 Agent。章节继续按价值优先动态调整，最终在 M28 前，即 M01-M27 内完成。
