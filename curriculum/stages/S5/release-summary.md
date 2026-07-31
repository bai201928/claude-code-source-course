# S5 原子发布说明：恢复、安全治理与生产发布

状态：`released`

S5 原子发布 M24-M27，并把 Mini Agent Harness 从 `H5 / 0.5.0` 推进到最终课程里程碑 `H7 / 0.7.0`。Claude Code CLI 源码教材至此在 M27 完成，不创建 M28 或 S6。

## 四个正式单元

- [M24 进程退出后如何继续](../../units/M24/final.md)：Transcript 写入边界、容错重建、并行 DAG、未配对 Tool、Normal Resume、Fork、background/Cron 与 indeterminate effect；
- [M25 模型能调用不等于系统安全](../../units/M25/final.md)：Permission/Sandbox 分层、managed policy、worker identity、filesystem/network/process constraint、secret boundary 与 extension provenance；
- [M26 看不见就无法治理](../../units/M26/final.md)：run/attempt/tool identity、TTFT、cumulative usage、versioned cost/evaluation、tenant reservation、queue 与 metadata-only telemetry；
- [M27 把 Harness 交到生产](../../units/M27/final.md)：release manifest、protocol/schema/policy compatibility、readiness、canary、SLO、drain、effect-aware rollback 与容器参考拓扑。

## 质量门槛

四章都完成 Graphify 候选定位、直接源码核验、事实 A/B、Codex 裁决、双语言实验、独立教学闸门和 Harness merge。四个 FACT_B 与四个教学闸门均为 `PASS / 0`；FACT_A 的校准已全部进入正文或被明确反证。

四章共 78 张 Mermaid 图，均从完整 Markdown 实际渲染。恢复、安全、观测和发布的关键结论都给出失败注入、反证条件、迁移边界和资深 Agent 岗两分钟回答。

## H6/H7 里程碑

Harness `0.7.0` 保留 H0-H5 的消息、Query、Tool Loop、Context/Memory、扩展与协调契约，并新增：

- append-only `TranscriptStore`、容错 `RecoveryReducer`、normal/fork `ResumeCoordinator`、effect/background journal 与 pending-trigger takeover；
- revisioned `PolicyEngine`、worker/capability constraints、trusted-boundary secret resolution、extension provenance 与 fail-closed `SandboxPort`；
- closed metadata telemetry、observer-only exporter、cumulative-to-delta usage ledger、versioned cost/evaluation 与 tenant reservation/FIFO queue；
- immutable release manifest、protocol/schema/policy/feature compatibility、dependency readiness、stable canary、SLO guard、drain 与 effect-aware rollback；
- TypeScript 主实现、Python 行为镜像、Release demo、Dockerfile/Compose 参考部署和累计契约。

最终验证基线：TypeScript `144/144`、Python integrated `116/116`、strict typecheck PASS、H2 `4/4`、H1 `12/12`、S0 `15/15`、集成回归 `4/4`、两个 demo 与 Compose 静态配置均通过。

## 明确边界

本里程碑不声称实现物理 durable storage、自动 effect replay/compensation、真实 OS Sandbox、Vault/PKI、生产 OpenTelemetry、Provider 精确账单、分布式 quota/queue、Kubernetes controller、数据库迁移或灾备平台。Docker Desktop Linux daemon 不可用，因此未执行容器镜像运行冒烟；Compose 静态配置已验证。

课程已经完成，但 Harness 仍可作为作品集继续演进。后续改进应由真实项目需要驱动，而不是为了增加章节或追逐 Claude Code 私有实现比例。
