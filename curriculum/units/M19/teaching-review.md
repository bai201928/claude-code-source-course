# M19 教学闸门与 Codex 裁决

状态：`teaching-reviewed`

审查会话：`d03311bb-6c48-4e09-b6ca-fa9ef4e0d279`

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

## 通过理由

独立 Claude Code/DeepSeek Max 教学审查只读取了 `2.md`、标杆规则和 M19 正文，并确认：

- 正文从同一句偏好可能出现在五种载体的真实误判进入，连续建立 owner、scope、生命周期和可见性边界；
- Session Memory 的触发、串行 extraction、15 秒 soft wait、一分钟 stale、safe boundary、SM-first compact 与 traditional fallback 可以独立画出；
- Auto Memory 的 canonical git-root scope、topic/index、主 Agent 写入、后台 fork、coalescing 与 headless soft drain 形成闭环；
- `tool_use` 写入意图未与 `tool_result` 成功配对的失败窗口足够醒目，全文没有 exactly-once 或失败安全的过度承诺；
- relevance prefetch、header scan、side query、bounded read、zero-wait collect、取消、去重、attachment normalization 与 compact 后重新 surfacing 都被讲成 request-time projection；
- Auto Dream 的 gates、PID/mtime lock、异步价值和非事务边界同时出现，没有被美化为强一致 consolidation；
- 12 张局部图分别服务于认知转折，方向、术语和正文一致，完整 Markdown 已 `12/12` 渲染；
- H3-4 实验包含预测、反证、破坏和修复，candidate lifecycle、scope、revision、retention、bounded recall 与 content-free Trace 构成可修改契约；
- ConversationStore、CompactCoordinator、InstructionCatalog、MemoryStore 与 MemoryProjector 分权清楚；
- Java/Spring、LangGraph、CAS、PII/DLP、outbox 与多租户 scope 都从机制自然推出；
- 8 道资深 Agent 岗面试题结论先行、口语自然，可以继续承接源码、失败边界和系统设计追问；
- `[FACT]`、`[RUN]`、`[DESIGN]` 和明确的 defer 列表守住了事实边界。

## Codex 裁决

无实质 Issue，不需要教学复审。

审查者保留两个非阻断观察：后续 Transcript 单元可进一步拆分 extraction worker 与 Auto Dream 对同一目录的不同写入语义；实验教学时可给 TypeScript 测试断言补充约 5 分钟说明。这两点不影响本章主链、实验契约或当前 Harness，因此不修改正文。
