# M20 事实闸门范围

## 审查目标

独立核验当前 Claude Code CLI 源码中一次 `tool_use` 从 Tool ABI、输入验证、PreToolUse、Permission 到 handler、PostToolUse/PostToolUseFailure 和 paired `tool_result` 的真实运行链。

必须回答：

1. schema、`validateInput`、PreToolUse、rule/mode/classifier/user decision 与 `tool.call` 的实际顺序；
2. 多个 PreToolUse Hook 的 allow/ask/deny/updatedInput 如何聚合，Hook allow 是否能越过 deny/ask/safety rule；
3. Hook、用户或 PermissionRequest Hook 改写 input 后，哪些路径重新执行 schema 或业务 `validateInput`，哪些没有；
4. interactive、headless/async agent 的 permission 路径和 fail-open/fail-closed 边界；
5. abort、Hook timeout/throw/cancel 在决策前后怎样传播，final allow 到 handler 副作用之间是否有执行器级最后取消检查；
6. 成功、拒绝、验证失败、Hook stop、handler throw/abort 是否都产生与原 `tool_use_id` 配对的结果；
7. PostToolUse/PostToolUseFailure 能改变什么，能否撤销已发生副作用；
8. decision provenance 的来源、记录和清理；
9. Permission 与 Sandbox 在当前调用链中的准确分界。

## 源码根目录

`D:\agent\Claude code最新\claude-code-CLI`

## 优先入口

- `src/Tool.ts`：`Tool`、`ToolUseContext`
- `src/services/tools/toolExecution.ts`：`checkPermissionsAndCallTool`
- `src/services/tools/toolHooks.ts`：`runPreToolUseHooks`、`resolveHookPermissionDecision`、`runPostToolUseHooks`、`runPostToolUseFailureHooks`
- `src/utils/hooks.ts`：Hook output 解析、`executeHooks`、`executePreToolHooks`、`executePermissionRequestHooks`
- `src/utils/permissions/permissions.ts`：`hasPermissionsToUseTool`、`hasPermissionsToUseToolInner`、`checkRuleBasedPermissions`、headless PermissionRequest Hook
- `src/types/permissions.ts`
- `src/hooks/useCanUseTool.tsx`
- `src/hooks/toolPermission/PermissionContext.ts`
- `src/hooks/toolPermission/handlers/interactiveHandler.ts`
- `src/tools/BashTool/shouldUseSandbox.ts`
- `src/tools/BashTool/BashTool.tsx`

可定向读取相关测试、fixture 和类型。不要扫描 Graphify 输出，不要读取 M20 工作簿、Harness、教材草稿、其他单元审查或历史聊天。

## 证据边界

- 只把当前本地快照实现和测试当作内部事实。
- 注释与实现冲突时以可达实现为准，并报告冲突。
- feature-gated classifier、auto/bubble 等内部路径必须注明 gate，不能冒充所有用户路径。
- 不要求审计每个工具的业务权限规则，只选能改变总编排语义的代表分支。
- 不把 clean-room Harness 的更强保证投射回 Claude Code。

## 修改限制

只读审查。不得修改源码快照、教材、Harness 或项目配置。
