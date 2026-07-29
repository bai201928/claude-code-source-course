# FACT_B 同会话对照提示词

继续 FACT_A 会话，把独立结论与以下 Codex 摘要、教材边界和实验逐项对照。只在明确冲突时定向回读源码，不要扩大到 M04 之外的系统，不要修改任何文件。

## Codex 源码摘要

- `ask()` 是 SDK/Headless one-shot adapter：创建 QueryEngine，`yield* engine.submitMessage(...)`，并在 finally 把 `engine.getReadFileState()` 交回外部 callback。当前交互式 REPL 不被描述为经过 QueryEngine。
- QueryEngine 拥有 `mutableMessages`、AbortController、permission denials、usage、read-file state 与 discovery sets；部分字段跨 turn，`discoveredSkillNames` 在每次 submit 开始清空。
- `submitMessage()` 真实调用 `processUserInput()`，先追加 `messagesFromUserInput`，再用数组 spread 创建当前 turn 的浅数组视图；容器分离但元素对象仍共享引用。
- `shouldQuery=false` 时产生本地输出/result 后 return，不调用 `query()`；只有 truthy 路径到达 L675 的 `for await (const message of query(...))`。
- Query 事件按 type 修改不同 owner：assistant/progress/user/attachment 写入 mutable store，stream_event 更新 usage，部分事件写 transcript 或向 SDK yield；调用发生不等于所有事件拥有相同副作用。
- L245-L259 的 `tool` 是传给注入 `canUseTool(...)` 的实参，没有被当函数或 Tool 执行入口调用。Graphify 在该处的 inferred indirect call 已被源码否定。
- import、contains、references、callback protocol、call site、branch execution、state mutation 和 observable behavior 在教材中严格分层。

## 对 FACT_A 两项意见的裁决边界

1. 接受 `src/query/transitions.ts` 在当前快照中缺失。教材已经新增边界：不能声称原项目 Query 路径可在本地完整 typecheck 或直接构造运行；静态结论来自可见源码，运行验证来自独立 clean-room 实验。
2. 接受当前快照没有可直接定位的 QueryEngine 专题测试，但 FACT_A 在盲审阶段被禁止读取 M04 作者代码，因此“未观察到最小复现”不代表当前产物缺失实验。下面提供实际实验结果。

## 双语言最小复现与 H0 契约

M04 没有复制或实例化私有 QueryEngine；它实现最小 `TraceableEngine`，注入 `processInput` 与 `queryStream`，以 TraceLog 观察运行调用、owner mutation、数组视图、branch skip、event yield 和 partial failure。

TypeScript 5/5、demo、strict typecheck 均通过；Python 5/5 和 demo 均通过。共享测试验证：

1. 主路径实际观察到 processInput/queryStream 调用、assistant event 与 owner state 变化；
2. `shouldQuery=false` 时 query counter 为 0，Trace 无 Query call，并记录 branch.skipped；
3. request array view 保持 1 条，而 owner 在后续 append 后为 2 条，仅证明数组容器分离；
4. ToolProbe 作为参数传入权限 callback，`tool.run` 计数保持 0；
5. Query 先 yield partial assistant 再 throw 时，caller 失败，但 owner 保留 user + partial，Trace 记录 call.failed。

这组实验只验证源码追踪方法与 H0 行为契约，不冒充 Claude Code 官方测试，也不声称覆盖 `totalUsage`、permission denial、所有 result subtype 或真实 QueryEngine 的完整行为。M04 的目标不是补齐 QueryEngine 测试套件，而是教会学习者区分结构候选、调用条件、状态变化与可观察反证。

输出必须以三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

只报告事实错误、重要遗漏、证据层次混淆或实验/H0 契约无效。无问题写 `No material issues`。
