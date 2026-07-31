# M27 实现与实验报告

状态：`release-candidate`

## 闸门

```text
FACT_A: REVISE / 6
FACT_B: PASS / 0
TEACHING: PASS / 0
```

FACT_A 的六项范围校准已全部进入正文：QueryDeps 只是窄模式、CLI update/lock 不是 rollout、graceful shutdown 是 bounded best-effort、settings migration 不是 ACID、bridge version/epoch/env 证明力有限、快照没有通用 canary/schema/DR controller。FACT_B 接受校准结论。

## Harness H7-3

Decision：`merge + defer + reject`。

Merge：TypeScript/Python immutable release manifest、protocol/schema/policy/feature compatibility、worker registration/readiness、revisioned staged canary、stable bucket selection、SLO advancement、drain/active-work ownership、rollback routing、metadata-only reports、local release demo 和 credential-free container smoke 配置。

Defer：生产 traffic router、service discovery、durable rollout state、distributed CAS/lease、Kubernetes reconciliation、database migrator、feature flag delivery、artifact signature/attestation、automatic effect compensation、backup/restore 与 cross-region DR。

Reject：Docker tag 冒充完整 release identity、CLI update lock 冒充分布式锁、liveness 冒充 readiness、candidate 写旧 worker 不可读 schema、binary canary 混入 policy revision、坏/未知 SLI 照常升流量、SIGKILL 冒充 drain、deployment rollback 冒充 Tool effect rollback。

## 实验结果

```text
TypeScript H7-3 focused: 10/10
Python H7-3 focused: 10/10
TypeScript integrated: 144/144
Python integrated: 116/116
Strict typecheck: PASS
H2/H1/S0 cumulative: PASS
Integrated agent demo: PASS
Release-control demo: PASS
Agent regression: 4/4
Mermaid: 19/19
Docker Compose config: PASS
Docker image runtime smoke: NOT RUN (Docker Desktop Linux daemon unavailable)
```

聚焦实验覆盖双向 schema readability、protocol/policy/feature mismatch、required dependency readiness、stable bucket、SLO hold/promote、drain 和 effect-aware rollback。

H7-3 是作品集级 release control plane；容器文件是可重建演示配置，不声称当前机器已完成生产容器运行或真实基础设施部署。
