# H3-1 行为契约

状态：`S3 in progress`

版本边界：`H3-1 / Harness 0.3.0`。H3 尚未发布；本文件只冻结 M16 已验证的 Context 请求投影增量。H2 的全部不变量继续有效，见 `h2-contract.md`。

## Aggregate result budget

89. `ConversationStore` 继续拥有完整 durable tool output。`RequestProjector` 只能在当前 `ModelRequest` 的副本中替换结果正文，不能修改 Store 的消息成员、嵌套 output 或 revision。
90. `maxToolResultChars` 是兼容性的单结果 preview policy；`maxToolResultGroupChars` 是同一最终 tool-result group 的聚合预算。两者是先后执行的两个投影边界，不能把任一者描述为完整请求 token 上限。
91. 聚合分组以当前 Provider-neutral `ModelMessage` 中连续的 `tool` message 为界。这是 Harness 对自身 OpenAI-compatible request shape 的 clean-room 契约，不声称逐项复制 Claude Code 快照的内部 envelope 合并算法。
92. 聚合预算只替换 tool-result content，必须保留 role、tool-call ID、消息顺序和配对关系。投影完成后必须再次执行 strict pairing；失败时不得提交 replacement metadata，也不得调用 Provider。
93. 当组超限时，只能从从未作出决定的 fresh result 中选择 replacement。选择按可减少字符数降序，call ID 作为确定性 tie-break；replacement 字符串必须被精确保存，后续请求逐字重放。
94. `ResultBudgetLedger` 是一个 `AgentRuntime` 生命周期内的 replacement-decision owner。它保存 `seenIds`、exact `replacements` 和单调 revision；已见但未替换的结果被冻结，不能在后续轮次临时改成 preview。
95. ledger 更新使用 snapshot、plan、expected-revision commit。两个 writer 从同一 revision 计算时，只有第一个提交成功；旧 writer 必须抛出 `StaleReplacementRevisionError`，不能覆盖新决定。
96. strict post-projection validation 发生在 ledger commit 之前。因此 orphan、missing 或 duplicate tool result 不会留下“请求失败但 replacement state 已前进”的半提交状态。
97. report 与 Trace 只能记录计数、revision、是否 over-budget 和 strict status。不得记录原 tool output、preview 正文或 request-only context。
98. `overBudgetToolResultGroupCount > 0` 是合法且必须可观察的结果：例如全部候选已经被冻结、replacement 不能带来正向缩减，或策略明确排除某类结果。该字段禁止被包装成“预算已强制满足”。

## 状态与生命周期

```text
ConversationStore snapshot (durable full output)
        |
        v
per-result projection
        |
        v
ResultBudgetLedger snapshot
        |
        v
aggregate projection plan
        |
        v
request-only context insertion
        |
        v
strict pairing validation
        |
        +-- failure --> no ledger commit / no Provider call
        |
        v
expected-revision ledger commit
        |
        v
frozen ModelRequest + content-free report
```

`AgentRuntime` 持有同一个 `RequestProjector`，后者持有同一个 ledger，所以 replacement decision 能跨模型迭代稳定重放。当前实现是进程内状态；它没有 Transcript durability、resume reconstruction 或跨进程共享语义。

## TypeScript 与 Python 对称边界

两种实现必须同时证明：

- 三个单结果分别未超限时，聚合后的同组仍能触发 replacement；
- 第二次投影重放 exact replacement，revision 不因纯重放继续增长；
- Store 中仍保留完整 output；
- orphan history start 在 Provider 前被拒绝；
- stale ledger writer 被拒绝；
- report/Trace 不包含原正文和 preview 正文。

Python 镜像使用 frozen dataclass、tuple/frozenset 和 expected revision 表达同一行为契约，不要求与 TypeScript 逐行同构。

## 明确延后

- Claude Code 式外置 tool-result 文件与精确 Transcript replacement record；
- resume、fork、teammate 的 ledger provision 与持久化恢复；
- Provider-specific Prompt Cache marker、reference 和 cache edit；
- snip、microcompact、context collapse 与完整 compact transaction；
- token-aware 全请求预算、图片/document 预算和模型 tokenizer；
- 多 Runtime 或分布式 projector 的共享 ledger 存储。

这些能力分别由 M17-M19、M24 和后续生产治理演进。本契约不得被解释为已经完成 H3。

## 回归命令

```powershell
cd "D:\agent\Claude code最新\mini-agent-harness"
npm run test:all
```
