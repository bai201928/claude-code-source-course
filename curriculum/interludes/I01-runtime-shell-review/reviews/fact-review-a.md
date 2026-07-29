I now have sufficient evidence to compile the complete analysis. Here is the independent fact-gate review:

---

```text
GATE: FACT_A
VERDICT: PASS
MATERIAL_ISSUES: 0
```

---

## 已闭合边界

以下是对六组问题的独立源码核验结论，供同会话 FACT_B 直接引用：

### 1. 入口与运行表面

- **Fast paths 在 `main.tsx` 加载前返回**：`cli.tsx:37` `--version` 零 import 返回；其他 fast paths（`--dump-system-prompt`、`--claude-in-chrome-mcp`、`--daemon-worker`、`remote-control`、`daemon`、`ps|logs|attach|kill`/`--bg`、`new|list|reply`、`environment-runner`、`self-hosted-runner`、`--worktree --tmux`）均做动态 import 后返回。普通路径在 `cli.tsx:293-297` 动态 import `main.js` 并调用 `cliMain()`。

- **三种模式的入口区分**：`main.tsx:799-803` 通过 `--print`/`--init-only`/`--sdk-url`/`!process.stdout.isTTY` 计算 `isNonInteractive`。Interactive 路径最终调用 `launchRepl()` (`main.tsx:3134+`)，通过 Ink React 树渲染 `<App><REPL /></App>`。Print/Headless/SDK 路径 (`main.tsx:2620-2860`) 创建 `headlessStore = createStore(headlessInitialState, onChangeAppState)`，动态 import `src/cli/print.js`，调用 `runHeadless()`。

- **是否经过同一 `QueryEngine` 入口**：是。两者均进入 `QueryEngine.ask()`（`QueryEngine.ts:1186`）。Interactive 通过 REPL → `useQueueProcessor` → `ask()`；Headless 通过 `print.ts:2147` 的 `ask()` 调用。不对称：Headless 自己创建 `abortController`、自己管理 `mutableMessages` 数组、自己持有 `canUseTool` 闭包；Interactive 中这些由 React hooks/context 管理。

- **StructuredIO** (`structuredIO.ts:135`)：`outbound` 是 `Stream<StdoutMessage>`（无界内存队列）。输入来自 `AsyncIterable<string>`，chunk 解析在私有 `read()` 方法中进行。NDJSON 输出通过 `write()` 写行、`ndjsonSafeStringify` 做 JSON 安全序列化。Control request/reply 通过 `pendingRequests` Map 和 `sendRequest()`/`handleControlResponse()` 异步配对。

### 2. 配置、信任与 revision 边界

- **Settings 合并语义** (`settings.ts:538-547` + `645-748`)：`settingsMergeCustomizer` — 数组 concat+dedup (`uniq([...target, ...source])`)，对象 deep merge，标量后覆盖。来源优先级：plugin settings (base) < user < project < local < flag < policy（`SETTING_SOURCES` 常量 `constants.ts:7-22`）。

- **Policy 多源** (`settings.ts:323-344`, `673-739`)：policy 是 **first-source-wins**（择一，非全合并）。优先级：remote > HKLM/plist > managed-settings.json > HKCU。managed-settings.json 内部的 drop-ins 是 merge-all（`loadManagedFileSettings()`, `settings.ts:74-121`）。

- **`--setting-sources`** (`constants.ts:128-153`)：只过滤 user/project/local（`parseSettingSourcesFlag` 只接受这三种名字）。`getEnabledSettingSources()` (`constants.ts:159-167`) 总是强制添加 policy 和 flag。该 flag 改变的是**加载迭代顺序中的参与源**，不是优先级顺序。

- **Effective settings**：`getInitialSettings()` (`settings.ts:812-814`) 返回 `getSettingsWithErrors().settings`，后者是 session-cached 的 `loadSettingsFromDisk()` 结果。缓存被 `resetSettingsCache()` 使失效（写操作、--add-dir、plugin init 时触发）。

- **Trust 边界**：`showSetupScreens()` (`interactiveHelpers.tsx:104`) 中 TrustDialog 是 workspace trust 边界；`bypassPermissions` 模式只影响工具执行权限 (`interactiveHelpers.tsx:126-129`)。设置 `skipDangerousModePermissionPrompt` 明确排除了 projectSettings 源（防止恶意 clone 绕过对话框）。`managedEnv.ts`/`managedEnvConstants.ts` 控制从 CLAUDE.md 应用环境变量。

- **Cache/Revision 语义**：存在 `sessionSettingsCache` (内存)、`perSourceCache` (Map)、`parseFileCache` (Map)。`settingsChangeDetector` 基于 chokidar 文件监听 + MDM 轮询。**不存在任何"revision"/"provenance"类或字段**，这些若出现在设计文档中不能冒充真实实现。

### 3. Runtime、Session、Request 与状态 owner

- **Bootstrap state** (`bootstrap/state.ts:429`)：`STATE` 是模块级 const 单例（Plain Object 可变，非 store/observable）。所有导出函数是直读直写的 getter/setter。

- **AppState** (`AppStateStore.ts:89+`)：`DeepImmutable` 类型的大型状态对象，包含 settings、model、tool permission context、mcp、agents、notifications 等。`getDefaultAppState()` (`AppStateStore.ts:456`) 返回默认值。

- **createStore()** (`store.ts:10-34`)：闭包型 store。`setState(updater)` 调用 `Object.is(next, prev)` — 相同引用跳过通知；相同内容不同引用会触发 onChange 和 subscriber 通知。

- **Interactive store 创建**：`AppStateProvider` (`AppState.tsx:37-109`) 在 mount 时通过 `useState(() => createStore(initialState, onChangeAppState))` 惰性创建，通过 React Context 提供给子树。**同一树中禁止嵌套 AppStateProvider**（`AppState.tsx:46-47` 抛错）。

- **Headless store 创建**：`main.tsx:2653`，直接调用 `createStore(headlessInitialState, onChangeAppState)`。

- **多 store**：一个进程可以有多个 store（Headless store + bootstrap STATE + 子 agent store），但**没有自动同步机制**。

- **名称核验**：搜索全 `src/` 目录，**无 `RuntimeContext`、`SessionStateStore`、`RequestContext` 类型存在**。这些名称若出现在课程设计中是设计迁移/clean-room 设计概念，不能冒充真实源码符号。

### 4. Capability snapshot 与执行边界

- **Base tools** (`tools.ts:193-251`)：`getAllBaseTools()` 返回所有候选工具（包含 feature-gated 和 env-gated）。`getTools()` (`tools.ts:271+`) 根据 SIMPLE 模式、REPL 模式、coordinator 模式做过滤。`filterToolsByDenyRules()` (`tools.ts:262-269`) 根据 permissionContext 移除被 blanket-deny 的工具。

- **Runtime pool 形成** (`main.tsx` 和 `print.ts`)：base tools (`getTools()`) + MCP tools (`AppState.mcp.tools`) + SDK MCP tools (`sdkTools`) + dynamic MCP tools。同名冲突由 `uniqBy(mergeAndFilterTools(...), 'name')` (`print.ts:1479-1486`) 解决 — mergeAndFilterTools 内处理优先级。

- **模型实际收到的 schema** ≠ **runtime pool** ≠ **Tool Search deferred** ≠ **permission registry**。`claude.ts` 在 API 调用前做自己的 tool schema 组装（可能延迟部分工具）。Tool Search (`isToolSearchEnabledOptimistic()`) 把 `ToolSearchTool` 加入 pool 但不保证模型实际收到的 schema 中有所有工具。

- **迟到 MCP tool**：Interactive 中，`useManageMCPConnections` hook (`useManageMCPConnections.ts:143`) 通过 React 状态更新推送新的 MCP client。新工具通过 `AppState.mcp.tools` 更新出现在下一次 `getAppState()` fresh read。Headless 中，`connectMcpBatch()` (`main.tsx:2691-2719`) 推送 pending → connected state 到 headlessStore，每次 `ask()` 调用通过 `getAppState()` fresh read 获知新工具。`updateSdkMcp()` (`print.ts:1389-1459`) 检测 SDK MCP config 变化并推送。

- **旧 request/tool view 不会被原地改写**：每个 `ask()` 调用 (`QueryEngine.ts:1249`) 创建新的 `QueryEngine` 实例，构造函数中捕获 `tools` 数组引用。`submitMessage()` 内部的 query loop 使用此次捕获的工具集。

### 5. AsyncIterable、取消与资源确认

- **`query()` → `queryLoop()`** (`query.ts:219-239`)：`yield* queryLoop()` — 若 queryLoop 正常 return，通知 `completed`；若 throw，错误传播（不通知 completed）。

- **`ask()` → `engine.submitMessage()`** (`QueryEngine.ts:1249-1295`)：`yield* engine.submitMessage()`，finally 中 `setReadFileCache(engine.getReadFileState())`。异常不会阻止 readFileState 同步。

- **`Stream<T>`** (`stream.ts:1-60`)：内部是 `T[]` 无界队列，单订阅者，`enqueue` → push 或 resolve pending reader。**无背压、无广播、无有界缓冲**。生产者可无界内存增长。

- **`AbortController`** (`abortController.ts:16-22`)：原生包装，带 maxListeners。`createCombinedAbortSignal()` (`combinedAbortSignal.ts:15-40`) 合并 signal + 可选 signalB + 可选 timeout 为单一 abort controller。

- **Shell 路径** (`Shell.ts:183-425`)：`execute()` 接受 `abortSignal`，通过 `spawn()` 创建 child process，使用 `childProcess.kill()`+"force kill after grace"。`backgroundTaskId` 标记后台任务（`Shell.ts:395` 跳过 setCwd）。谁拥有 child：`execute()` 创建并持有 child 引用直到 resolve/reject。

- **Windows/POSIX 限制**：`Shell.ts` 使用 `spawn(spawnBinary, shellArgs, ...)`，shell detection 通过 `which('zsh')`/`which('bash')`。PowerShell 工具另在 `PowerShellTool` 中。孤儿检测（`gracefulShutdown.ts:282-296`）在非 Windows 平台启用 TTY 可写性轮询。

### 6. Turn、Session 与 Process shutdown

- **`setupGracefulShutdown()`** (`gracefulShutdown.ts:237-334`)：`memoize()` 单次调用。注册 `SIGINT`（跳过 -p 模式）、`SIGTERM`、`SIGHUP`（非 Windows）、孤儿检测。**`gracefulShutdown()` 首次调用设置 `shutdownInProgress = true`**，后续调用直接 return（首个 caller 的 exit code 被采用）。

- **`gracefulShutdownSync()`** (`gracefulShutdown.ts:336-359`)：设置 `process.exitCode`，发起异步 `gracefulShutdown()`，异步 .catch handler 做终端清理 + forceExit。

- **`gracefulShutdown()` 的真实顺序** (`gracefulShutdown.ts:391-523`)：
  1. **failsafe timer**：`Math.max(5000, sessionEndTimeoutMs + 3500)` ms → forceExit
  2. **cleanupTerminalModes()**：鼠标跟踪、alt-screen、键盘模式、光标显示（同步 writeSync）
  3. **printResumeHint()**：仅 TTY + interactive + 持久化启用
  4. **runCleanupFunctions()**：`Promise.all` + `Promise.race(2s timeout)`。若单个 reject，Promise.all 整体 reject（但不强制取消其他；不阻止它们完成）
  5. **SessionEnd hooks**：`AbortSignal.timeout(sessionEndTimeoutMs)`
  6. **profileReport()**
  7. **cache_eviction_hint** (analytics)
  8. **analytics flush**：`Promise.race(500ms)`
  9. **forceExit()** → `process.exit(exitCode)` → fallback `SIGKILL`

- **Transcript 保证**：`runCleanupFunctions()` 中的 session persistence 由 `registerCleanup` 注册，通过 `Promise.all` 执行。2s timeout 可能在慢磁盘上截断写入，但**不是"保证第一完成"语义** — 所有 cleanup 函数同时启动（`Promise.all`），最快完成和最后完成之间无优先级。

- **硬终止风险**：`SIGKILL`、OS 级杀死不执行任何 JavaScript cleanup。**只有已持久化到磁盘的事实（session JSONL、settings files）可恢复**。

- **`/clear`**：`clearContext()` 在 REPL 中处理，调用 `regenerateSessionId({ setCurrentAsParent: true })` 且重置消息、清 beta header latches。不影响进程级 handler。

- **`/exit`**：经过 `ExitFlow.tsx` → `gracefulShutdown()` → 上述序列。
