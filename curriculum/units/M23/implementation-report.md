# M23 实现与实验报告

状态：release-candidate

## 闸门

```text
FACT_A: BLOCK / 7（七项均为提示要求反证的错误命题）
FACT_B: PASS / 0
TEACHING: PASS / 0
```

FACT_B 接受三类 Task/record、claim 锁边界、Work-item owner 非租约、Subagent 取消 ownership、resume/fork、Team identity、Mailbox delivery、shutdown 协议和 Cron crash window 的全部关键结论。

## Harness H5 与 H6 foundation

Decision：merge + defer + reject。

Merge：双语言 `WorkItemStore`、revisioned claim、expiring lease/heartbeat/reclaim/fencing token；独立 `RuntimeExecutionRegistry` 与 linked/detached cancellation；`TeamDirectory`；带 message ID、recipient sequence、dedupe、redelivery-until-ack 的 `AcknowledgedMailbox`；request/approve/reject/complete 的 `ShutdownCoordinator`；带 stable trigger ID、pending outcome、commit 与 state recovery 的 persistence-neutral `DurableScheduler`；metadata-only trace。

Defer：数据库 CAS、跨进程 lease service、真实 Subagent process/backend、TranscriptStore/ResumeCoordinator、durable queue、outbox/inbox 事务、分布式 scheduler owner、强制关闭升级、外部 Tool fencing adapter 和 OTel backend。

Reject：把 Runtime execution 与 Work-item 合成一个状态机、owner string 冒充 lease、background 自动 detached、receive 即删除、`read` 冒充 ack、无 token 的迟到 completion、fire 后再生成不稳定 trigger ID、PID lock 或 `inFlight` 冒充 exactly-once、普通 trace 记录 work/message payload。

## 验证结果

```text
TypeScript WorkCoordinator: 12/12
Python WorkCoordinator: 12/12
TypeScript integrated: 105/105
Python integrated: 79/79
H2: 4/4
H1: 12/12
S0: 15/15
Integrated regression: 4/4
Mermaid: 27/27
```

聚焦测试覆盖 blocker、竞争 claim、heartbeat expiry/reclaim、stale token、linked/detached cancel、Team shutdown、mail dedupe/redelivery/ack/order/collision、missed trigger recovery、recurring advance 与 metadata-only trace。TypeScript strict typecheck 在阶段发布前统一执行。

M23 只进入 release-candidate；M20-M23 在 S4 一致性审计和累计回归通过后同时生成 `final.md`。
