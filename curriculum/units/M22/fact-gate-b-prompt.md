# M22 FACT_B：同会话对照

继续 FACT_A 会话，只核对下面的 Codex 结论，不重新总结仓库。

## Codex 结论

- MCP connection 是 discriminated union；`Client.connect(transport)` 完成 SDK initialize，只有成功后才读取 server capabilities/version/instructions。客户端声明 roots 与 elicitation、注册 ListRoots；没有发现 sampling capability/createMessage handler。
- tools/resources/prompts list 各受 negotiated capability guard并各自 catch 为 `[]`，所以 connected 不等于每类目录成功。list_changed 分别清 cache、refetch、更新 server/AppState；不会改写已经构造并送出的模型 request。
- MCP tool 通常使用 server-qualified 名；远端 inputSchema 放 `inputJSONSchema` 给模型定义，base MCPTool 的本地 Zod `inputSchema` 是 passthrough。不能说本地通用 safeParse 已完整执行远端 JSON Schema；server 仍需 authoritative validation。
- readOnly/destructive/openWorld annotations 是远端 hint，参与分类但不替代 Permission。SDK no-prefix 仍用 mcpInfo 的 fully qualified name 做权限匹配。
- 连接 close 必须走 `client.close()` 才能让 SDK reject pending handlers；onclose 随后清 connection 与 list caches。后续 ensureConnected 重连。HTTP session expiry 会清 cache并最多 retry tool 一次。
- retry 不提供 exactly-once。工具调用携带 claudecode/toolUseId meta，但服务器是否 dedupe 不由客户端保证；副作用发生而响应丢失时可能重复。
- SDK call 收到 AbortSignal/timeout，另有 Promise.race timeout；本地停止等待不证明远端业务取消或回滚。AbortError 在低层可收敛为 undefined content，外层 Tool 编排仍负责取消与 paired result。
- 初始化窗口的 elicitation default handler fail-closed 返回 cancel；roots 会把 cwd file URI 暴露给已连接 server，属于显式数据边界。

## H4-3

Harness 使用 protocol-neutral session/transport port 和 fake transport验证生命周期；生产 wire adapter 明确 defer 并要求官方 MCP SDK。加入 generation、immutable capability snapshot、notification refresh、idempotency key、disconnect fail-closed 与 metadata-only trace。这是 clean-room 增强，不是快照事实。

只报告会改变上述事实、实验或 H4-3 的实质问题。必须以下列三行开头；接受时明确 PASS / 0。

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```
