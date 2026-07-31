# M23 FACT_B：同会话对照

继续 FACT_A 会话，只核对下面的 Codex 结论，不重新总结仓库。

## Codex 结论

- Runtime Task 是 AppState 活执行：`pending/running/completed/failed/killed`、output file/offset、timing、notification 与具体 kill/AbortController。Work-item 是 file-backed 协作记录：`pending/in_progress/completed`、owner、blocks/blockedBy、metadata。Cron 是第三种 trigger record；三者不可共用状态机。
- ordinary claim 用 target task lock 保护 target owner check-and-write；blocker list 在锁内读取但不是依赖图事务。busy-aware claim 使用 task-list lock 同时检查 target、blocker 和 claimant 其他 unresolved tasks，收紧遵守同一协议路径的 TOCTOU；这不是跨机器 serializable transaction。
- Work-item owner 没有 expiresAt、heartbeat 或 lease token。teammate 退出后 `unassignTeammateTasks` 才把 unresolved owner 清掉并回 pending。H5 expiring lease/fencing 是 clean-room 增强。
- sync Subagent 共享 parent controller。async-from-start 明确使用 unlinked controller，主线程 ESC 后继续，需显式 Task/Agent stop；foreground-to-background 用 Runtime Task 的 controller 接管并重启 async iterator。terminal status 先落再做可能挂住的 cleanup/notification。
- running local agent 的 plain message 进入 pending queue，在下一 tool round drain；stopped/evicted agent 可从 sidechain transcript resume。resume 重建 replacement/worktree；resumed fork 不重传已在 transcript 中的 parent context，避免 duplicate tool_use IDs。fork 继承 parent context/system/tool pool，并有 recursive guard。
- Team 创建独立 config、deterministic leader/member identity、shared task list、inbox 与 shutdown protocol。它不是并发运行几个 AgentTool。
- memory Mailbox 是 consuming queue，Message id 不用于 dedupe；file inbox 在 lock 下 append `read:false`，按 index/all 标 read，但 TeammateMessage 没有 stable id。`read` 不是业务 ack，跨 sender 没有 causal order，不能保证 exactly-once。
- SendMessage 可路由 running/stopped local agent、team direct/broadcast 和受限 cross-session plain text。structured messages 不能 broadcast/cross-session。cross-machine bridge 有 bypass-immune consent。shutdown 使用 requestId 的 request/approval/rejection；in-process approval abort teammate controller，process backend graceful exit，rejection 继续运行。
- file-backed Cron 只有 scheduler-lock owner fire；passive session probe stale PID。session-only task process-private。initial missed one-shot surfaced/removes，recurring 从 now 重排并 deterministic jitter。`onFire` 先于 one-shot remove/recurring lastFiredAt persist；inFlight 只收窄本进程 async reload 窗口，crash 后仍可能 duplicate，不是 exactly-once。

## H5/H6 foundation

Harness 增加 distinct RuntimeExecution/WorkItem、revisioned TaskStore、expiring lease/heartbeat/reclaim、linked/detached child scope、TeamDirectory、message ID/dedupe/explicit ack、shutdown request state，以及 stable trigger ID/pending outcome/commit/recovery。它是 clean-room 企业迁移，trace 只含 metadata；不声称 Claude Code 已实现这些增强。

只报告会改变上述事实、实验或 H5/H6 契约的实质问题。必须以下列三行开头；接受时明确 PASS / 0。

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```
