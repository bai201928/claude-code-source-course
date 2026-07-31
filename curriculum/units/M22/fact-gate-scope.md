# M22 事实闸门范围

独立核验当前 Claude Code CLI 快照的 MCP client 生命周期。源码根：`D:\agent\Claude code最新\claude-code-CLI`。

必须回答：

1. transport 建立、SDK initialize、client/server capability negotiation 和 connection union 的实际边界；
2. client 是否声明 roots、elicitation、sampling，half-initialized request 如何处理；
3. tools/resources/prompts 怎样 list、缓存、命名与投影，单类 list 失败是否使 connection 失败；
4. MCP tool 的 `inputJSONSchema` 与本地 `inputSchema.safeParse` 是否为同一层，annotations/Permission 的信任边界；
5. list_changed 如何失效缓存并更新活动状态，是否追溯修改已经构造的模型 request；
6. onerror/onclose、pending request rejection、cache clearing、ensureConnected、HTTP session expiry 与一次 retry 的顺序；
7. AbortSignal、SDK timeout、额外 Promise.race timeout 能否证明远端副作用取消；
8. roots、elicitation、auth、远端内容与 trace 的安全边界。

优先入口：

- `src/services/mcp/types.ts`
- `src/services/mcp/client.ts`
- `src/services/mcp/useManageMCPConnections.ts`
- `src/services/mcp/elicitationHandler.ts`
- `src/tools/MCPTool/MCPTool.ts`
- `src/services/tools/toolExecution.ts`
- `src/services/mcp/mcpStringUtils.ts`
- List/Read MCP resource tools

可定向读取测试和当前快照引用的官方 SDK 类型。不要读取 Graphify、M22 工作簿、Codex 结论、Harness、草稿、其他单元或历史聊天；只读，不修改文件。

只报告会改变协议握手、能力可见、输入信任、通知刷新、取消/重试副作用、断线恢复或 H4-3 契约的问题。UI 文案、完整 transport 枚举和边缘认证选项不算 Issue。
