# S4 原子发布说明：执行治理、扩展生态、Task 与多 Agent

状态：`released`

S4 原子发布 M20-M23，并把 Mini Agent Harness 从 `H3 / 0.4.0` 推进到 `H5 / 0.5.0`。`DurableScheduler` 同时建立 H6 的第一个恢复基础，但完整 H6 仍需 M24 的 Transcript/Resume。

## 四个正式单元

- [M20 一次工具调用怎样被治理](../../units/M20/final.md)：Tool ABI、Hook rewrite、Permission 合流、取消窗口、PostHook 与 Sandbox 边界；
- [M21 扩展如何被发现和交付](../../units/M21/final.md)：Skill/Plugin source identity、namespace、trust、冲突、snapshot、unload 和 execution lease；
- [M22 能力如何跨进程进入 Agent](../../units/M22/final.md)：MCP transport、initialize、capability negotiation、目录刷新、disconnect、cancel、retry/idempotency 和 remote boundary；
- [M23 一份工作怎样穿过 Task、Subagent 与 Team](../../units/M23/final.md)：Runtime Task、Work-item、claim、Subagent、Team、Mailbox、shutdown、Cron 与 recovery ownership。

## 质量门槛

四章都完成 Graphify 候选定位、直接源码核验、事实 A/B、Codex 裁决、双语言实验、教学闸门和 Harness merge/defer/reject。四个 FACT_B 与四个教学闸门均为 `PASS / 0`；M21-M23 的 FACT_A 计数是审查者按提示成功反证的常见错误命题。

四章共有 73 张 Mermaid 图，均从完整 Markdown 实际渲染。38 道面试题均从当前机制自然展开到源码、故障和企业系统设计。

## H4/H5 里程碑

H4/H5 保留 H0-H3 的消息、Query、Tool Loop 与 Context/Memory 契约，并新增：

- ordered Hook/rewrite/policy pipeline、重验证/重授权、final cancel gate 与 post-effect continuation；
- revisioned ExtensionRegistry、source identity、trust、atomic conflict、immutable snapshot 与 execution lease；
- transport-neutral McpSession、generation/revision、qualified remote tools、refresh/degrade/disconnect 与显式 retry policy；
- 分立 WorkItemStore/RuntimeExecutionRegistry、lease/heartbeat/reclaim/fencing 与 linked/detached cancel；
- TeamDirectory、acknowledged mailbox、correlated shutdown；
- stable pending trigger、commit/recovery 和 metadata-only trace 的 H6 scheduler foundation；
- TypeScript 主实现与 Python 行为镜像。

当前累计基线：TypeScript `105/105`、strict typecheck PASS、Python integrated `79/79`、Python ConversationStore `13/13`、H2 `4/4`、H1 `12/12`、S0 `15/15`、集成回归 `4/4`。

## 明确边界

H5 仍不声称实现真实 Skill/Plugin filesystem discovery 或 marketplace、签名基础设施、官方 MCP transport/OAuth/Resource/Prompt adapter、process-backed Subagent/Team、durable mailbox/queue、crash-durable Transcript/Resume、数据库 CAS、分布式 scheduler/Sandbox 或完整 OTel/cost ledger。local cancel 不等于 remote rollback，stable ID 不等于 exactly-once。

下一阶段是 S5/M24-M27：优先闭合 Transcript/Resume、Sandbox/security、observability/cost 与生产部署；最终在 M27 完成，不设置 S6 或 M28。
