# M24 事实双闸门与 Codex 裁决

状态：`fact-reviewed`

审查会话：见 `fact-session-id.txt`。

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 4
```

四项计数均来自提示要求审查者反证的错误命题，而不是 Codex 结论缺陷：

1. `await recordTranscript()` 已等价于物理 durable append；
2. 一条坏 JSONL 会让整个 Transcript 无法恢复；
3. Resume 会重新执行 unresolved tool use；
4. Normal Resume 与 Fork 接管相同 session/worktree owner。

FACT_A 独立确认 `void enqueueWrite` 与 lazy drain 的 crash window、逐行容错解析、message-level unresolved filter、Normal/Fork 分叉和外部副作用无法由缺失 tool result 判定。

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同一会话接受 Codex 的全部关键结论，并对 FACT_A 两个扩大表述作了勘误：

- `filterUnresolvedToolUses()` 不检查 text；只要该 assistant 的全部 tool use 都 unresolved，就删除整条 message，text 也会丢失；mixed resolved/unresolved 则保留整条。
- Headless auto-resume 只在当前启动里删除旧 user/sentinel 后重新入队一次，没有 durable ack，不能称为跨崩溃 prompt exactly-once，更不能证明 tool effect exactly-once。

## Codex 裁决

FACT_A 四项是已成功反证的常见误写，FACT_B `PASS / 0` 后无需第三轮事实审查。正文明确区分：

- append request、queue drain、local append、fsync/replication 与业务事务；
- 可读 JSONL 前缀和完整恢复证明；
- message/tool pairing 与外部副作用提交；
- Normal identity takeover 与 Fork isolation；
- sidechain context recovery 与旧 live process/effect state；
- Claude Code 快照事实与 H6 clean-room effect/background journal。
