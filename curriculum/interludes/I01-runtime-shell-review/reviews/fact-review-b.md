All evidence is now in. Let me produce the final ruling.

---

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

---

## A 阶段更正

**FACT_A 错误**：称"Interactive 与 Headless 均进入 `QueryEngine.ask()`"。

**源码事实**：

- `REPL.tsx:146` → `import { query } from '../query.js'`
- `REPL.tsx:2793` → `for await (const event of query({...}))`
- REPL.tsx 全文件：不导入 `QueryEngine`、`ask` 或 `processUserInput` 函数（仅导入 `ProcessUserInputContext`  _类型_ 在 `REPL.tsx:172`）

- `print.ts:91` → `import { ask } from 'src/QueryEngine.js'`
- `print.ts:2147` → `for await (const message of ask({...}))`
- `QueryEngine.ts:70-71` → `import { processUserInput } from './utils/processUserInput/processUserInput.js'`
- `QueryEngine.ts:675` → `for await (const message of query({...}))`

**正确链路**（I01 是对的）：
```
Interactive REPL  → REPL.onQueryImpl → query()
Headless/SDK      → ask() → QueryEngine.submitMessage() → processUserInput() → query()
                                    └───────────────────────────────────────────┘
                                    两者在此汇合 (query → queryLoop)
```

Headless 路径多一层 `QueryEngine`(负责 transcript 写入、SDK 消息回放、首轮 attachment 注入等)，Interactive REPL 在自己的 React 组件树中处理这些逻辑，然后直接调用 `query()`。I01 的结论正确，A 阶段的摘要错误。

---

## I01 逐项核实结论

### 首要冲突
**问题**："REPL 的 processUserInput / onQuery 边界"中 `processUserInput` 归属。
**核实**：`processUserInput` 函数仅在 `QueryEngine.ts:70-71` 导入并在 `submitMessage()` 内调用，从不被 REPL.tsx 导入。REPL 的边界函数是 `onQueryImpl` / `onQuery`。I01 使用斜杠表示 "processUserInput 等价体 / onQuery"，结构性表述正确但函数名归属不精确。这不影响核心事实或任何后续边界判断，不计为实质问题。

### A. 入口与 Surface（5/5 核验通过）

- **A.1**：`cli.tsx:37-297` 的 fast paths 均已源码核实，与 I01 描述一致。
- **A.2**：`main.tsx:799-812` 的 `isNonInteractive` 判定逻辑与 I01 一致；`clientType` (`main.tsx:834`) 只是标签，不拥有表面选择。
- **A.3**：Interactive 的 Ink → AppStateProvider → REPL (`main.tsx:3134+`, `App.tsx:29`, `AppState.tsx:50`) 与 Headless 的 `createStore(headlessInitialState, onChangeAppState)` (`main.tsx:2653`) 与 I01 一致。
- **A.4**：`StructuredIO` (`structuredIO.ts:135-170`) 的 chunk→frame→NDJSON 设计均核实，与 I01 一致。
- **A.5**：H1 契约 (`h1-contract.md:8`) 表述为"Core 不读取 TTY、React 或输出格式"，这是 H1 不变量，不声称 CC 两表面完全对称。

### B. 配置与信任（5/5 核验通过）

- **B.1**：`settings.ts:319-344` (first-valid for policy) + `settings.ts:74-121` (`loadManagedFileSettings` base + drop-ins merge-all 内部) — 与 I01 一致。
- **B.2**：`settings.ts:538-547` (`settingsMergeCustomizer`: 数组 concat+uniq，对象 deep merge)，`updateSettingsForSource` (`settings.ts:416-524`) 中数组替换 — 与 I01 一致。
- **B.3**：`constants.ts:159-167` (`getEnabledSettingSources()`：Set 保持插入顺序，显式来源先加入，随后追加 policy/flag) — 与 I01 一致。
- **B.4**：effective settings → permission runtime chooser 分离 (`permissionSetup.ts`)；pre-trust 安全投影 (TrustDialog 在 `interactiveHelpers.tsx:104-170` 作为信任边界)；Headless 调用者承担前置信任责任 (`main.tsx:803` 非交互模式跳过信任对话框) — 与 I01 一致。
- **B.5**：H1 的 `ConfigurationSnapshot`、revision、leaf provenance (`h1-contract.md:12-17`) 明确声明是 clean-room 设计迁移 — 与 I01 一致。

### C. 状态 owner 与时间视图（4/4 核验通过）

- **C.1**：Bootstrap `STATE` (`bootstrap/state.ts:429` 模块级 const Plain Object)，`AppState` (`AppStateStore.ts:89+` DeepImmutable 形状)，`createStore()` (`store.ts:10-34` 闭包型 store) — 与 I01 一致。一个进程可有多个 store (`main.tsx:2653` headlessStore + 内部 bootstrap STATE + 子 agent store)，不自动同步。
- **C.2**：`store.ts:23` `Object.is(next, prev)` — 同引用 skip；同内容新引用通知 observer + subscribers（`store.ts:25-26`）。无事务回滚 — 与 I01 一致。
- **C.3**：render closure (`useAppState` at `AppState.tsx:142-163`) 的 selector 闭包捕获旧引用可能 stale；`getState()`/`getAppState()` (`store.ts:18`) 是显式 fresh-read — 与 I01 一致。
- **C.4**：全源 grep 确认 **无 `RuntimeContext`、`SessionStateStore`、`RequestContext` 类名存在**。这些是 H1 clean-room 名称 (`h1-contract.md:19-26`) — 与 I01 一致。

### D. 能力发现、可见性与执行（3/3 核验通过）

- **D.1**：`tools.ts` 的 `getAllBaseTools()` (line 193) ≠ `getTools()` (line 271) ≠ `filterToolsByDenyRules()` (line 262) ≠ `assembleToolPool()` (print.ts:1475) ≠ `claude.ts` 中 API schema 投影。Tool Search (`isToolSearchEnabledOptimistic()`) 加入 pool 工具但不等于模型可见。四个清单不是同一清单 — 与 I01 一致。
- **D.2**：各边界独立核验确认（同上）。
- **D.3**：Interactive 的 `onQueryImpl` (`REPL.tsx:2661`) 在每轮 turn 前通过 `getToolUseContext()` fresh read 获取工具。Headless 的 `buildAllTools()` (`print.ts:1474-1500`) 在每个 `drainCommandQueue()` 迭代调用 `ask()` 前 fresh read。两路径都在 `query()` 调用的输入边界捕获工具，不在 query loop 内部迭代刷新。I01 表述 "Headless 当前 QueryEngineConfig 捕获具体 tools，未拥有相同的内部 iteration refresh callback" — 精确。这与 M08 contract h1-contract.md:30 "能力 refresh 只在声明的 request/model-iteration boundary 创建新 snapshot" 一致。
- **D.4-D.5**：I01 对迟到能力、deny 和 H1 设计迁移的表述均基于 contract 描述而非 CC 快照，无矛盾。

### E. 异步事件、取消与资源（6/6 核验通过）

- **E.1**：`query.ts:219-239`：`yield* queryLoop()` → return terminal → notify completed；throw 前已 yield 的事件不回收 — 与 I01 一致。
- **E.2**：`print.ts:2147`：`for await (const message of ask({...}))` — 与 I01 一致。
- **E.3**：`stream.ts:1-60`：内部 `T[]` 无界队列，无背压、无广播 — 与 I01 一致。
- **E.4**：`abortController.ts` (signal)、`combinedAbortSignal.ts` (signal+timeout)、`Shell.ts:240-425` (kill child)、`gracefulShutdown.ts:391-523` (cleanup→forceExit) — 不同事实域明确分离。
- **E.5**：REPL 的 SIGINT 处理收敛 partial assistant (`REPL.tsx` 内 `abortController.abort('interrupt')` 模式) — 与 I01 一致。
- **E.6**：H0 contract `h0-contract.md:5,13` (cancel request ≠ cleanup) — 与 I01 一致。

### F. Session 与 Process lifecycle（6/6 核验通过）

- **F.1**：Esc turn cancel (abortController) ≠ `/clear` (`regenerateSessionId` at `bootstrap/state.ts:435-450`) ≠ `/exit` (ExitFlow → gracefulShutdown) ≠ SIGTERM → forceExit — 与 I01 一致。
- **F.2**：`gracefulShutdown.ts:237-334` `setupGracefulShutdown()` memoize 全局 handler；Headless (`print.ts:1027-1034`) 注册自己的 SIGINT handler，全局 handler 跳过 -p (`gracefulShutdown.ts:262`) — 与 I01 一致。
- **F.3**：`gracefulShutdownSync()` (`gracefulShutdown.ts:336-359`) 设置 exitCode 后发起异步 shutdown 即返回；`shutdownInProgress=true` (`gracefulShutdown.ts:401`) 阻止重复 — 与 I01 一致。
- **F.4**：主顺序 (`gracefulShutdown.ts:416-522`)：failsafe → terminal reset + resume hint → cleanup registry (2s timeout) → SessionEnd hooks → profile/cache → analytics (500ms) → forceExit — 与 I01 一致。
- **F.5**：`cleanupRegistry.ts:23-25`：`Set + Promise.all`，无 `allSettled`，2s `Promise.race` timeout 不取消 loser；Transcript 无"第一完成"保证 — 与 I01 一致。
- **F.6**：H1 `h1-contract.md:55-62` 声明 phased cleanup 是设计迁移 — 与 I01 一致。

### 图语义边界

I01 的 19 张图无法由当前工作区直接查看（在 `draft.md` 中，本阶段禁止读取），但 I01 在本提示词中的自述声明与源码核验结果一致：

- 入口图的两路分叉 (REPL → query(), Headless → ask() → query()) — **正确**。
- 配置图的 provider selection + source iteration + runtime — **正确**。
- owner 图的各 root/store/render snapshot/fresh read — **正确**（`RuntimeContext` 等是 clean-room 名称，不伪装源码符号）。
- capability 图的独立性 — **正确**。
- event 图的逐项消费/不回滚 — **正确**。
- cancel 图的 intent ≠ confirmation — **正确**。
- scope 图的层级分离 — **正确**。
- shutdown 图的顺序/并发语义/H1 phases — **正确**（源码的 `Set + Promise.all` 语义与 H1 的分阶段设计是分离表述）。
- H0/H1 图将 H0 放入 H1 壳内 — **正确**（contract 区分明确，不声称 H1 已有真实 provider 或完整 Tool Loop）。

### 实验与 Harness 边界

- M02: `eventStream.ts` 的 `yield*`、`try/finally/return`、`PushAsyncQueue` 无界队列 — 与 I01 的描述一致。
- M05: `runtimeSurface.ts` 的 `RuntimeCore` 接口共享、`SurfaceTrace` 观察边界 — 与 I01 一致。
- M08/M09: H1 contract (`h1-contract.md:42,53-62`) + `h2-contract.md:39-46` + `core-runtime.md:101-109` — 明确列出尚未实现的内容（SSE streaming、transcript 持久化、Sandbox、分布式执行）。I01 声明的 H1 能力边界"不包含跨多 prompt shared conversation owner、真实 LLM provider、完整 Tool Loop、Transcript/恢复/Sandbox/分布式治理" — **正确**：ConversationStore 在 H2 contract 中才引入；ModelAdapter/Tool Loop 在 H2 contract + core-runtime.md 中属于 S0/S1 纵切（非 H1 范围）。

---

## 总结

I01 的所有关键表述均能被当前源码快照、已发布 clean-room contract 和实验代码独立证实。FACT_A 在首要收敛路径上有重大错误（将两路径均归给 `QueryEngine.ask()`），但该错误属于 A 的摘要而非 I01 的内容——I01 自身在此问题上完全正确。无任何实质性矛盾需要 I01 修正。
