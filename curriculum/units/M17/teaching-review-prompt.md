# M17 独立教学闸门任务

你是一名独立教材教学审查者，也是一名熟悉 Agent Harness、Context transaction、Transcript、崩溃恢复和企业持久化的互联网大厂资深面试官。请审查 M17 是否真正帮助 TypeScript/Node 基础较弱、但已有 Java、Spring、Python、Agent 和 RAG 经验的学习者，建立“上下文装不下时谁能改写历史”的源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只读取学习者背景、教学深度、实验、Harness、企业迁移、面试表达和验收标准。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`。
3. `D:\agent\Claude code最新\curriculum\units\M17\draft.md`。
4. 本提示词中的前置摘要、目标和运行上下文。

不要读取源码快照、Graphify、M17 工作簿、事实审查、实验实现、implementation report、Harness 源码、其他教材或历史审查。你不是事实闸门，不重新调查仓库，不修改文件。

## 必要前置摘要

- M10 已讲 durable owner、identity、tool pairing 与 snapshot。
- M11 已走过输入、Query Loop、模型、Tool Loop 与第二次请求。
- M12 已讲 AsyncGenerator、yield、abort、close 与 terminal。
- M13 已讲 durable/query/API/wire 投影与 strict pairing。
- M16 已讲 Context budget、stable replacement、snip/microcompact/autocompact 的可见顺序。
- M18-M19 才系统讲 Instructions 与 Memory；M24 再深讲完整 Transcript/Resume。M17 只在理解 Compact commit/recovery 所需范围内讲 Transcript。

## 学习目标

学习者完成后应能：

- 区分 summary ready、CompactionResult、Query view replacement、Transcript enqueue、filesystem append、flush 和 resume-visible chain；
- 解释 `shouldAutoCompact()` 与 `autoCompactIfNeeded()` 的职责，SM-first、traditional fallback、failure circuit 与 continuation；
- 走完 traditional compact 的真实顺序，并解释受限 summary fork、PTL retry 和信息损失边界；
- 准确理解普通 Hook failure 结果化，不把 Pre/Post 名字冒充事务 veto/rollback；
- 解释 summary 成功后的 auxiliary-state partial failure window；
- 区分 manual、auto、traditional、Session Memory compact；
- 解释 boundary 的 `parentUuid:null`、`logicalParentUuid` 与 preserved segment relink；
- 分开 enqueue、append、flush、hard-crash durability，限定小/大文件 boundary-only 差异；
- 运行双语言故障注入，验证取消、stale revision、partial record、tool pairing、provenance 与 content-free report；
- 准确描述 H3-2 merge/defer/reject，不把 clean-room transaction 冒充源码实现或 crash durability；
- 迁移到 Java/Spring、RAG、LangGraph 和企业恢复协议；
- 对资深 Agent 岗追问给出结论先行、口语化约两分钟回答。

主体学习边界 4 至 7 小时，实验和修改挑战另计。

## 已知运行上下文

```text
FACT_A: REVISE / 7
FACT_B: REVISE / 1
FACT_B_RECHECK: PASS / 0
M17 TypeScript independent: 8/8
M17 Python independent: 8/8
Harness TypeScript Compact: 5/5
Harness Python Compact: 5/5
Harness Python integrated: 29/29
H2/H1/S0 and integrated regressions: passed
```

正文含 17 个 Mermaid block。只审查正文是否让学习者理解这些结果证明什么，不读取实现或重跑命令。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约、面试表达或 4–7 小时闭环的问题：

- 是否从“摘要成功不等于恢复成功”的真实矛盾连续推进，而不是函数目录；
- 各完成点、owner、可见状态和失败结果是否能被独立画出；
- auto gate/threshold/circuit、SM-first 与 traditional sequence 是否不混淆；
- summary fork/fallback、PTL retry、Hook 结果化与 partial-side-state 是否讲清；
- CompactionResult、yield、Query continuation 和 manual 差异是否准确；
- Session Memory retained tail、pairing 与 preserved metadata 是否形成可复述模型；
- Transcript structural/logical parent、queue、flush、JSONL parse 和 resume relink 是否不过度承诺；
- boundary-only 的小/大文件差异、缺失 feature implementation 是否明确守住证据边界；
- TypeScript AsyncGenerator、immutable plan、revision 和 Java/Python 对照是否在改变机制处出现；
- 17 张局部图是否靠近认知转折、方向与正文一致、可独立复习；
- 实验是否有预测、反证、破坏和修复；
- H3-2 是否准确区分快照事实、运行验证、设计迁移与 crash durability defer；
- 企业迁移是否从 owner、CAS、outbox、framing、recovery state 自然推出；
- 8 道面试题是否真实、第一句结论明确、口语自然、可在约两分钟内展开到 Claude Code 和工程边界；
- 是否守住 M17 范围，没有提前吞并完整 Memory 或 M24 Transcript 课程。

无现实影响的措辞偏好、标题形式、边缘漏洞和不影响学习的小缺失不得列为 Issue。

## 输出要求

必须以下列三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

有实质问题时给出正文定位、学习影响和最小修正方向；不要重写整章，不建议固定栏目、题量或图量。如无实质问题，简述通过理由与非阻断风险。
