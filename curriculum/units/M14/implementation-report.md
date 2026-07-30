# M14 实现与实验报告

状态：`implemented`

## 实现范围

M14 建立了不连接真实 Provider、不修改源码快照的双语言 fake-stream 实验，并将 Provider-neutral 的 bounded stream 生命周期合入累计 Mini Agent Harness。

独立实验：

- TypeScript `streaming.ts`：indexed text/thinking/tool assembly、严格协议状态、assistant-before-event、later terminal mutation、cumulative usage 与 optional TTFT；
- TypeScript `streaming.test.ts`：4 个机制测试；
- Python `streaming.py`：同一行为契约的 dataclass/iterator 实现；
- Python `test_streaming.py`：4 个对称测试；
- 双语言 demo：展示 fragmented tool JSON、完成消息和最终 usage。

这些是 `运行验证` 与 `设计迁移`，不是 Claude Code 私有实现复制。

## 事实闸门裁决

FACT_A 首次结果为 `REVISE / 3`，FACT_B 在同一会话对照后为 `PASS / 0`，会话 ID 为 `f28cab71-1ee2-4ef2-b68e-38777c662031`。

- accepted：fallback 在 `message_start` 前成功时，快照 `ttftMs=0` 表示观测缺口而非真实零延迟；clean-room 使用 optional TTFT。
- rebutted：streaming 已产生 usage 后又发 non-streaming fallback 是两次真实 Provider 请求和两笔真实费用，不是重复记账。
- clarified：partial tool side effect 后的 tombstone/discard 不是 rollback，透明 fallback 有重复副作用风险。

FACT_B 确认修订后的调用链、状态所有权、取消/close 区分、usage/cost/span 归属和实验边界无剩余实质问题。

## 被验证的核心结论

- text、thinking 与 fragmented tool JSON 按 index 和类型严格组装；
- start event 的初始内容不重复拼入 delta；
- `content_block_stop` 先产出 assistant，再产出对应 raw event；
- `message_delta` 能通过同一对象引用补齐 usage 与 stop reason；
- response usage 是累计快照，run usage 才跨真实请求累加；
- delta-before-start、类型错配和 incomplete stream fail closed；
- bounded stream 在容量满时背压，单消费者 close 传播 abort 并等待 cleanup；
- terminal result 只含 metadata，不复制 token text 或 tool JSON。

## Mini Agent Harness 合入

Decision: `merge + defer + reject`

Merge：

- bounded、single-consumer `AgentRunStream`；
- fixed capacity 与 producer backpressure；
- consumer close -> abort owner run -> await cleanup；
- metadata-only terminal result；
- optional `ModelAdapter.stream()`，保留现有 `complete()`；
- TypeScript/Python 行为镜像与测试。

Defer：

- Provider-specific SSE parser；
- streamed assistant blocks 接入 `AgentRuntime`；
- streaming tool execution 与 parallel tools；
- transparent model fallback 与 idempotency ledger；
- multi-observer fan-out、完整 OTel exporter 和 cost price ledger。

Reject：

- 无界事件队列；
- consumer break 只停止读取、不通知 producer；
- terminal summary 在 producer cleanup 前完成；
- 把正文 token、工具 JSON 或凭据写入默认 trace。

Compatibility：`stream()` 为可选 adapter 能力，现有同步完成路径不变。当前 Harness 不宣称已有完整 SSE 支持。

## 实际运行结果

```text
M14 TypeScript streaming assembler: 4/4
M14 Python streaming assembler: 3/3
M14 TypeScript/Python demos: passed
Harness TypeScript stream: 4/4
Harness Python stream: 4/4
Harness npm test: passed
Harness strict TypeScript typecheck: passed
```

正文中的 13 个 Mermaid block 使用 Mermaid CLI `11.16.0` 从完整 Markdown 一次批量生成 SVG，结果 `13/13`。

最终累计回归：

```text
Harness npm test: passed（配置 1/1、TypeScript Agent 23/23、Provider adapter 7/7、Tool 5/5、Stream 4/4）
Harness strict TypeScript typecheck: passed
H2-in-progress: 4/4（包含 H1 12/12、S0 15/15）
Integrated Agent regression: 4/4
Integrated Python Agent: 12/12
```

## 教学闸门

新的独立 Claude Code/DeepSeek Max 会话只读取最高需求教学标准、M11 标杆规则与 M14 正文，结果为：

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

审查确认正文以 partial 业务消息和 later terminal fields 的真实矛盾推进，owner、assembly、mutation、fallback、停止原因、观测、13 张局部图、双语言实验、Harness 边界、企业迁移和 6 道面试题形成 4 至 7 小时闭环。两个非阻断理解摩擦已用一句话就地澄清，不需要复审。

## 证据边界

- `快照事实`：request creation、raw event 顺序、terminal mutation、三类 fallback、abort/timeout/close、usage/cost/span 来自当前源码直接核验和事实双闸门；
- `运行验证`：独立双语言实验与 Harness 测试只证明 clean-room 行为；
- `设计迁移`：bounded stream、optional TTFT、idempotency ledger 和 observation/execution 分流是课程方案；
- `后续边界`：工具调度、并行安全分组和完整 Tool Loop 留给 M15。

M14 已具备生成 `release-candidate.md` 的条件；S2 未原子发布，因此不创建 `final.md`。
