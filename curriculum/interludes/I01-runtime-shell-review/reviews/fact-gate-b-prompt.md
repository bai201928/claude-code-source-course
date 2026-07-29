# I01 事实闸门 B：同会话对照审查

继续刚才的 FACT_A，同一会话内执行 FACT_B。不要丢弃你在 A 阶段读取的源码上下文，但也不要把 A 的首次判断视为不可修正的结论。现在请将下面的 I01 关键表述、图语义与实验边界逐项对照当前源码和必要的已发布 clean-room 实验。

仍然只读，禁止修改任何正文、源码、实验或 Harness。禁止读取 Graphify 或使用任何图谱输出作为证据。不要读取 I01 `draft.md`；本提示词已经给出需要核验的最小作者结论。

## 首要冲突：必须回源码重新裁决

FACT_A 输出称“Interactive 与 Headless 均进入 `QueryEngine.ask()`”。I01 的关键结论是：

```text
Interactive REPL
-> REPL 自己的 messages/messagesRef 与提交 owner
-> REPL 的 processUserInput / onQuery 边界
-> query()

Headless / SDK
-> print.ts 的 mutableMessages
-> ask() 创建 QueryEngine
-> QueryEngine.submitMessage/processUserInput
-> query()
```

I01 因而明确写成：Interactive REPL **不经过 `QueryEngine`**；两条路径在 `query()` 及其后续 Query Loop 能力边界汇合。请定位 Interactive 的真实调用者、`ask()` 的真实使用位置和 `query()` call site，明确纠正 A 或判定 I01 错误。不要用同名 `processUserInput` 或共享 import 推断调用。

## I01 待对照的精简关键结论

### A. 入口与 Surface

1. `entrypoints/cli.tsx` 的 fast path 可以在完整 `main.tsx` 前返回；普通路径才进入 `main.tsx`。
2. `main.tsx` 依据 print/init/sdk-url/TTY 等条件分类 Interactive 与 Headless。`clientType` 是来源标签，不拥有表面选择。
3. Interactive 由 Ink root、AppStateProvider 与 REPL 拥有 UI 和交互式消息；Headless 创建独立 store 并把 getter/setter 交给 `runHeadless()`。
4. `StructuredIO` 把任意 chunk 重组为换行 frame，解析/校验结构化输入，管理 control request/reply，并按 NDJSON 顺序投影输出。
5. “Surface 不改变 Core 领域事件语义”是 H1 clean-room 契约，不是声称 Claude Code 两个表面完全对称。

### B. 配置与信任

1. policy provider 是 remote → MDM/HKLM/plist → managed files → HKCU 的 first-valid selection；选中 managed files 后，base 与有序 drop-ins 才在 provider 内合并。
2. 嵌套对象递归合并、数组连接去重、标量由后值覆盖。
3. 当前快照的 `--setting-sources` 实现使用保留插入顺序的 Set；显式来源先加入，随后 policy/flag 可被追加，因此实际 enabled-source 迭代顺序可能成为 ordinary sources → policy → flag。I01 没把这说成新的固定企业优先级，而是 snapshot compatibility behavior。
4. effective settings 之后仍有 permission runtime chooser；pre-trust 只应用安全投影，Headless 是调用者承担前置信任责任，不是“不需要信任”。
5. H1 的 `ConfigurationSnapshot`、revision、叶子 provenance 与 canonical user → project → local → flag → policy 是 clean-room 设计迁移；I01 明确不把它们当作 Claude Code 真实字段。

### C. 状态 owner 与时间视图

1. Bootstrap `STATE` 是模块级可变对象；`AppState` 是形状；每个 `createStore()` 闭包拥有自己的 current root 与 listeners。一个进程可出现多个 store，它们不自动同步。
2. `createStore` 用 root identity 决定通知：返回同一引用可在原地改值却不通知；返回新 root 即使内容相同也通知。提交先于 observer/subscribers，失败不提供事务回滚。
3. render closure 的旧值可能是 stale bug；请求有意保存的 snapshot 则是稳定性策略。`getState()`/`getAppState`/refresh callback 是显式 fresh-read 边界。
4. `RuntimeContext`、`SessionStateStore`、`RequestContext` 是 H1 clean-room 名称，不是 Claude Code 真实类名。

### D. 能力发现、可见性与执行

1. discovery/runtime pool、模型可见 schema、permission、ExecutableRegistry 不是同一清单；Tool Search/deferred visibility 解决上下文预算，不等于授权。
2. `getAllBaseTools()`、`getTools()`、MCP 合并与 API schema 投影位于不同边界；同名、mode、deny 与 `isEnabled()` 必须按真实 consumer 解释。
3. Interactive 可以在工具结果后、下一模型迭代前通过 `refreshTools` fresh read；Headless 在排队 command 前重建/装配工具，但当前 `QueryEngineConfig` 捕获具体 tools，未拥有相同的内部 iteration refresh callback。
4. 迟到 MCP Search 不原地改写已经发出的 schema；紧急 deny 应在执行副作用前重新检查当前 policy，这是 clean-room 企业迁移。
5. H1 的 `CapabilityCatalog -> CapabilityProjector -> CapabilitySnapshot -> ExecutableRegistry` 和显式 priority 是设计迁移。H1 只验证可见但无 handler 时 fail closed，不声称已经实现模型 `tool_use` 或完整 Tool Loop。

### E. 异步事件、取消与资源

1. `query()` 以 `yield* queryLoop()` 转发事件并保留正常 terminal；consumer throw 前已经提交的消息、Transcript 或 SDK 事件不会自动回滚。
2. Headless/SDK 的 `QueryEngine.submitMessage()` 使用 `for await` 消费事件；普通 `for await` 不取得 generator 的 return value，外部结果由已观察消息与 stop reason 收敛。
3. `Stream<T>` 是 push-to-pull adapter，内部队列可无界；AsyncIterable 本身不保证端到端背压、广播或资源终止。
4. iterator close、AbortSignal、timeout、kill request、background ownership transfer、OS exit/remote ACK 和 cleanup completion 是不同事实。
5. REPL 取消会先收敛可能存在的 partial assistant，再 abort 当前 turn；session 与 process 可继续。
6. H0 把 cancel intent、termination request、exit confirmation 和 cleanup 作为可观察契约，这是 clean-room 迁移，不声称 Claude Code 内部使用这些类名或事件名。

### F. Session 与 Process lifecycle

1. Esc/turn cancellation、`/clear` 或 `/resume` 的逻辑 SessionEnd、`/exit`/signal 的 process shutdown、SIGKILL/OOM 的 hard termination 是不同作用域。
2. `setupGracefulShutdown()` 较早安装全局 handlers；Headless 对 in-flight controller 另有表面特定 SIGINT 处理，全局 handler避免与 Print 路径竞争。
3. `gracefulShutdownSync()` 发起异步 shutdown 后返回；首个合法调用者拥有 reason/exitCode，后续调用不重复执行。
4. 当前快照的主顺序是 overall failsafe → exitCode/terminal restore → resume hint → cleanup registry（约 2 秒外层等待）→ SessionEnd hooks → profile/cache → analytics（约 500ms）→ force exit。
5. registry 实际是 Set + Promise.all：调用顺序与完成顺序不同；一个 reject 可使外层 fail fast；Promise.race timeout 不取消 loser；Transcript 不保证第一完成。
6. H1 的 prepare/critical/resource/best-effort phase、all-settled、immutable report 与 cooperative timeout 是设计迁移，不是 Claude Code registry 的快照事实。

## I01 图语义边界

I01 的 19 张图只表达下列决定性关系，不把图中的 clean-room 名称伪装成源码符号：

- 入口图分开 Interactive REPL 和 Headless QueryEngine，两路只在 `query()` 后续边界汇合；
- 配置图分开 provider selection、source iteration/merge、runtime decision 与 trust；
- owner 图分开 Bootstrap、各 root/store、render snapshot、fresh read 与请求稳定视图；
- capability 图分开 discovery、policy projection、snapshot、model schema、intent、registry 与执行时授权；
- event 图表达逐项消费、部分提交和 throw 不回滚；
- cancel 图表达 intent → signal → adapter action → confirmation → cleanup，明确 signal 不等于确认；
- scope 图分开 turn、session、process 与 hard termination；
- shutdown 图先画 Claude Code 的实际价值顺序，再单独画无 phase registry 的并发语义与 H1 分阶段设计；
- H0/H1 图把 H0 行为核心置于 H1 运行壳内，但不声称 H1 已有真实 provider、多轮 conversation owner 或完整 Tool Loop。

请检查是否有任何箭头把 callback、共享数据、刷新时机或 clean-room 设计误画成真实运行调用。

## 实验与 Harness 边界

必要时定向读取下列已发布实验代码和测试；不要读取其 `final.md`、draft 或 review：

- M02：`curriculum/units/M02/code/typescript/`、`code/python/`，验证 generator 惰性、`yield*`、提前关闭、throw 前事件保留与 push queue 增长；
- M03：相同目录，验证 cancel request、process exit/cleanup 事件区分和资源 owner；
- M05：验证 Interactive/Headless 投影前领域事件等价，不把投影格式传入 Core；
- M06：验证 source order、policy selection、merge、trust projection 与 clean-room snapshot 稳定性；
- M07：验证 store root identity、提交/通知顺序、listener failure 不回滚，以及 H1 request revision 稳定性；
- M08：验证 visibility/registry 分离、迟到能力只进入新 snapshot、deferred schema 与 Ghost fail closed；
- M09：验证 Set + Promise.all 的 slow/fail 边界，以及 H1 phased LifecycleCoordinator 的结构化 report。

可定向读取：

- `mini-agent-harness/contracts/h0-contract.md`
- `mini-agent-harness/contracts/h1-contract.md`
- 与上述契约直接对应的 `mini-agent-harness/typescript/`、`python/` 测试和实现。

这些只能证明 clean-room 行为实际被实现和测试，不能反向证明 Claude Code 快照采用相同结构。

I01 明确声明 H1 当前**没有**：跨多 prompt 的共享 conversation owner、真实 LLM provider 与模型事件组装、完整 Tool Loop/工具结果反馈/终止状态机、完整 Transcript/恢复/Sandbox/分布式治理。请检查实验或合同是否与这些能力边界冲突。

## 输出要求

只报告会影响 I01 事实正确性、图语义、实验有效性或 H0/H1/后续 Harness 契约的问题。不要报告措辞偏好、格式问题、可选扩展或无现实影响的边缘情况。

输出必须从以下三行开始，前面不要加说明、代码围栏或分隔线：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有问题，使用稳定编号 `I01-FB-01`、`I01-FB-02`，并包含：

- `I01 表述/图/实验位置`；
- `源码或测试路径与符号`；
- `独立核验结果`；
- `影响`；
- `最低必要修改`。

对于 FACT_A 中被本阶段源码复核推翻的判断，单独列为 `A 阶段更正`，但只有 I01 本身也错误时才计入 `MATERIAL_ISSUES`。若 I01 结论正确而 A 的摘要错误，应明确更正 A 后给 I01 `PASS`，不要为了保持前一轮一致而制造问题。
