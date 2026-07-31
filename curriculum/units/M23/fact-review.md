# M23 事实双闸门与 Codex 裁决

状态：`fact-reviewed`

审查会话：见 `fact-session-id.txt`。

## FACT_A

```text
GATE: FACT_A
VERDICT: BLOCK
MATERIAL_ISSUES: 7
```

FACT_A 的七项计数来自提示要求审查者逐项反证的错误命题，而不是 Codex 研究结论的缺陷：

1. Runtime Task、Work-item Task 和 Cron 共用一个状态机；
2. Work-item owner 是带 expiry、heartbeat 和 token 的租约；
3. 所有 Subagent 都跟随 parent cancellation；
4. Team 只是同时运行多个 Subagent；
5. file inbox 的 `read` 等于业务 ack，并带 message ID 去重；
6. scheduler PID lock 与 `inFlight` 提供 exactly-once；
7. shutdown 是 leader 直接 abort teammate。

审查者均成功否定这些命题，并独立确认三类工作状态、两条 claim 锁路径、Subagent 取消所有权、Team 协调平面、Mailbox delivery 边界、shutdown request/response 和 Cron 崩溃窗口。

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同一会话逐项接受 Codex 的九组结论：

- Runtime Task、Work-item Task 和 Cron record 的 owner、状态与持久化边界不同；
- ordinary claim 只保护 target check-and-write，busy-aware claim 用 task-list lock 收窄同协议 TOCTOU，但两者都不是分布式 serializable transaction；
- 当前 Work-item owner 没有 expiry、heartbeat 或 fencing token；
- sync Subagent 与 async/background Subagent 的 AbortController owner 不同，foreground-to-background 是显式资源 handoff；
- pending message、sidechain resume、fork context 与 duplicate tool-use guard 的边界；
- Team 的 identity、shared task list、inbox 和 lifecycle 使它不同于并发 AgentTool；
- memory/file mailbox 都不提供 stable ack/dedupe/exactly-once；
- SendMessage 路由和带 requestId 的 shutdown approval/rejection；
- Cron owner lock、missed task、jitter、`inFlight` 与 fire-before-persist 崩溃窗口。

## Codex 裁决

FACT_A 的七项全部是已成功反证的常见误写，FACT_B `PASS / 0` 后无需第三轮事实审查。正文保持明确边界：H5 的 expiring lease/fencing、acknowledged mailbox 和 shutdown state，以及 H6 foundation 的 stable pending trigger/commit/recovery，均为 clean-room 企业迁移，不是 Claude Code 当前快照事实。
