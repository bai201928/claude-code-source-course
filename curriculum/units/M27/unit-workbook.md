# M27 研究工作簿：部署、灰度、回滚与系统设计闭环

状态：`researched`

风险：`R2`。本章主体是跨单元集成与 clean-room 生产迁移；最大风险不是漏掉一个 CLI 命令，而是把客户端自更新、best-effort migration 或版本门槛夸大成企业发布平台。

## 1. 单元问题与边界

本单元回答：累计 Harness 怎样在不破坏消息、恢复、安全和治理契约的前提下发布新 worker，怎样用 protocol/schema/policy compatibility 阻止危险灰度，怎样 drain、canary、rollback 并把 SLI/SLO 变成 release decision？

包含：

- composition root 与 deployment topology；
- binary/protocol/schema/policy/feature identity；
- expand/migrate/contract 与 rollback window；
- worker registration、readiness、drain 和 work ownership；
- canary stages、SLI window 与 SLO guard；
- rollback、indeterminate effect、queue/transcript takeover；
- capacity、RTO/RPO、威胁模型与作品集系统设计表达；
- H7-3 release control plane 和最终 H7 contract。

不包含：

- 把 Claude Code CLI 快照描述成 server orchestrator；
- 实现 Kubernetes、Redis、PostgreSQL 或真实 OTel backend；
- 逐项枚举 CLI update UI；
- 宣称本地 in-process controller 具备 distributed consensus；
- M28 或 S6。

## 2. Graphify 候选与源码闭合

Graphify 只定位 `cli/update.ts`、`gracefulShutdown.ts`、`commandLifecycle.ts`、`query/deps.ts`、`migrations/`、deployment environment 和 bridge minimum-version gate。以下结论均由直接源码阅读闭合。

## 3. Composition root

`src/query/deps.ts` 的 `QueryDeps` 只注入四个 I/O dependency：model call、microcompact、autocompact、UUID。`productionDeps()` 绑定真实实现，测试可以传 fakes。源码注释明确说 scope intentionally narrow，后续才可能加入 runTools/hooks/log/queue。

因此可以迁移“composition root 负责绑定 port/adapter”的思想，但不能说快照已把所有运行组件完整依赖注入。

## 4. CLI 自更新边界

`src/cli/update.ts::update()`：

- 先运行 doctor diagnostic，识别 multiple installation 和 install method；
- channel 来自 `autoUpdatesChannel`；
- native path 调用 installer，并显式处理 update lock contention；
- package-manager/development/native/npm-local/npm-global 路径不同；
- 版本相同直接结束，成功/失败最终进入 graceful shutdown；
- 这是单机 CLI binary/package 更新，不是多 worker canary 或 schema rollout。

## 5. Graceful shutdown

`src/utils/gracefulShutdown.ts`：

- `shutdownInProgress` 让重复调用直接返回；sync facade 保存 pending promise；
- failsafe budget 是 `max(5s, SessionEnd hook budget + 3.5s)`；
- 先退出 terminal mode 并打印 resume hint；
- session/registered cleanup 先执行，单独 2 秒 race budget；
- SessionEnd hook 用 AbortSignal 和整体 budget；
- analytics shutdown capped at 500ms，slow network 丢 analytics 可接受；
- 最终 `forceExit()`；
- cleanup registry 内部是 `Promise.all`，错误在 graceful layer 被吞掉。

这体现 critical state before best-effort observers 与 bounded shutdown。它不等价于 server worker drain：没有 load balancer deregistration、queue lease handoff、Kubernetes termination grace 或跨节点 ownership transfer。

## 6. Migration 与 compatibility

快照包含多个针对设置/模型别名/MCP approval 的一次性 migration。代表性实现：

- `migrateAutoUpdatesToSettings()` 先写新 settings/env，再删除旧 global config 字段；失败 catch/log，不阻断启动；
- `migrateEnableAllProjectMcpServersToSettings()` 成功后删除旧字段，失败只记录；
- model migrations 保留用户显式意图。

这些是客户端 best-effort 配置迁移，不是统一 migration ledger、数据库事务、expand/contract framework 或 rollback-safe schema protocol。

## 7. Version 与环境门槛

- `checkEnvLessBridgeMinVersion()` 将当前 `MACRO.VERSION` 与远端配置 `min_version` 比较，过旧则拒绝 Remote Control 路径并提示更新；v1/v2 有独立 floor。
- bridge worker 使用 epoch/registration identity 处理新旧连接，但不能外推为通用 release epoch。
- `detectDeploymentEnvironment()` 从 env/平台标记识别 codespaces、AWS、GCP、Cloud Run 等，主要是环境识别，不是 readiness 或 deployment orchestrator。

## 8. H7-3 候选契约

新增 TypeScript/Python 等价实现：

- immutable `ReleaseManifest`：release ID、binary、protocol range、read schemas、write schema、policy revision、feature revision；
- `ReleaseController` revisioned prepare/begin/advance/promote/rollback；
- worker registration 校验 release、protocol、schema 和 policy identity；
- worker ready/draining 与 active work count；draining 后拒绝新 work，已有 work 显式 complete；
- staged canary traffic percentage；caller 提供 stable bucket；
- `SloPolicy` / `SliWindow`：sample、success、p95、observer drop、unknown cost；
- SLO 不满足阻止 advance；
- prepare 先验证 candidate 能读 active writes，且 previous 能读 candidate writes，保持 rollback window；
- rollback 只切换 routing/release owner，不声称回滚已经发生的 Tool effect；
- metadata-only release report。

明确不声称：Kubernetes controller、service mesh、database migrator、distributed consensus、跨节点 work lease、自动 effect compensation 或 production feature flag service。

## 9. 实验与反证

| 实验 | 结论 | 反证条件 |
| --- | --- | --- |
| composition | release manifest 固定 protocol/schema/policy identity | worker 只凭 binary version 注册 |
| forward read | candidate 必须能读 active write schema | 新 worker 读不了旧记录仍 canary |
| rollback read | active 必须能读 candidate write schema | canary 一写新 schema就无法回滚 |
| worker registration | mismatch fail closed | stale policy worker 接单 |
| canary route | stable bucket 按 stage percentage | 未开始 canary就进 candidate |
| SLO guard | bad success/p95/drop/unknown cost 阻止推进 | 指标坏仍升流量 |
| drain | draining worker 不接新 work | SIGTERM 后继续领取任务 |
| completion | active work 显式归零后才 drained | 直接 kill 冒充无在途工作 |
| rollback | 路由回 previous、candidate drain | rollback 重复 Tool effect |
| metadata | report 无 prompt/tool/secret | 发布事件复制业务正文 |

## 10. 事实闸门范围

重点反证：

- `productionDeps()` 是完整应用 DI container；
- CLI update 是 canary/rollback platform；
- update lock 等于 distributed release lock；
- graceful shutdown 保证所有 cleanup/analytics 都完成；
- 2 秒 cleanup 或 500ms analytics cap 是 server SLO；
- settings migrations 是事务性、统一或可自动回滚；
- deployment environment detection 等于 readiness；
- bridge min-version/epoch 是通用 worker protocol negotiation；
- 快照已有 Kubernetes、schema rollout、DR 或 release controller。
