# M19 独立教学闸门任务

你是一名独立教材教学审查者，也是一名熟悉 Agent Memory、Context Pipeline、RAG、状态一致性和企业治理的互联网大厂资深面试官。请审查 M19 是否真正帮助 TypeScript/Node 基础较弱、但已有 Java、Spring、Python、Agent 和 RAG 经验的学习者，建立“Memory extraction 是 best-effort 候选提炼，Memory recall 是 request-time 有界投影”的源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只读取学习者背景、教学深度、实验、Harness、企业迁移、面试表达和验收标准。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`。
3. `D:\agent\Claude code最新\curriculum\units\M19\draft.md`。
4. 本提示词中的前置摘要、目标和运行上下文。

请实际使用 Read 工具完整读取前三份文件。不要读取源码快照、Graphify、M19 工作簿、事实审查、实验实现、implementation report、Harness 源码、其他教材或历史审查。你不是事实闸门，不重新调查仓库，不修改文件。

## 必要前置摘要

- M10 已讲 durable owner、identity、tool pairing 与 snapshot。
- M11 已走过输入、Query Loop、模型、Tool Loop 与第二次请求。
- M13 已讲 durable/query/API/wire 投影与 strict pairing。
- M16 已讲 Context budget 与多层裁剪。
- M17 已讲 compact transaction、summary、Transcript commit 与恢复可见性。
- M18 已讲 CLAUDE.md、Rules、system prompt 和 dynamic attachment。
- M19 只在 Memory 与 Transcript 的边界所需范围内提到 Transcript，完整恢复在后续单元展开。

## 学习目标

学习者完成后应能：

- 区分当前消息、compact summary、Session Memory、Auto Memory、Instruction 与 Transcript 的 owner、scope 和生命周期；
- 解释 Session Memory 的触发、串行 extraction、summary.md、safe boundary、SM-first compact、soft wait、stale 与 traditional fallback；
- 解释 Auto Memory 的 canonical git-root scope、topic/index、主 Agent 写入、stop 后 extract fork、coalescing 和 headless soft drain；
- 准确说明 tool_use 写入意图未与 tool_result 成功配对的失败窗口，只称 best-effort，不宣称 exactly-once；
- 走完 relevance prefetch、header scan、side query、bounded read、zero-wait collect、dedupe、attachment normalization 与当前请求可见性；
- 解释 Auto Dream 的 gates、PID/mtime lock、后台 consolidation 价值与非事务边界；
- 运行 H3-4 双语言实验，验证 candidate/accepted、scope、provenance、revision、retention、bounded recall 和 content-free Trace；
- 说明 ConversationStore、CompactCoordinator、InstructionCatalog、MemoryStore、MemoryProjector 为什么分权；
- 区分快照事实、运行验证和 clean-room Harness 迁移设计；
- 将机制迁移到 Java/Spring、LangGraph、企业 RAG、PII/DLP、CAS、outbox 和多租户 scope；
- 对资深 Agent 岗追问给出结论先行、口语化约两分钟回答。

主体学习边界 4--7 小时，实验和修改挑战另计。

## 已知运行上下文

```text
FACT_A: REVISE / 1，唯一问题已接受并写入教材
FACT_B: PASS / 0
Harness TypeScript Memory: 8/8
Harness Python Memory: 7/7
Harness TypeScript strict typecheck: passed
Harness cumulative regressions: passed
Mermaid render from complete draft: 12/12
```

只审查正文是否让学习者理解这些结果证明什么，不读取实现或重跑命令。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约、面试表达或 4--7 小时闭环的问题：

- 是否从“同一句偏好出现在五种载体”连续推进，而不是按文件和函数罗列；
- 五类状态是否保持 owner/scope/lifecycle 分离；
- Session Memory extraction、safe boundary、SM compact 与 traditional fallback 是否能画出；
- Auto Memory topic/index、主写入、后台提炼、coalescing、soft drain 是否形成运行闭环；
- tool_use 意图与 tool_result 成功未配对的弱保证是否醒目且没有 exactly-once 过度承诺；
- relevance recall 是否被讲成 request-time bounded projection，而不是永久注入；
- prefetch zero-wait、取消、dedupe 和 compact 后重新 surfacing 是否足够清楚；
- Auto Dream 的锁、异步价值和非事务边界是否同时出现；
- 12 张局部图是否靠近认知转折，方向与正文一致，可用于复习；
- 实验是否有预测、反证、破坏和修复，并准确区分 Claude Code 事实与 H3-4 设计；
- candidate lifecycle、revision、scope、retention、bounded recall 和 content-free Trace 是否形成可修改契约；
- 企业迁移是否自然推出 CAS、PII/DLP、outbox、tenant scope，而不是术语堆叠；
- 8 道面试题是否第一句结论明确、口语自然，可在两分钟内展开源码、失败边界与系统设计；
- 是否守住 M19 范围，没有把尚未实现的强治理冒充 Claude Code 当前事实。

无现实影响的措辞偏好、标题形式、边缘漏洞和不影响学习的小缺失不得列为 Issue。

## 输出要求

必须以下列三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

有实质问题时给出正文定位、学习影响和最小修正方向；不要重写整章，不建议固定栏目、题量或图量。如无实质问题，简述通过理由与非阻断风险。
