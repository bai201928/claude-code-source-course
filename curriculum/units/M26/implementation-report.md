# M26 实现与实验报告

状态：`release-candidate`

## 闸门

```text
FACT_A: REVISE / 6
FACT_B: PASS / 0
TEACHING: PASS / 0
```

FACT_A 的六项校准已全部进入正文：H7-2 是新建迁移契约、快照没有通用 evaluation ledger、四类治理控制面分离、analytics marker 不是安全证明、streaming usage 是 cumulative snapshot、exact LLM span 与 legacy fallback 的并发边界。FACT_B 接受校准结论。

## Harness H7-2

Decision：`merge + defer + reject`。

Merge：TypeScript/Python closed metadata telemetry、observer-only `OpenTelemetryPort`、attempt-scoped cumulative-to-delta usage/cost ledger、immutable price version、unknown cost/TTFT、versioned idempotent evaluation ledger、tenant token/cost/concurrency reservation、per-tenant bounded FIFO queue、complete/cancel release 和 metadata-only report。

Defer：生产 OTel SDK/exporter、durable event transport、exact Provider billing、currency settlement、distributed quota CAS、rolling-window storage、cross-node fairness、worker-crash reservation reconciliation 和通用 evaluation model。

Reject：把 cumulative snapshot 逐事件相加、用最终 request 覆盖 retry/fallback、unknown price/TTFT 写成 0、exporter exception 改变 run outcome、truncate/hash 冒充 redaction、task budget 冒充硬 quota、flush resolve 冒充零丢失。

## 实验结果

```text
TypeScript H7-2 focused: 10/10
Python H7-2 focused: 10/10
TypeScript integrated: 134/134
Python integrated: 106/106
Strict typecheck: PASS
H2/H1/S0 cumulative: PASS
Integrated demo: PASS
Agent regression: 4/4
Mermaid: 19/19
```

聚焦实验覆盖 `100 -> 130 = +30`、event replay/collision、retry/fallback identity、unknown cost/TTFT、observer failure、fixed metadata schema、rubric version、reservation oversubscription、bounded queue 与 complete/cancel release。

H7-2 是作品集级治理控制面，不声称实现了 Claude Code 的同名组件或生产分布式 observability/quota 平台。
