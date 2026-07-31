# M23 事实闸门范围

独立核验当前 Claude Code CLI 快照中 Runtime Task、Work-item Task、Subagent/Team、Mailbox 与 Cron 的所有权和生命周期。源码根：`D:\agent\Claude code最新\claude-code-CLI`。

必须回答：

1. `src/Task.ts` Runtime Task 与 `src/utils/tasks.ts` Work-item Task 的状态、owner、output、取消和持久化为何不同；Cron 是否属于其中任一状态机；
2. ordinary claim 与 `checkAgentBusy` claim 分别锁什么，blocker/owner/busy check 能保证到什么边界；当前 owner 是否有 expiry/heartbeat/lease；
3. foreground、background-from-start、foreground-to-background Subagent 分别持有哪个 AbortController，parent cancel 是否传播；terminal transition、notification、pending message 与 resume 怎样协作；
4. fork child 继承哪些 parent context，recursive guard 与 resume 避免 duplicate tool_use 的真实边界；
5. Team identity/member/config/shared task list 与普通 Subagent 有何不同；
6. memory Mailbox 与 file inbox 的 queue/read/order/lock/ack/dedupe 语义，能否保证 exactly-once；
7. SendMessage 的 local-agent/team/broadcast/cross-session 路由，以及 shutdown request/approval/rejection 的 requestId、abort/graceful exit 顺序；
8. file-backed/session-only Cron 的 scheduler owner、stale lock、missed task、jitter、inFlight、remove/stamp 顺序与 crash duplicate window。

优先入口：

- `src/Task.ts`
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx`
- `src/tasks/LocalMainSessionTask.ts`
- `src/utils/tasks.ts`
- `src/tools/AgentTool/AgentTool.tsx`
- `src/tools/AgentTool/runAgent.ts`
- `src/tools/AgentTool/resumeAgent.ts`
- `src/tools/AgentTool/forkSubagent.ts`
- `src/utils/mailbox.ts`
- `src/utils/teammateMailbox.ts`
- `src/tools/SendMessageTool/SendMessageTool.ts`
- `src/tools/TeamCreateTool/TeamCreateTool.ts`
- `src/utils/swarm/teamHelpers.ts`
- `src/utils/cronTasks.ts`
- `src/utils/cronScheduler.ts`
- `src/utils/cronTasksLock.ts`

可定向读取相关 tests/types/callers。不要读取 Graphify、M23 工作簿、Codex 结论、Harness、草稿、其他单元或历史聊天；只读，不修改文件。

只报告会改变状态 owner、claim/lease、取消、resume、Team identity、消息交付、shutdown 或 Cron crash 语义的问题。UI、pane 布局、命令文案、完整 backend/structured-message 枚举不算 Issue。
