# M16 事实闸门与 Codex 裁决

事实会话：`f7a1eede-d438-4101-8ad4-da52498ffe35`

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 4
```

### A1 缺失 feature-gated 模块

Decision: `accepted`

Reason: 快照确实缺少 `snipCompact.ts`、`snipProjection.ts`、`cachedMicrocompact.ts` 和 context-collapse 内部文件。

Change: 教材只讲现存调用接口、上下游顺序和可观察边界，不补造算法、gate 默认值或可运行性。

### A2 cached-MC output-style gate 不一致

Decision: `accepted`

Reason: `microCompact.ts` 用 `startsWith('repl_main_thread')`，`claude.ts` 的 `useCachedMC` 严格等于 `repl_main_thread`；pending edit 又在 strict gate 之前按 `cachedMCEnabled` 被消费。

Change: 记录为当前快照缺口。教材说明 output-style variant 可能消费但不发送 edit；Harness 用单一 gate decision，不复制该缺口。

### A3 字符、估算 token 与 API usage 不可互换

Decision: `accepted`

Reason: per-tool 与 aggregate 使用 JavaScript string/content char length；`roughTokenCountEstimation()` 是 `length / ratio`；`tokenCountWithEstimation()` 是最后一次 API usage 加后续消息估算。

Change: 正文与实验分开字符、token、message group 和 wire 四种单位，不把常量名中的 bytes 当作真实 UTF-8 测量。

### A4 replacement state 的 fork/resume/swarm 路径不同

Decision: `accepted`

Reason: cache-sharing fork clone 父 state；AgentTool resume 从 sidechain records 重建并用父 replacements 补洞；swarm teammate fresh start。

Change: 教材不再使用笼统“所有子 Agent 继承 replacement state”，而按 thread 类型解释缓存属性。

## FACT_B

```text
GATE: FACT_B
VERDICT: REVISE
MATERIAL_ISSUES: 2
```

### B1 Infinity/self-bounded 工具绕过两层 replacement

Decision: `accepted`

Reason: `getPersistenceThreshold()` 对非有限上限直接返回；aggregate budget 的 `skipToolNames` 把对应 ID 标为 seen/frozen，但排除在 eligible size 和 replacement selection 外。

Change: 教材明确 wrapper budget 不是硬性全请求上限；实验加入 excluded result 造成 group 保持 over-budget 的报告。

### B2 `prependUserContext()` 的结构位置

Decision: `accepted in part / rebutted in part`

Reason: 接受其为 `deps.callModel()` 参数表达式内的临时 prepend，不写回 `messagesForQuery` 或 next state。反驳“未设置 isMeta”：`src/utils/api.ts -> prependUserContext()` 明确传入 `isMeta: true`。normalize 仍可能把相邻 user messages 合并。

Change: 工作簿按 call boundary 重画，并保留 `isMeta: true` 的源码事实。

## FACT_B 定向复审

```text
GATE: FACT_B_RECHECK
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同会话确认 Infinity 退出、request-only prepend、`isMeta: true`、cached-MC gate、state provision 路径和 clean-room revision ledger 均已准确限定。

## 最终事实边界

- `快照事实`：history view、两层结果缩减、group 分界、state provision、attachment 时点、mixed token estimate 和 wire cache edit；
- `快照缺口`：缺失 gated module 的内部算法，以及 output-style cached-MC gate 不一致；
- `运行验证`：后续 TypeScript/Python 实验只验证课程行为契约；
- `设计迁移`：aggregate ledger revision、content-free metadata、single gate decision 和 strict post-projection validation。
