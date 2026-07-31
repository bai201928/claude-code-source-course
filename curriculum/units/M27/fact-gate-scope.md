# M27 事实闸门范围

独立审查当前 `claude-code-CLI/` 快照中与最终生产迁移有关的决定性边界：

1. `src/query/deps.ts` 的依赖注入范围与 `productionDeps()` 边界；
2. `src/cli/update.ts` 的 install method/channel/diagnostic/native lock/结束语义，以及它不是多 worker rollout；
3. `src/utils/gracefulShutdown.ts` 与 cleanup registry 的阶段顺序、预算、失败和重复调用语义；
4. `src/migrations/` 中代表性设置/MCP migration 的写新删旧、失败策略与非事务边界；
5. bridge minimum-version gate、worker epoch 与 deployment environment detection 能证明什么、不能证明什么；
6. 快照是否存在通用 canary、rollback、database schema rollout、readiness、DR 或 release controller。

目标是为 M27 的企业迁移划定事实边界，不枚举 update UI，不审查 Graphify，不修改文件。只报告会改变教材事实、实验或 clean-room H7-3 契约的问题。
