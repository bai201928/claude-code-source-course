# M24 实现与实验报告

状态：`release-candidate`

## 闸门

```text
FACT_A: REVISE / 4（均为提示要求反证的错误命题）
FACT_B: PASS / 0
```

## Harness H6

Decision：`merge + defer + reject`。

Merge：TypeScript/Python persistence-neutral `TranscriptStore`、record ID idempotency/revision、message ID conflict report、JSONL malformed/partial-tail codec、leaf/parent/cycle/dangling reducer、parallel assistant/tool-result recovery、unresolved tool pairing、effect `prepared/attempted/committed` recovery、orphaned background attempt、Normal/Fork `ResumeCoordinator`、source identity mapping、stable pending scheduler trigger takeover 与 metadata-only RecoveryReport。

Defer：真实 filesystem/database adapter、fsync/WAL 策略、schema migration registry、database CAS/outbox、跨进程 worker supervisor、effect reconciler connector、durable compact journal integration、scheduler leader election、distributed fencing 和 process-backed Subagent。

Reject：`await recordTranscript` 冒充 durable commit、坏行静默宣称完整、unresolved tool 自动重跑、attempted 当 failed、Fork 共享未决 effect/background owner、恢复旧 AbortController、pending trigger 自动 commit、RecoveryReport 记录 prompt/tool/result payload。

## 实验结果

```text
TypeScript TranscriptRecovery: 9/9
Python TranscriptRecovery: 7/7
TypeScript integrated: 114/114
Python integrated: 86/86
Strict typecheck: PASS
Mermaid: 22/22
```

聚焦实验覆盖 record/revision 冲突、坏中间行、partial tail、dangling parent、cycle、parallel sibling/tool result、全 unresolved assistant、三态 effect、orphaned background、Normal/Fork identity、scheduler pending trigger 与 metadata-only report。测试明确验证 payload/secret 不进入 RecoveryReport。

H6 当前是作品集级协议实现，不声称已有真实磁盘 durability、数据库事务、跨进程恢复或 exactly-once。
