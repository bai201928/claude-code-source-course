# I01 事实闸门 A：跨章运行壳独立核验

你正在执行一个全新的独立事实闸门 A。请只依据当前本地 Claude Code CLI 源码快照，重建 M01-M09 所覆盖机制在一次运行中的真实边界。不要接受函数名、文件邻近或作者叙述作为证据。

## 源码根目录

```text
D:\agent\Claude code最新\claude-code-CLI
```

该目录只读。禁止修改、格式化、生成缓存或写入任何文件。你只能使用 Read、Glob、Grep 做定向读取和搜索。

## 隔离要求

本阶段禁止读取或引用：

- `curriculum/interludes/I01-runtime-shell-review/draft.md`；
- I01 的任何其他 prompt、review 或 Codex 结论；
- M01-M09 的 `final.md`、`draft.md`、workbook、review、implementation report 或课程总结；
- `mini-agent-harness/` 中的设计、契约和实现；
- Graphify、`graphify-out/` 或任何图谱查询结果；
- 旧事实审查与教学审查。

Graphify 不进入本闸门。共享 import、contains、references 和静态可达都不能自动叫作运行调用。

## 需要独立闭合的问题

### 1. 入口与运行表面

1. 哪些 fast path 在完整 `main.tsx` 加载前返回，普通路径怎样进入 `main()`？
2. Interactive、Print/Headless、SDK-facing/stream-json 的选择条件、输入 owner、状态 owner、输出协议和退出边界分别是什么？
3. Interactive REPL 与 Headless/SDK 输入是否经过同一个 `QueryEngine` 入口；它们在何处共享 `query()` 或后续能力，又有哪些不对称？
4. `StructuredIO` 如何处理 chunk、换行 frame、JSON 校验、control request/reply 和有序 NDJSON 输出？

优先阅读：

- `src/entrypoints/cli.tsx`
- `src/main.tsx`
- `src/replLauncher.tsx`
- `src/interactiveHelpers.tsx`
- `src/cli/print.ts`
- `src/cli/structuredIO.ts`
- `src/bootstrap/state.ts`
- `src/screens/REPL.tsx`
- `src/QueryEngine.ts`
- `src/query.ts`

### 2. 配置、信任与 revision 边界

1. user/project/local/flag/policy/plugin 输入如何解析、选择、过滤和合并；数组、对象和标量的语义是什么？
2. 多个企业 policy 后端是全部合并还是择一；managed base/drop-ins 的内部顺序是什么？
3. `--setting-sources` 是固定优先级过滤还是可能改变实际迭代顺序？
4. effective settings、permission runtime chooser、pre-trust safe env 和 trusted/full env 各是什么边界？
5. 当前快照实际提供哪些配置缓存、更新通知、快照或 revision 语义；哪些“revision/provenance”只能由 clean-room 设计补充，不能冒充真实类或字段？

优先阅读：

- `src/utils/settings/constants.ts`
- `src/utils/settings/settings.ts`
- `src/utils/settings/settingsCache.ts`
- `src/utils/settings/applySettingsChange.ts`
- `src/utils/settings/changeDetector.ts`
- `src/utils/managedEnv.ts`
- `src/utils/managedEnvConstants.ts`
- `src/components/TrustDialog/TrustDialog.tsx`
- `src/components/TrustDialog/utils.ts`
- `src/services/remoteManagedSettings/index.ts`
- `src/utils/permissions/permissionSetup.ts`
- `src/main.tsx`

### 3. Runtime、Session、Request 与状态 owner

1. Bootstrap module state、`AppState` 数据形状、`createStore()` 闭包、React Provider、Interactive root、Headless store 分别由谁创建和拥有？
2. 一个进程能否存在多个 store；它们是否自动同步？
3. `createStore()` 如何按 root identity 提交、调用 observer、通知 subscribers；同引用原地修改和新引用无内容变化分别产生什么语义？
4. render selector、closure、`getState()` fresh read、阶段保存的 `initialAppState` 或 messages 数组副本分别能证明什么，不能证明什么？
5. 请求边界上的 stable view 与显式 fresh read 在源码中出现在哪里；哪些 `RuntimeContext`、`SessionStateStore`、`RequestContext` 名称只可能是设计迁移？

优先阅读：

- `src/bootstrap/state.ts`
- `src/state/store.ts`
- `src/state/AppState.tsx`
- `src/state/AppStateStore.ts`
- `src/state/onChangeAppState.ts`
- `src/components/App.tsx`
- `src/screens/REPL.tsx`
- `src/cli/print.ts`
- `src/QueryEngine.ts`

### 4. Capability snapshot 与执行边界

1. base tools、模式、deny rule、`isEnabled()`、MCP tools 和同名冲突如何形成 runtime pool？
2. runtime pool、模型实际收到的 schema、Tool Search/deferred visibility、permission 与本地 handler registry 是否为同一清单？
3. Interactive 的迟到 MCP tool 在什么安全边界刷新；Headless 是按 command、`ask()` 还是内部模型迭代刷新？
4. 一个旧 request/tool view 是否会被迟到能力原地改写；执行意图出现后还需要哪些本地校验？
5. 哪些能力不对称或 fail-closed 场景会影响 clean-room Harness 契约？

优先阅读：

- `src/tools.ts`
- `src/services/mcp/useManageMCPConnections.ts`
- `src/screens/REPL.tsx`
- `src/query.ts`
- `src/cli/print.ts`
- `src/QueryEngine.ts`
- `src/services/api/claude.ts`
- `src/utils/api.ts`
- `src/utils/toolSearch.ts`
- `src/utils/toolSchemaCache.ts`

### 5. AsyncIterable、取消与资源确认

1. `query()`、`queryLoop()`、`yield*` 和 `QueryEngine.submitMessage()` 的 producer/consumer 边界、正常 return、throw 和部分提交语义是什么？
2. `src/utils/stream.ts:Stream<T>` 是否提供有界缓冲、广播或端到端背压？
3. consumer close、`AbortSignal`、timeout、child kill、background handoff 和 OS-level exit confirmation 是什么不同事件？
4. Shell 路径中谁拥有 child、timer、abort listener、结果收敛、输出与 background 转移？
5. 哪些结论受 Windows/POSIX/Bun 或输出模式限制？

优先阅读：

- `src/query.ts`
- `src/QueryEngine.ts`
- `src/utils/stream.ts`
- `src/utils/abortController.ts`
- `src/utils/combinedAbortSignal.ts`
- `src/utils/Shell.ts`
- `src/utils/ShellCommand.ts`
- `src/tools/BashTool/BashTool.tsx`

### 6. Turn、Session 与 Process shutdown

1. Esc/Ctrl+C turn cancel、`/clear`、`/resume`、`/exit`、SIGINT/SIGTERM/SIGHUP 和 hard termination 分别结束什么 owner？
2. partial assistant、SessionEnd/SessionStart、transcript flush 与后续 prompt 的关系是什么？
3. `setupGracefulShutdown()` 何时安装；Interactive 与 Headless handler 有何非对称？
4. `gracefulShutdownSync()` 是否同步等待；首个 shutdown caller、reason 和 exit code如何处理？
5. terminal reset、resume hint、cleanup registry、SessionEnd hooks、profile/cache、analytics 与 force exit 的真实顺序和预算是什么？
6. cleanup registry 的 `Set + Promise.all`、reject、`Promise.race` timeout 和 loser 是否会自动取消？Transcript 是否被保证第一完成？
7. hard termination 时哪些 JavaScript cleanup 没有保证，恢复只能依赖什么已持久化事实？

优先阅读：

- `src/screens/REPL.tsx`
- `src/commands/clear/conversation.ts`
- `src/commands/exit/exit.tsx`
- `src/components/ExitFlow.tsx`
- `src/cli/print.ts`
- `src/entrypoints/init.ts`
- `src/interactiveHelpers.tsx`
- `src/utils/gracefulShutdown.ts`
- `src/utils/cleanupRegistry.ts`
- `src/utils/hooks.ts`
- `src/utils/sessionStorage.ts`

## 证据与输出边界

- 以当前源码快照及其直接相关测试、类型、fixture 和 mock 为最高证据。
- 不用当前产品文档改写快照内部事实。
- 不要求穷举所有命令、平台或错误分支；只闭合会影响上述跨章主链的决定性语义。
- 如果源码无法确认，明确写 `无法由当前快照确认`，不要用合理设计代替事实。
- 只报告会影响 I01 事实正确性、代表性实验、H0/H1 契约边界或后续 Harness 演进的问题。普通重构建议、措辞偏好和无现实影响的边缘问题不形成 Issue。

输出必须从以下三行开始：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，使用稳定编号 `I01-FA-01`、`I01-FA-02`，并给出：源码路径与符号、独立核验结果、影响、B 阶段必须对照的具体问题。不要总结整个仓库。若没有实质问题，用一段精简的“已闭合边界”说明你实际核验了哪些机制，供同会话 FACT_B 使用。
