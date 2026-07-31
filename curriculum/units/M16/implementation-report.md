# M16 实现与实验报告

状态：`teaching-reviewed`

## 实现范围

M16 建立了不连接真实 Provider、不修改源码快照的双语言 Context budget 实验，并把 H3-1 聚合结果预算合入累计 Mini Agent Harness。

独立实验：

- TypeScript `context-budget.ts`：history suffix 反例、per-result preview、最终 group 聚合预算、copy-on-write、exact replacement replay、revision ledger、strict post-validation 和 content-free report；
- TypeScript `context-budget.test.ts`：8 个机制测试；
- Python `context_budget.py`：使用 frozen dataclass、tuple/frozenset 和 expected revision 实现同一行为契约；
- Python `test_context_budget.py`：8 个对称测试；
- 双语言 demo：展示第一次 replacement、第二次逐字重放和 durable source 不变。

这些是 `运行验证` 与 `设计迁移`，不是 Claude Code 私有实现复制。

## 事实闸门裁决

事实会话：`f7a1eede-d438-4101-8ad4-da52498ffe35`。

```text
FACT_A: REVISE / 4
FACT_B: REVISE / 2
FACT_B_RECHECK: PASS / 0
```

接受并闭合的关键修正：

- 快照缺少 feature-gated snip、cached-microcompact 和 context-collapse 内部实现，只讲可见接口与上下游；
- cached-MC 对 output-style main-thread source 存在 prefix gate 与 exact gate 不一致，教材标为快照缺口；
- 字符阈值、估算 token、API usage、最终 message group 与 wire payload 分层讲解；
- replacement state 在 cache-sharing fork、AgentTool resume 和 swarm teammate 上的 provision 语义不同；
- `maxResultSizeChars: Infinity` 绕过 per-tool 与 aggregate replacement，wrapper budget 不是硬性全请求上限；
- `prependUserContext()` 只在 `callModel()` 参数边界创建 `isMeta: true` 临时消息，不写回 `messagesForQuery`。

## 被验证的核心结论

- 全局 suffix 截断可能从 tool result 开始，制造 orphan；
- 三个分别低于单结果阈值的结果，合并后的最终 group 仍可超限；
- aggregate projection 只复制被替换的请求对象，durable source 不变；
- replacement 第二次投影逐字稳定，ledger revision 不因纯重放增长；
- progress、attachment 和同 response ID assistant fragment 不会错误拆分同一结果组；
- self-bounded/excluded result 可以使组保持 over-budget，report 会显式暴露；
- strict validation 在 Provider 前拒绝 orphan history start；
- 两个基于同一 revision 的 writer 中，旧 writer 被显式拒绝。

## Mini Agent Harness 合入

Decision: `merge + defer + reject`

Merge：

- `maxToolResultGroupChars` 聚合预算策略；
- runtime-owned `ResultBudgetLedger`：seen ID、exact replacement、单调 revision；
- aggregate plan 后、ledger commit 前执行 strict pairing；
- expected-revision stale writer rejection；
- replacement、frozen、group、over-budget 与 revision 的 content-free report/Trace；
- 旧 `maxToolResultChars` per-result preview 保持兼容；
- TypeScript/Python 行为镜像与累计回归。

Defer：

- 外置大结果文件、Transcript replacement record 与 resume reconstruction；
- Prompt Cache marker/reference/edit；
- snip、microcompact、context collapse、full compact transaction 与 memory；
- tokenizer-aware 全请求预算和分布式 ledger。

Reject：

- 原地裁剪 `ConversationStore`；
- 全局字符串 suffix；
- 在 Provider adapter 内隐式猜测预算；
- 每轮重新生成不同 preview；
- 没有 revision 的共享 replacement Map；
- validation 失败后仍提交 ledger。

Compatibility：默认不设置 `maxToolResultGroupChars` 时 aggregate stage 为 no-op；旧 per-result policy 行为保持。Harness 分组遵循自身连续 `tool` message 形状，不冒充 Claude Code 的完整 envelope normalization。

## 实际运行结果

```text
M16 TypeScript independent context budget: 8/8
M16 Python independent context budget: 8/8
M16 TypeScript strict typecheck: passed

Harness TypeScript config: 1/1
Harness TypeScript Runtime: 27/27
Harness TypeScript Provider: 7/7
Harness TypeScript Tool: 5/5
Harness TypeScript Scheduler: 5/5
Harness TypeScript Stream: 4/4
Harness strict TypeScript typecheck: passed

Harness Python Agent: 15/15
Harness Python Scheduler: 5/5
Harness Python Stream: 4/4
Harness Python ConversationStore: 13/13

H2 cumulative regression: 4/4
H1 regression: 12/12
S0 regression: 15/15
Integrated Agent regression: 4/4
```

正文中的 15 个 Mermaid block 使用 Mermaid CLI `11.16.0` 从完整 Markdown 批量生成 SVG，结果 `15/15`。

## 教学闸门

新的独立 Claude Code/DeepSeek Max 会话只读取最高需求教学标准、M11 标杆规则与 M16 正文，结果为：

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

审查会话：`7938da24-533d-49f2-b1e0-4fe74f46f8b9`。

审查确认 durable/query/API/wire owner、history boundary、两层结果缩减、最终 group、replacement state、四种预算单位、轻量 Context pipeline、附件/request-only context、双语言实验、H3-1 边界、企业迁移和 7 道面试题形成 4 至 7 小时学习闭环。两个非阻断建议不影响事实、学习、实验或 Harness 契约，按项目规则不继续修改。

## 当前证据边界

- `快照事实`：history view、两层结果缩减、最终 group 边界、replacement state、attachment 时点、混合 token 估算和 wire cache edit 来自直接源码与事实双闸门；
- `快照缺口`：缺失 feature-gated 模块的内部算法，以及 cached-MC output-style gate 不一致；
- `运行验证`：独立双语言实验和 Harness 测试只证明 clean-room 行为；
- `设计迁移`：revision ledger、content-free report、strict-before-commit 和单一分组策略是课程方案；
- `后续边界`：compact 事务、Transcript 恢复、指令、Memory 与 Provider-specific cache 继续 defer。

M16 已具备生成 `release-candidate.md` 的条件；S3 尚未原子发布，因此不创建 `final.md`，也不更新阶段 README。
