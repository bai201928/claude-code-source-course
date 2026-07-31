# S4 跨章一致性审计

状态：`passed`

范围：M20-M23、H4/H5、H6 scheduler foundation、根 README、Harness README、核心架构、全局索引与累计回归。

## 结论

S4 可以原子发布。四章沿“一个能力如何被治理、交付、跨进程使用，再成为长生命周期协作工作”形成连续依赖，没有会影响初学者理解、事实边界、实验、恢复、安全或后续 M24-M27 的冲突。

## 依赖与认知链

```text
M20：一个 tool call 内部怎样经过 Hook / Permission / execution governance
M21：一组本地扩展怎样取得 source identity、namespace、trust 与 snapshot
M22：远端能力怎样经过 MCP session/generation 进入 capability snapshot
M23：能力开始长时间运行后，责任、执行、身份、通信和调度由谁拥有
```

M20 复用 M15 ToolScheduler 的批次和配对，但不把 Permission 等同 Sandbox。M21 在 M18 instruction source 与 M20 execution decision 上建立扩展交付边界。M22 让远端 MCP 能力进入同一 visibility/permission/execution 分层。M23 再把一次调用扩展为 Work-item、Runtime execution、Subagent、Team、Mailbox 与 Cron，并把 crash-durable Transcript/Resume 留给 M24。

## Owner 一致性

| 状态 | owner | 不拥有 |
| --- | --- | --- |
| tool input revision / decision evidence | `ExtensionDecisionPipeline` | durable conversation、Sandbox、effect rollback |
| extension source membership | `ExtensionRegistry` | marketplace authenticity infrastructure、正在执行的副作用 |
| MCP generation / capability revision | `McpSession` | remote rollback、exactly-once、Permission decision |
| work responsibility / claim lease | `WorkItemStore` | AbortController、live process state |
| live attempt / cancellation | `RuntimeExecutionRegistry` | business completion、claim truth |
| team/member identity | `TeamDirectory` | mailbox ack、conversation state |
| delivery/ack state | `AcknowledgedMailbox` | recipient business effect |
| shutdown protocol state | `ShutdownCoordinator` | physical process-tree exit proof |
| schedule/pending trigger | `DurableScheduler` | external effect commit、cluster leader election |

这些 owner 没有合成一个全局 revision，也没有把 Claude Code Work-item owner string 误写成 H5 lease。

## 事实与迁移边界

- M20 FACT_A/B 均 `PASS / 0`；M21 FACT_A 的 5 项、M22 的 6 项、M23 的 7 项均为提示要求反证的常见错误命题，最终 FACT_B 均 `PASS / 0`；
- Hook behavior 合流不被扩大成确定 rewrite ledger，PostHook 不被描述为 rollback；
- Plugin namespace 不冒充供应链身份或签名，unload 不追溯撤销 in-flight effect；
- MCP connected 不等于目录可用，annotation 只是 hint，abort 不等于远端回滚，retry 不等于 exactly-once；
- Team 不是多个 Subagent，file inbox `read` 不是业务 ack，Cron PID lock/`inFlight` 不提供 exactly-once；
- H4/H5/H6 foundation 均标为 clean-room migration，不倒写为 Claude Code 当前快照事实。

## 教学、图文与实验

- 四章主体均按 4--7 小时深度组织，实践与破坏实验另计；
- M20 `15/15`、M21 `14/14`、M22 `17/17`、M23 `27/27`，合计 `73/73` Mermaid 从完整正文实际渲染；
- 四个独立教学闸门均为 `PASS / 0`；
- M20-M23 共 38 道资深 Agent 岗问题，均采用结论先行、源码机制和企业设计的约两分钟回答；
- 双语言实验覆盖 rewrite/revalidation、registry conflict/snapshot/unload、MCP generation/refresh/retry，以及 lease/fencing/mail ack/pending trigger 恢复；
- Java/Spring/RAG/LangGraph 对照保持机制映射，不把框架能力冒充 Harness control plane。

## Harness 回归

```text
TypeScript integrated: 105/105
TypeScript strict typecheck: passed
Python integrated: 79/79
Python ConversationStore: 13/13
H2: 4/4
H1: 12/12
S0: 15/15
Integrated regression: 4/4
```

H4-1 已接入实际 ToolRegistry/Scheduler/Runtime；H4-2 ExtensionRegistry、H4-3 McpSession 和 H5 WorkCoordinator 保持独立可组合 owner。公共 barrel 已导出 `ExtensionDecisionPipeline`。真实 API 冒烟不用于替代确定性协议测试，本次阶段发布未写入或回显任何 credential。

## 发布决定

Decision：`publish S4 atomically`。

发布动作：M20-M23 的 `draft.md` 同时复制为 `final.md`；Harness 升级为 `H5 / 0.5.0`；补齐 H4/H5 契约、架构、README、术语、知识、源码符号和 TypeScript 索引。下一阶段从 M24 Transcript/Resume 与 crash recovery 开始。
