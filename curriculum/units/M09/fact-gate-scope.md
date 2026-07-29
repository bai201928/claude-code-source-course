# M09 事实闸门 A 范围

## 审查目标

独立重建 Claude Code CLI 主会话的生命周期：启动时如何安装退出设施，一轮请求取消、逻辑 SessionEnd、进程 graceful shutdown 与 hard termination 各自结束什么；正常退出、SIGINT、SIGTERM、SIGHUP、Headless、Interactive 与 background session 有哪些不同；清理、持久化、Hook、analytics 和 force exit 的实际顺序、预算与失败语义是什么。

本审查不提供 Codex 的机制结论。请从源码自行确认，不根据函数名或注释推断未实现的优先级、取消或持久化保证。

## 源码根目录

```text
D:\agent\Claude code最新\claude-code-CLI
```

## 优先阅读路径与符号

1. `src/utils/gracefulShutdown.ts`
   - `setupGracefulShutdown`
   - `gracefulShutdownSync`
   - `gracefulShutdown`
   - `cleanupTerminalModes`
   - `printResumeHint`
   - `forceExit`
2. `src/utils/cleanupRegistry.ts`
   - `registerCleanup`
   - `runCleanupFunctions`
3. `src/entrypoints/init.ts:init`
4. `src/interactiveHelpers.tsx:renderAndRun/exitWithMessage`
5. `src/commands/exit/exit.tsx:call`
6. `src/components/ExitFlow.tsx`
7. `src/screens/REPL.tsx`
   - `onCancel`
   - `handleExit`
   - Interactive resume path around `executeSessionEndHooks('resume')`
8. `src/cli/print.ts`
   - normal Headless completion
   - `runHeadlessStreaming` SIGINT handler and `finally`
9. `src/commands/clear/conversation.ts`
10. `src/utils/hooks.ts`
    - `getSessionEndHookTimeoutMs`
    - `executeSessionEndHooks`
11. `src/utils/sessionStorage.ts`
    - lazy cleanup registration
    - `Project.flush`
    - `isShuttingDown` related remote-persistence branch
12. 代表性 cleanup owner：
    - `src/tasks/LocalShellTask/LocalShellTask.tsx`
    - `src/tasks/LocalAgentTask/LocalAgentTask.tsx`
    - `src/services/mcp/client.ts`
    - `src/history.ts`
13. `src/utils/abortController.ts`、`src/utils/combinedAbortSignal.ts`、`src/query.ts` 的 interrupt handling。

必要时定向搜索 call sites，但不要扫描无关功能或展开完整 Task、MCP、Hook、Transcript 实现。

## 官方行为边界

可定向读取：

```text
D:\agent\Claude code最新\repos\official\anthropics\claude-code\CHANGELOG.md
```

只用于核对当前公开修复记录，例如 external SIGINT、SIGTERM process tree、SessionEnd timeout、SSH disconnect flush 和 unclean transcript recovery。公开新版行为不得改写源码快照内部事实。

## 必须回答的问题

1. `setupGracefulShutdown()` 在何时安装，global handlers 对 Interactive/Print/其他 non-interactive 是否相同？
2. Esc/Ctrl+C turn cancellation、`/clear`/`/resume` SessionEnd、`/exit` 与 signal-driven process shutdown 分别改变哪些状态？
3. `gracefulShutdownSync()` 是否等待清理完成，调用者依赖什么让异步关机继续？
4. `shutdownInProgress` 对重复调用、reason 和 exit code 有什么语义？
5. terminal reset、resume hint、cleanup registry、SessionEnd、profile/cache hint、analytics 和 force exit 的真实顺序是什么？
6. cleanup registry 是串行、并行、按优先级还是 insertion order invocation；某 handler reject/timeout 后其他 handler 会怎样？
7. 2 秒 cleanup、SessionEnd budget、500ms analytics 与 overall failsafe 的关系是什么？Promise race 是否取消 loser？
8. Transcript flush 如何注册和 drain；能否证明它严格先于所有其他 cleanup 完成？
9. SessionEnd 在 clear、resume、process exit 上如何传 reason、timeout 与 AppState access？
10. Headless SIGINT/SIGTERM、Interactive exit、background detach、direct process.exit 与 SIGKILL 有哪些 bypass 或非对称？
11. 哪些结论只能标为新版公开行为或推断？

## 审查约束

- 只读，不修改任何文件。
- 不读取 Graphify、M09 `unit-workbook.md`、实现、草稿或历史审查。
- 不把 Graphify 或文件邻近当证据。
- 不要求本单元展开完整 Runtime Task、MCP wire protocol、Hook matcher、Transcript 恢复或 Sandbox。
- 只报告会影响事实正确性、实验设计、初学者生命周期理解或 Harness 契约的问题。
