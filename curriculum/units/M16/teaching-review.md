# M16 教学闸门与 Codex 裁决

状态：`teaching-reviewed`

审查会话：`7938da24-533d-49f2-b1e0-4fe74f46f8b9`

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

## 通过理由

独立 DeepSeek Max 教学审查确认：

- 正文从“完整历史存在，但模型只看到请求投影”的真实矛盾推进，不是 Context 函数目录；
- durable history、`messagesForQuery`、normalized API messages 和 wire payload 的 owner 可独立复述；
- history boundary、浅复制、copy-on-write 与 strict post-validation 没有混淆；
- per-tool persistence 与 aggregate final-group budget 的时点、单位、owner 和失败语义清楚；
- progress、attachment、同 response fragment 与 excluded/self-bounded overage 均在正确分组边界内；
- fresh/frozen/reapply、exact replacement、fork/resume/teammate 差异和可变 Map 的并发边界形成完整解释；
- 字符、估算 token、API usage、message group 和 wire payload 严格分层；
- snip、microcompact、collapse 和 autocompact 守住可见证据与 M17 边界，cached-MC gate 漂移被准确标为快照缺口；
- request-only user context、attachment 时点和 cache edit 位置没有与 durable state 混淆；
- TypeScript/Node 难点与 Java/Python 对照出现在真正改变机制的位置；
- 15 张局部图分布在认知转折处，且 `15/15` 渲染通过；
- 双语言实验包含预测、反证、破坏与修复，不以测试通过代替机制理解；
- Harness H3-1 准确区分快照事实、运行验证和 revision ledger 设计迁移；
- Java/Spring、RAG、LangGraph 和企业迁移由 owner、预算、提交点与失败语义自然推出；
- 7 道面试题符合资深岗位追问，回答结论先行、口语化且可承接源码与系统设计追问；
- 正文守住 M16 范围，没有提前吞并 compact transaction、Transcript、Instructions 或 Memory。

## Codex 裁决

无实质 Issue，不需要教学复审。

审查者给出两个非阻断建议：为 UTF-16 字符估算增加一个数字例，以及在 microcompact 决策图中再次标出 pending edit 的消费位置。正文已经准确解释两点，且相邻文字可以独立闭合；它们不影响初学者理解、实验或 Harness 契约，因此不修改、不阻断候选稿。
