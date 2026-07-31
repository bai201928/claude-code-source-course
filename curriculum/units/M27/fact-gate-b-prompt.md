# M27 FACT_B：同会话对照

继续 FACT_A 会话，只核对下面 Codex 结论和 H7-3 候选契约，不重新总结仓库、不读取 Graphify、不修改文件。

## Codex 结论

- `QueryDeps` 仅注入 model、microcompact、autocompact、UUID，源码明确 scope intentionally narrow；`productionDeps()` 是这个窄切面的 production binding，不是全应用 DI container。
- `cli/update.ts::update()` 按 diagnostic/install method/channel 选择 native/package-manager/npm 路径；native installer 显式处理 lock contention；成功/失败进入 graceful shutdown。它是单机 CLI 自更新，不是 canary、rollback、schema rollout 或 distributed release lock。
- graceful shutdown 先设置单例状态和 failsafe，先退出 terminal/打印 resume hint，registered cleanup 先执行且有 2 秒 budget，SessionEnd hook 有独立 budget，analytics 最多等待约 500ms，最后 force exit。cleanup/analytics error 可被忽略，因此 bounded exit 不保证全部完成，也不是 server drain。
- 代表性 migration 先写新设置再删除旧字段，失败 catch/log 以避免阻断启动；它们保留用户意图，但不是统一 transactional migration framework 或自动 rollback。
- bridge v1/v2 有独立 min-version floor；worker epoch 用于 bridge registration/fencing。deployment environment detection 只是环境识别。这些不能自动证明通用 protocol negotiation/readiness/release epoch。
- 快照没有已证明的通用 Kubernetes controller、database schema rollout、canary/rollback/DR 或 release controller。

## H7-3

H7-3 是从零建立的 clean-room 迁移：immutable release manifest 绑定 binary/protocol/schema/policy/feature identity；worker registration fail closed；revisioned staged canary；SLO guard；ready/draining work ownership；rollback readability window；metadata-only report。它不声称 production Kubernetes、service mesh、database migrator、distributed consensus、跨节点 lease 或 effect compensation。

只报告会改变上述事实、实验或契约的实质问题。必须以下列三行开头；接受时明确 PASS / 0。

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```
