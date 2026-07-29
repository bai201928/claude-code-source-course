# H1 行为契约

版本：`H1`

当前来源单元：M05、M06、M07、M08、M09。本文件冻结已经验证的运行表面、配置快照、运行状态、能力投影和生命周期收尾边界。

## 新增不变量

1. 外部运行表面只负责把输入适配为领域 command，并把领域 event 投影为目标输出；Core 不读取 TTY、React 或输出格式。
2. Interactive 与 Headless 对同一 command 必须观察到相同的 Core event 序列，表面差异不能改写领域语义。
3. Headless 的 `text`、`json`、`stream-json` 只改变输出投影；`stream-json` 保持一条事件一行。
4. NDJSON 必须在调用 Core 前完成逐行解析和运行时校验；非法输入不能创建 H0 运行实例或产生伪成功。
5. Interactive 表面可连续接收 prompt；当前 M05 契约不声称多个 H0 run 已共享会话历史，该所有权在后续 H1 单元中演进。
6. surface close 后拒绝新输入，不调用 Core，不伪造 assistant/result。
7. H0 的异常在表面边界映射为显式 `failure` event；已经产生的 progress event 保持可观察。
8. 未知领域 event 或输出格式在投影边界显式失败，不静默丢弃。
9. `SurfaceTrace` 观察适配器边界，但不拥有业务消息、运行状态或会话生命周期。

## M06 配置快照不变量

10. `ConfigurationResolver` 接收显式有序来源，产生带 revision 的新 snapshot；旧 snapshot 不被热更新原地修改。
11. H1 默认 canonical 顺序固定为 `user -> project -> local -> flag -> policy`。`flag` 与 `policy` 必须存在，Harness 内部不能写回这两个来源。
12. snapshot-compatible 顺序函数只用于复现当前源码在显式 `--setting-sources` 下的 Set 插入行为，不是 Harness 的企业默认策略。
13. policy provider 按 `remote -> mdm -> managed file -> hkcu` 选择首个 valid/non-empty provider；不同 provider 不互相合并。
14. 已选来源按显式顺序深合并：对象递归，标量由后来源覆盖，数组连接并按 SameValueZero 语义去重。
15. 整个无效来源被拒绝并留下 error；Resolver 不从一个 schema-invalid source 中静默捞取部分字段。
16. snapshot 记录 scalar leaf 和 array item provenance。该能力是 Harness 设计迁移，不冒充 Claude Code 当前 `getSettingsWithSources()` 的字段级 API。
17. pre-trust environment projection 只接受 user/flag/policy 的任意变量与 effective settings 中的 safe allowlist；trusted projection 才使用全部 effective env。
18. 配置发现和副作用投影位于 RuntimeCore 外围。Core 只接收已发布 snapshot，不直接读取 argv、设置文件或 `process.env`。

## M07 运行状态分层不变量

19. `RuntimeContext` 只保存进程级不可变依赖与 configuration revision；缺失 runtime ID、model adapter 或合法配置 revision 时，必须在请求创建前失败。
20. `SessionStateStore` 是当前 session root 和 revision 的 owner；每次 publication 创建新 root，并复制、冻结调用者输入，旧 revision 不被原地修改。
21. store 以 root identity 判断 no-op。同一 root 被原地修改后返回时不运行 observer/subscriber；这是一项需要测试暴露的危险语义，不是推荐更新方式。
22. 新 root 先成为 current state，再同步运行 observer，最后按订阅顺序同步运行 subscribers。订阅者通过 getter 读取新状态，不从通知参数接收副本。
23. observer 或 subscriber 异常不触发回滚。异常发生前已提交的 root 保持 current，后续 listener 可能没有运行；调用方不得把它误认成事务。
24. `RequestContext` 在创建时显式冻结 runtime ID、configuration revision、session revision 和 session values。新 session publication 不得改变旧 RequestContext。
25. `readFreshSession()` 是显式读取当前 session 的逃生口。它可以与旧 request snapshot 并存，但调用者必须自己判断是否允许打破当前请求的一致视图。
26. M07 分层不复制 Claude Code 的模块级 Bootstrap `STATE`，也不把 `RuntimeContext` 伪装成其公开 API；这是从其所有权问题中抽取的 clean-room 设计。

## M08 能力投影不变量

27. `CapabilityCatalog` 保存带 source、priority 和 revision 的发现结果；同名能力只通过显式 priority 产生唯一 active definition，不依赖消费者偶然的 first/last 规则。
28. Discovery、model visibility、permission allow 与 executable registration 是四个独立状态，不得以一个布尔 `enabled` 代替。
29. `CapabilityProjector` 按 policy、mode、provider、model 和 deferred discovery 生成带 reason 的 immutable snapshot；snapshot 同时保留本次投影的 mode、provider 与 model，便于请求、执行和追踪对齐。旧 snapshot 不随 catalog publication 原地更新。
30. 能力 refresh 只在声明的 request/model-iteration boundary 创建新 snapshot；正在使用的 snapshot 不接受异步原地改写。
31. Deferred capability 可以已在 `ExecutableRegistry` 注册，却在 discover 前没有 model-visible schema。
32. 每次 dispatch 必须同时验证当前 snapshot 可见性和本地 handler 注册；model-visible 但未注册的工具必须 fail closed。
33. `SystemContextBuilder` 明确区分 default、custom replacement、append、meta user context 和 system context；它不把 Claude Code Interactive/Headless 当前不同的 prompt builder 伪装成同一路径。
34. Capability 名称使用 portable ASCII identifier，并以 code-point 顺序稳定排序，保证 TypeScript/Python trace 可复现。

## M09 生命周期收尾不变量

35. `LifecycleCoordinator` 只拥有 Harness 内部的 `running -> stopping -> stopped` 状态、cleanup 注册表和共享 shutdown report；OS signal 接线、终端恢复/提示与最终 process exit 属于外层 Surface adapter。
36. 第一个合法 shutdown request 获得收尾所有权；后续调用复用同一个 Promise/Task 和 report，不覆盖 reason、exit code 或预算。
37. cleanup 按 `critical -> resource -> best-effort` 跨层串行；同一层内并发启动并独立记录 `completed | failed | timed-out`，单个失败不跳过同层 peer 或后续层。
38. 每层 handler 获得合作式取消信号。层预算到期会记录 `timed-out` 并发送 reason，但不宣称底层 Promise/Task 已被物理取消或完成。
39. overall deadline 用尽后，未开始的低优先级 handler 记录为 `skipped`，触发 failsafe callback；已形成的关键层结果必须保留在 report 中。
40. `prepare` 在异步 cleanup 前执行，可尽早恢复外部运行表面并产生基于已持久化 identity 的 recovery hint；其失败被 trace 观察，但不阻断 cleanup。
41. cleanup 注册只在 `running` 状态开放；unregister 幂等。进入 stopping 后 snapshot 注册项并拒绝晚到工作，防止 drain 目标持续增长。
42. `critical/resource/best-effort` 是 Harness 的设计迁移，不冒充 Claude Code 当前快照的 `cleanupRegistry`；后者仍是无 phase/priority 的 Set + `Promise.all`。

H0 的全部不变量继续有效，见 `h0-contract.md`。

## 回归命令

```powershell
cd "D:\agent\Claude code最新\mini-agent-harness"
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-h1-regression.ps1
```
