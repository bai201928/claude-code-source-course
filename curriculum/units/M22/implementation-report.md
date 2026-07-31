# M22 实现与实验报告

状态：release-candidate

## 闸门

```text
FACT_A: BLOCK / 6（主要是提示要求反证的错误命题）
FACT_B: PASS / 0
TEACHING: PASS / 0
```

FACT_B 接受 connection/list 分层、no-sampling、remote JSON Schema/local passthrough、annotation hint/Permission、client.close pending rejection、cache/reconnect、non-exactly-once retry、abort 非远端回滚和 elicitation/roots 边界。

## Harness H4-3

Decision：merge + defer + reject。

Merge：双语言 protocol-neutral McpTransport port、McpSession generation/revision、handshake/capability negotiation、server-qualified immutable snapshot、tools-changed refresh、refresh fail-closed、disconnect gate、默认 no-retry indeterminate outcome、policy-approved recovery with stable idempotency key、schema-stability check 与 metadata-only trace。

Defer：官方 SDK 的真实 stdio/HTTP adapter、OAuth、elicitation UI、Resource/Prompt adapter、sampling、subscription、distributed generation rollout。生产 adapter 必须使用官方 MCP SDK，不手写 JSON-RPC。

Reject：connected 即目录成功、remote annotation 即可信安全事实、本地 passthrough 即完整远端 schema validation、blind retry、Promise race 即远端 rollback、普通 trace 记录 args/result/token。

## 聚焦验证

```text
TypeScript McpSession: 9/9
Python McpSession: 9/9
TypeScript strict typecheck: PASS
Mermaid: 17/17
```

累计回归在 S4 原子发布前统一执行。M22 只进入 release-candidate，不单独生成 final。
