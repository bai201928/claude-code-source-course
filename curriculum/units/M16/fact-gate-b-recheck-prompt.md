# M16 事实闸门 B：定向复审

继续当前 M16 FACT_A/FACT_B 会话，只复审以下修订，不扩散仓库：

1. aggregate budget 明确排除 `maxResultSizeChars` 非有限的工具。它们在 per-tool persistence 和 aggregate replacement 两层都不替换，在 aggregate 层被 seen/frozen，且可能让最终 group 继续超过 wrapper limit；教材不再声称 budget 覆盖全部结果。
2. `prependUserContext()` 被重新定位为 `deps.callModel()` 参数边界内的临时包装：在数组索引 0 创建 request-only user message，不写回 `messagesForQuery`、`toolUseContext.messages` 或 next state，随后再 normalize。
3. 对 FACT_B 的一个子结论作源码纠正：`src/utils/api.ts -> prependUserContext()` 调用 `createUserMessage({ ..., isMeta: true })`，不是“未设置 isMeta”。不过 `normalizeMessagesForAPI()` 不因此把这条 user content 当作 durable state；它仍可能与相邻 Provider user message 合并。
4. cached-MC output-style gate 不一致、fork/resume/swarm state 分歧、预算单位和异步 Transcript 边界继续保持前一轮限定。
5. Harness 的 expected-revision ledger、content-free metadata、single gate decision 仍明确标记为 clean-room 设计迁移。

请只判断这些修订是否消除了实质事实问题。必须以下列三行开头：

```text
GATE: FACT_B_RECHECK
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

不要修改任何文件。普通措辞、格式和无教材影响的边缘问题不形成 Issue。
