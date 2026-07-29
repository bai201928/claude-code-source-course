# FACT_B 同会话对照提示词

继续刚才的 FACT_A 会话。现在把你独立得到的结论与下面 Codex 摘要和实验设计逐项对照。不要重新扩散整个源码树；只有发现明确冲突时才定向回读。

## Codex 机制摘要

```text
queryLoop State.messages
-> getMessagesAfterCompactBoundary 的浅 view
-> applyToolResultBudget
-> feature-gated snip
-> microcompact
-> feature-gated context-collapse projection
-> autocompact / buildPostCompactMessages
-> prependUserContext
-> queryModel
-> normalizeMessagesForAPI
-> model-specific cleanup
-> ensureToolResultPairing
-> advisor/media cleanup
-> paramsFromContext / addCacheBreakpoints
-> messages.create({ ...params, stream: true })
```

Codex 结论：

1. `messagesForQuery` 是 producer-local 派生视图，不是 durable owner；初始 spread 只复制数组容器。
2. compact boundary 用于选择最新可见历史，boundary 被包含以保留内部语义，但普通 system 会在 API normalize 时过滤。
3. tool-result budget 在 normalize 前模拟 API user-group 边界，稳定 replacement state 用于请求前缀一致；它可记录 replacement，但不等于删除 durable membership。
4. 当前快照缺少 snip/context-collapse 的部分模块，只能确认 feature gate、调用接口和顺序。
5. `prependUserContext` 创建 ephemeral meta user message；system context 走独立 system prompt 通道。
6. `normalizeMessagesForAPI` 是过滤、重排、合并、转换和校验过程，不是简单类型转换或 JSON serialization。
7. `ensureToolResultPairing` 默认可修复 resume/teleport 造成的缺失/orphan/duplicate；strict mode 发现 repair 时抛错。Synthetic result 不能当真实执行事实。
8. `messagesForAPI` 仍不是最终 wire payload；`paramsFromContext` 继续加入 system/tools/cache/thinking/betas 等，实际调用再加 `stream: true`。

## 拟写入教材的关键表述

- “durable conversation 保存发生过什么；request view 决定这一次允许模型看什么；API normalization 把内部消息编译成 Provider 合法协议；wire params 再加入模型、工具、系统提示和缓存策略。”
- “投影应尽量是纯函数；需要跨请求稳定的 replacement 决策时，状态也必须有独立 owner 和可恢复记录。”
- “Claude Code 的 repair 是兼容策略，不是所有 Harness 都该复制；作品级 Harness 默认 strict fail-closed。”
- “最终请求合法性取决于消息配对、role/content 形状、工具 schema、system 和模型能力的共同约束。”

## 实验设计

独立 TypeScript/Python clean-room：

- source 中保留 boundary 前历史、完整大 tool result、boundary/progress/attachment 等领域消息；
- projection 选择最新 boundary 后的 view，过滤内部 envelope，把 attachment/local output 转为 user；
- request-only context 前置；
- aggregate tool-result budget 产生 deterministic preview，但 source 不变；
- strict pairing 拒绝缺失/orphan/duplicate；repair 模式插入或移除并返回 report；
- 最终 payload 在 normalize 后构造并冻结；重复 projection 结果稳定。

## Harness 取舍

候选合入 `RequestProjectionPolicy` 与无内容的 `RequestProjectionReport`，支持 history start、ephemeral user context、有限 tool-result preview 和 strict request validation；不合入 Claude Code 私有 repair、真实 compact transaction、外置 result persistence 或 cache editing。

## 审查要求

只检查事实错误、重要遗漏、证据不足、层次混淆和实验不能验证表述的问题。普通措辞、格式和无现实影响的边缘问题不构成 Issue。

输出必须以下列三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有 Issue，给出路径与符号、与 FACT_A 的对照、影响和最小修正；没有实质问题时明确写 `No material issues`。

