# M15 教学闸门与 Codex 裁决

状态：`teaching-reviewed`

审查会话：`609dcbaa-5afa-462c-90b2-4d541310de05`

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

## 通过理由

独立 DeepSeek Max 教学审查确认：

- 正文从“串行过慢、无差别并发破坏副作用、失败仍须配对”的真实矛盾进入，不是工具函数目录；
- `needsFollowUp`、两种 scheduler、共享 `runToolUse()` 与 next iteration 可以独立复述；
- parse 后动态 safe 分类、safe batch、exclusive barrier、有界并发和确定性发布没有混淆；
- Hook allow、Permission 与 Sandbox 的职责分层准确；
- progress、final result、durable conversation 与 observer 通道边界明确；
- unknown、invalid、deny、throw、cancel 和 success 的 exactly-once pairing 形成完整协议恢复；
- streaming/non-streaming 的 context modifier、Bash sibling cascade、`interruptBehavior` 和 alias fallback 差异均有明确路径限定；
- discard/tombstone 不等于 rollback，副作用与幂等边界没有被弱化；
- 14 张局部图分布在真实认知转折处，并能独立用于复习；
- 双语言实验具有预测、反证条件和破坏修复，不以测试通过代替机制验证；
- Harness 的统一 executor 被准确标为设计迁移，Provider-SSE trigger、durable idempotency 与完整扩展 ABI 保持 defer；
- Java/Spring、RAG、LangGraph 与企业迁移由当前机制自然推出；
- 7 道面试题符合资深 Agent 岗位追问，回答结论先行、口语化且能承接源码和系统设计追问。

## Codex 裁决

无实质 Issue，不需要教学复审。

审查者只记录一个非阻断风险：独立实验中的“快照模拟”没有展开具体 setup 文件结构。正文已明确实验不连接真实模型、只验证两个策略差异，并在前文完整解释两条快照路径；这不影响学习、实验或 Harness 契约，不形成修改阻断。
