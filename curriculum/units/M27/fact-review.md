# M27 事实闸门审查与裁决

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 6
```

独立盲审确认了 Query DI、自更新、graceful shutdown、migration、bridge version/epoch 与 deployment environment 的有限证明力，并确认快照没有通用 production rollout controller。

## Codex 裁决

| Issue | Decision | Reason | Change |
| --- | --- | --- | --- |
| M27-A1 `QueryDeps` 不是完整 composition root | accepted | 只有四个 dependency，注释明确是 narrow pattern proof | 正文只迁移 port/adapter binding 思想 |
| M27-A2 CLI update 不是多 worker rollout | accepted | native lock 是本机安装竞争处理；函数最终只更新当前安装并退出 | canary/rollback 全部标为 H7-3 clean-room |
| M27-A3 graceful shutdown 不保证全完成 | accepted | cleanup 并行且无拓扑排序，有 2s/500ms/failsafe budget 和 force exit | 讲 bounded best-effort、critical-before-observer，不称 server drain |
| M27-A4 migration 不是 ACID | accepted | 多个独立文件写、粗粒度 version、失败重试且无原子 rollback | 用它引出 write-new-delete-old，再迁移到 expand/migrate/contract |
| M27-A5 version/epoch/env 证明力有限 | accepted | semver floor 默认可放行；epoch 是 stale worker fencing；env 是 analytics metadata | 不把它们称协议协商、readiness 或 release epoch |
| M27-A6 无通用 canary/rollback/schema/DR controller | accepted | GrowthBook、native installer rollback 等邻近词不构成发布平台 | H7-3 明确为作品集迁移设计并写清平台边界 |

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同一会话接受校准后的六条快照结论和 H7-3 候选契约，无剩余实质问题。
