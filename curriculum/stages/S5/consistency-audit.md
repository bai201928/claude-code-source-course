# S5 跨章一致性审计

状态：`passed`

范围：M24-M27、H6/H7、根 README、Harness README、核心架构、全局索引、部署参考与累计回归。

## 结论

S5 可以原子发布。四章沿“恢复旧证据 -> 在新副作用前重新授权 -> 用无正文遥测治理运行 -> 在新旧版本并存时守住契约”形成最终连续依赖，没有会影响事实正确性、初学者理解、实验有效性、Harness 契约或凭据安全的冲突。

## 依赖与认知链

```text
M24：进程退出后，从哪些证据恢复，哪些状态绝不能假装复活
M25：恢复出的能力在发生新副作用前，怎样重新通过安全边界
M26：运行过程中怎样观测质量、成本与配额，又不复制正文和凭据
M27：新旧 binary/schema/policy/worker 并存时，怎样灰度、drain 和回滚
```

M24 接管 M23 的 stable pending trigger，但不把它扩大成 exactly-once。M25 明确 Permission 与 Sandbox 分层，并把真实 OS isolation 留给 adapter。M26 的 observer 没有执行权，usage 从 cumulative snapshot 转为 attempt delta。M27 只改变路由和 worker admission，不声称撤销 Tool effect。

## Owner 一致性

| 状态 | owner | 不拥有 |
| --- | --- | --- |
| append-only recovery evidence | `TranscriptStore` | live process、remote effect truth |
| conservative recovered view | `RecoveryReducer` | Transcript mutation、automatic replay |
| normal/fork resume orchestration | `ResumeCoordinator` | old runtime handle、全部 domain store |
| policy revision | `PolicyEngine` | secret value、worker process |
| checked execution envelope | `SecurityExecutor` / `SandboxPort` | Permission source、OS isolation guarantee |
| metadata event delivery | `TelemetryRecorder` | run outcome、prompt、Tool payload |
| usage/cost/evaluation records | `UsageCostLedger` / `EvaluationLedger` | Provider billing truth、execution permission |
| tenant reservation and queue | `TenantGovernor` | distributed quota、organization policy |
| release/canary/drain state | `ReleaseController` | infrastructure、Transcript、effect compensation |

这些 owner 没有合成一个全局 revision，也没有让 observability、release controller 或 recovery reducer 取得 AgentRuntime/ConversationStore 的写权。

## 事实、教学与图文

- M24-M27 的 FACT_B 与独立教学闸门全部为 `PASS / 0`；
- FACT_A 分别为 `REVISE / 4`、`REVISE / 7`、`REVISE / 6`、`REVISE / 6`，问题均已裁决并进入正文或被明确反证；
- M24 `22/22`、M25 `18/18`、M26 `19/19`、M27 `19/19`，合计 `78/78` Mermaid 从完整正文实际渲染；
- Transcript durability、OS Sandbox、publisher authenticity、Provider billing、分布式 quota、Kubernetes/数据库迁移和 effect rollback 都没有被参考实现夸大；
- TypeScript/Python、Java/Spring、RAG 与 LangGraph 对照保持行为契约映射，没有把框架 API 当作源码事实。

## Harness 回归

```text
TypeScript integrated: 144/144
Python integrated: 116/116
TypeScript strict typecheck: PASS
H2: 4/4
H1: 12/12
S0: 15/15
Integrated Agent regression: 4/4
Agent demo: PASS
Release-control demo: PASS
Docker Compose config: PASS
```

Docker CLI 可以解析 Compose 配置；Docker Desktop 的 Linux daemon 当前不可用，因此没有执行镜像 build/run 冒烟。该限制已在部署文档中如实记录，不影响 TypeScript/Python 协议实现、静态部署配置或教材发布。

## 发布决定

Decision：`publish S5 atomically`。

发布动作：M24-M27 的 `draft.md` 同时复制为 `final.md`；Harness 升级为 `H7 / 0.7.0`；补齐 H6/H7 累计契约、架构、README、术语、知识、源码符号与 TypeScript 索引。Claude Code CLI 教材在 M27 完成，不创建 M28 或 S6。
