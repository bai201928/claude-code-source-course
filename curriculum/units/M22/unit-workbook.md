# M22 作者工作簿：MCP 协议、连接生命周期与安全边界

状态：release-candidate

风险：R2。跨进程连接、远端 schema、断线重连、取消与重试会改变副作用和能力可见性。

## 本单元问题

一个 MCP server 怎样从 transport 连接和 initialize，变成模型可见的 Tool/Resource/Prompt；通知、断线、取消、认证和 session recovery 又怎样改变下一次请求？

## Graphify 候选与源码核验

Graphify 指向 `src/services/mcp/client.ts`、`types.ts`、`useManageMCPConnections.ts`、MCPTool、List/Read resource tools、auth 与 elicitation handler。以下结论全部回到源码核验，Graphify 不作证据。

## 已确认机制

- connection 是 `connected | failed | needs-auth | pending | disabled` discriminated union；只有 connected 持有 SDK Client、server capabilities/info/instructions 与 cleanup。
- transport 覆盖 stdio、SSE、Streamable HTTP、WebSocket、SDK/in-process 等适配。`Client.connect(transport)` 负责协议 initialize；连接有独立 timeout，失败会关闭 transport/in-process server。
- 客户端创建时声明 roots 与 elicitation；注册 ListRoots handler，返回原始 cwd 的 file URI。未发现客户端 sampling capability 或 createMessage request handler，不能写成支持 sampling。
- connect 成功后才读取 negotiated server capabilities/version/instructions。tools/resources/prompts 的 list 请求分别受 capability guard；请求异常被各 fetcher 捕获并降级为 `[]`，所以 connected 不保证每类目录成功。
- tools/list 输出先做 Unicode sanitize，工具通常命名为 `mcp__<normalized-server>__<normalized-tool>`；SDK 特殊 no-prefix 模式仍保留 `mcpInfo` 供权限用 fully qualified name。
- MCP base Tool 的运行时 Zod inputSchema 是 passthrough object；远端 `tool.inputSchema` 放到 `inputJSONSchema` 供模型/请求定义使用。当前本地通用 `safeParse` 不等于对远端 JSON Schema 的完整 authoritative validation；server 仍须验证。
- annotations 的 readOnly/destructive/openWorld 是远端提示，进入本地并发/权限分类，不能当可信证明。MCP Tool 仍进入 M20 Permission chain。
- `tools/prompts/resources list_changed` 处理器按相应 cache invalidation 后重新 fetch，并更新 server/AppState；已经构造的模型请求不会被通知原地改变，后续能力装配才看到更新。
- onclose 清 connection 与各 list cache；部分 terminal error 累积或 session expiry 会主动 `client.close()`，以真正 reject pending requests，再让后续 `ensureConnectedClient()` 重连。只调用 onclose callback 不足以结束 pending request。
- HTTP session expiry 清 cache，tool wrapper 最多重试一次。若远端副作用已发生但响应丢失，客户端无法单靠 transport 判断，企业 adapter 需要 idempotency key/dedupe ledger；`claudecode/toolUseId` meta 可供 server 利用，但不是通用 exactly-once 保证。
- callTool 同时传 SDK signal/timeout，并有额外 Promise.race timeout。Promise timeout 或 abort 表示本地不再等待，不自动证明远端业务副作用取消；AbortError 路径在 `callMCPTool` 收窄为 undefined content，外层仍负责配对和 run cancellation。
- 初始化窗口的 elicitation default handler 返回 cancel，完整 UI/SDK handler稍后覆盖；这避免半初始化时无 owner 的交互请求悬挂。

## H4-3 迁移

Merge：protocol-neutral `McpTransport` adapter port、revisioned `McpSession` state machine、capability negotiation、server-qualified catalog、list revision、notification refresh、per-call idempotency key、abort/timeout outcome、disconnect fail-closed、reconnect generation、metadata-only trace，与 H4-2 ExtensionRegistry 对接。

Defer：自行实现 JSON-RPC/stdio/HTTP wire；生产 adapter 必须使用官方 MCP SDK。另 defer OAuth、elicitation UI、resources subscription、sampling client、真实网络 retry/backoff。

Reject：connected 即所有 list 成功、annotations 即可信策略、Promise.race timeout 即远端副作用回滚、断线盲重试非幂等 tool、stale tools 继续进入新请求、在普通 trace 记录 remote result/headers/token。
