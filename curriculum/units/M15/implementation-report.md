# M15 实现与实验报告

状态：`implemented`

## 实现范围

M15 建立了不连接真实 Provider、不修改源码快照的双语言 scheduler 实验，并把统一 ToolExecutionPlan/Executor 合入累计 Mini Agent Harness。

独立实验：

- TypeScript `tool-scheduler.ts`：parse 后动态 safe 分类、consecutive safe batch、exclusive barrier、有界 worker、exact pairing、progress、ordered context update 和快照策略对照；
- TypeScript `tool-scheduler.test.ts`：6 个机制测试；
- Python `tool_scheduler.py`：同一行为契约的 dataclass/asyncio 实现；
- Python `test_tool_scheduler.py`：6 个对称测试；
- 双语言 demo：展示 safe 并发、unsafe barrier、progress 与最终 context。

这些是 `运行验证` 与 `设计迁移`，不是 Claude Code 私有实现复制。

## 事实闸门裁决

事实会话：`1fdf0d91-deec-4dfc-83d6-20d607140770`。

```text
FACT_A: REVISE / 4
FACT_B: REVISE / 2
FACT_B_RECHECK: PASS / 0
```

接受并闭合的关键修正：

- follow-up 由实际 tool blocks 驱动，不依赖 stop reason；
- PreToolUse allow 仍受 deny/ask rule 与交互式权限流程约束；
- response-complete 按原 block 顺序应用 concurrent context modifiers，streaming executor 当前丢弃 safe tool modifiers；
- Bash sibling cascade 与 per-tool `interruptBehavior` 只存在于 streaming executor；
- `sibling_error` 不冒泡父 Query，其他非 sibling child abort 可显式冒泡；
- deprecated alias fallback 位于 `runToolUse()`，streaming `addTool()` 可能提前返回 unknown。

## 被验证的核心结论

- safe A/B 并发，unsafe C 形成屏障，safe D 只能在 C 后启动；
- worker peak 不超过显式并发上限；
- schema failure 在动态 safety predicate 前发生；
- invalid、deny、throw、cancel 和未启动调用都保留一一配对 outcome；
- progress 先于 final outcome 可见，但不替代 final 配对；
- 并发完成可以乱序，outcome 与 durable publication 仍按 call ID 和原 block 顺序；
- context updates 在 batch 边界按原 block 顺序应用；
- 独立快照策略对照证明 streaming 与 response-complete 的 concurrent modifier 行为不等价。

## Mini Agent Harness 合入

Decision: `merge + defer + reject`

Merge：

- 显式 `ToolExecutionPlan`、safe batch 与 exclusive barrier；
- 固定上限的 bounded worker pool；
- `AgentTool.isConcurrencySafe(input)` 动态 predicate，未声明默认 unsafe；
- lightweight schema validation 先于 safety predicate 与 permission；
- built-in read/list/search safe，command unsafe；
- call-ID outcome、metadata progress、success/error/denied/cancelled 配对；
- 执行可并发，ConversationStore 按 assistant block 顺序单 owner 提交；
- context updates 按原 block 顺序归并；
- TypeScript/Python 行为镜像与回归。

Defer：

- Provider SSE completed block 直接触发工具执行；
- durable idempotency ledger、跨进程 worker 和副作用恢复；
- 完整 Hook/Permission/MCP/Skill/Plugin ABI；
- Bash 专属 sibling cascade 与 per-tool interrupt 策略；
- Sandbox 与生产资源治理。

Reject：

- 对全部 tool calls 使用无差别 `Promise.all`；
- 用完成位置代替 call ID 配对；
- 拒绝、错误或取消时省略 tool result；
- 并发工具直接竞争 ConversationStore revision；
- 把快照两条路径描述成已经等价。

Compatibility：既有工具未声明 predicate 时默认 unsafe，因此保持串行行为；`maxToolConcurrency` 默认为 4。当前 Runtime 仍在完整 `ModelResponse` 后规划，不声称已有 streaming tool start。

## 实际运行结果

```text
M15 TypeScript independent scheduler: 6/6
M15 Python independent scheduler: 6/6

Harness TypeScript config: 1/1
Harness TypeScript Runtime: 25/25
Harness TypeScript Provider: 7/7
Harness TypeScript Tool: 5/5
Harness TypeScript Scheduler: 5/5
Harness TypeScript Stream: 4/4
Harness strict TypeScript typecheck: passed

Harness Python Agent: 13/13
Harness Python Scheduler: 5/5
Harness Python Stream: 4/4

H2-in-progress cumulative regression: 4/4
H1 regression: 12/12
S0 regression: 15/15
Integrated Agent regression: 4/4
```

正文中的 14 个 Mermaid block 使用 Mermaid CLI `11.16.0` 从完整 Markdown 批量生成 SVG，结果 `14/14`。

## 教学闸门

新的独立 Claude Code/DeepSeek Max 会话只读取最高需求教学标准、M11 标杆规则与 M15 正文，结果为：

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

审查确认真实问题、双 scheduler、动态并发、执行链、权限、配对、取消、fallback、14 张图、双语言实验、Harness 边界、企业迁移和 7 道面试题形成 4 至 7 小时学习闭环。

## 证据边界

- `快照事实`：两种 scheduler、共享执行链、动态分类、Hook/Permission 顺序、paired results、取消层次和 next state 来自当前源码直接核验与事实双闸门；
- `运行验证`：独立双语言实验与 Harness 测试只证明 clean-room 行为；
- `设计迁移`：统一 executor、ordered durable commit、默认 unsafe 与 context publication 是课程方案；
- `后续边界`：Provider-SSE trigger、durable idempotency、完整扩展 ABI、Sandbox 与分布式恢复继续 defer。

M15 已具备生成 `release-candidate.md` 的条件；S2 尚未原子发布，因此此时不创建 `final.md`。
