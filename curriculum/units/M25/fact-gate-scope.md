# M25 事实闸门范围

源码根目录：`D:\agent\Claude code最新\claude-code-CLI`

只读审查，不得修改源码、教材或 Harness。

独立确认以下问题：

1. Permission 与 Sandbox 分别决定什么，真实 shell command 在哪里被包装和执行？
2. Sandbox 启用需要哪些条件；显式启用但不可用时，REPL/print 与 PowerShell 的行为是什么？
3. settings/permission 如何投影到 network/filesystem runtime config，配置更新如何传播？
4. filesystem permission 如何处理 original/resolved path、symlink、dangling path、UNC 与 stale write；它能否证明彻底消除 TOCTOU？
5. 普通 settings precedence、managed source selection、remote cache/poll/failure/security dialog 的真实语义。
6. trust 前后的 env、subprocess env scrub、Plugin sensitive option storage 与 model-visible substitution 的秘密边界。
7. Marketplace/Plugin/MCP 的 allow/deny/block/delisted/strict controls，以及快照是否证明 publisher signature verification。

建议优先阅读：

- `src/utils/sandbox/sandbox-adapter.ts`
- `src/tools/BashTool/shouldUseSandbox.ts`
- `src/tools/BashTool/bashPermissions.ts`
- `src/tools/PowerShellTool/PowerShellTool.tsx`
- `src/utils/Shell.ts`
- `src/cli/print.ts`
- `src/screens/REPL.tsx`
- `src/utils/permissions/filesystem.ts`
- `src/tools/FileWriteTool/FileWriteTool.ts`
- `src/tools/FileEditTool/FileEditTool.ts`
- `src/utils/settings/constants.ts`
- `src/utils/settings/settings.ts`
- `src/utils/managedEnv.ts`
- `src/services/remoteManagedSettings/`
- `src/utils/plugins/marketplaceHelpers.ts`
- `src/utils/plugins/marketplaceManager.ts`
- `src/utils/plugins/pluginPolicy.ts`
- `src/utils/plugins/pluginBlocklist.ts`
- `src/utils/plugins/pluginOptionsStorage.ts`
- `src/utils/settings/pluginOnlyPolicy.ts`
- `src/services/mcp/config.ts`

只报告会改变教材核心事实、安全边界、实验或 H7-1 契约的实质问题。源码适配层与外部 runtime、快照事实与迁移设计必须分开。
