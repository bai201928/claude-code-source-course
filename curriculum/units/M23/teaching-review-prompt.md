# M23 独立教学闸门任务

你是一名独立教材教学审查者，也是一名熟悉 Agent Runtime、任务协调、多 Agent、可靠消息、调度与分布式系统的互联网大厂资深面试官。请审查 M23 是否真正帮助 TypeScript/Node 基础较弱、但已有 Java、Spring、Python、Agent 和 RAG 经验的学习者，建立“一份长生命周期工作怎样穿过 Work-item、Runtime Task、Subagent、Team、Mailbox、shutdown 与 Cron”的源码级心智模型。

只允许读取以下三份文件：

1. `D:\agent\Claude code最新\2.md`；
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`；
3. `D:\agent\Claude code最新\curriculum\units\M23\draft.md`。

请实际使用 Read 工具完整读取前三份文件。不要读取源码快照、Graphify、M23 工作簿、事实审查、实现报告、Harness 源码、其他教材或历史审查。你不是事实闸门，不重新调查仓库，不修改文件。

学习者应在 4--7 小时主体内形成一个连续认知闭环，而不是背诵组件名。重点检查：

- 是否先区分 Runtime Task、Work-item Task 和 Cron record 的 owner、状态、持久化与恢复依据，再讲协作；
- ordinary claim 与 busy-aware claim 的锁保证是否讲到准确边界，没有把局部锁扩大成依赖图事务或分布式 serializable；
- 是否自然讲清 owner label、lease、heartbeat、reclaim 与 fencing token 的差别，并明确哪些属于 H5 clean-room 增强；
- sync、async-from-start、foreground-to-background 的取消 owner 与资源 handoff 是否能让初学者画出来；
- Team 是否被解释为身份、共享任务、mailbox 和 shutdown 协议，而不是多个 Subagent 的同义词；
- memory queue、file inbox 与 acknowledged mailbox 的 delivery/ack/dedupe 边界是否清楚；
- Cron lock、inFlight、pending trigger、idempotency 与 exactly-once 边界是否通过崩溃实验建立；
- H5/H6 是否只实现作品集级核心契约，没有冒充 Claude Code 当前快照或生产级分布式系统；
- 局部流程图、时序图和状态图是否分布在新增信息附近，既帮助初学也方便复习，且图文语义一致；
- TypeScript/Python 实验是否有预测、破坏、可观察结果与修复，不只是展示测试通过；
- Java/Spring/RAG/LangGraph 迁移是否解释机制映射和边界，而不是罗列名词；
- 面试题是否覆盖本章可能被追问的核心与相邻机制，回答能在约两分钟内口语化说出，并坚持先结论、再 Claude Code 机制、最后企业设计。

只报告影响初学者理解、事实/设计边界、图文一致、实验有效性、Harness 契约或面试表达的实质问题。普通措辞、排版、偏好和不影响学习闭环的边缘遗漏不算 Issue。不要要求恢复固定章节模板、知识点配额、句子级 Claim 或重哈希。

必须以下列三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

无实质问题时明确 `PASS / 0`，并简述运行线路图、局部图、破坏实验、跨语言迁移和资深面试回答为什么达到标杆；不要重写教材。
