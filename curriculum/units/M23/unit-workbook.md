# M23 作者工作簿：工作所有权怎样从 Task 扩展到多 Agent

状态：`researched`

## 单元问题与边界

本单元沿一份真实工作从“待领取记录”走到“正在执行的 child”、再走到 Team 协作和 Cron 续跑。核心问题不是列出所有 Task 命令，而是回答：工作、执行、身份、消息和定时触发分别由谁拥有，为什么不能共用一个状态机。

前置：M15 已建立 Tool 并发、取消和 ordered commit；M17 已建立 revision/transaction；M20-M22 已建立执行治理、extension snapshot 与跨进程 capability lifecycle。

主体保留：

- Runtime Task 与 Work-item Task 的不同 owner、状态、持久化和取消；
- Work-item claim、blocker、busy check、owner 死亡与 TOCTOU 边界；
- foreground/background Subagent 的 controller、handoff、transcript 与 resume；
- Team identity、member directory、task ownership、mailbox 与 shutdown handshake；
- file-backed/session-only Cron、scheduler owner、missed run、jitter 与重复触发边界；
- H5 正式版与 H6 scheduler foundation。

只作定位：Task UI、pane/tmux 细节、全部 agent 类型、完整 Remote Control/UDS transport、完整 plan/permission message 枚举、Cron 创建命令外观。

延后 M24：Transcript JSONL 的完整 parent chain、半写恢复、fork/resume transaction、后台任务跨进程恢复。

## Graphify 候选与源码核验

Graphify 只定位到 `src/Task.ts`、`src/utils/tasks.ts`、`src/tools/AgentTool/`、`src/utils/mailbox.ts`、`src/utils/teammateMailbox.ts`、`src/utils/swarm/`、`src/utils/cronTasks*.ts`。以下事实均已回到源码读取，不以图关系作证据。

## 三个同名概念

### Runtime Task

源码：

- `src/Task.ts`：`TaskType`、`TaskStatus`、`TaskStateBase`、`Task.kill()`；
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx`：`registerAsyncAgent`、`registerAgentForeground`、`backgroundAgentTask`、complete/fail/kill；
- `src/tasks/LocalMainSessionTask.ts` 与其他 `src/tasks/*`：具体运行类型。

快照事实：

- 它是 AppState 中的活执行对象，状态为 `pending | running | completed | failed | killed`；
- 它拥有 runtime id、时间、output file/offset、通知状态，并由具体 Task 实现持有 AbortController 或 kill 行为；
- local shell、local agent、remote agent、in-process teammate、workflow、monitor、dream 共用基础壳，但不是同一业务；
- terminal status 用于阻止向死任务继续注入消息、清理和 UI 驱逐。

### Work-item Task

源码：`src/utils/tasks.ts`。

快照事实：

- 它是文件持久化的协作记录，状态为 `pending | in_progress | completed`；
- 字段包含 subject、description、owner、blocks、blockedBy 与 metadata；
- task list identity 按 explicit env、in-process teammate team、process teammate team、leader team、session fallback 选择；
- list directory、单 task JSON 和 high-water mark 分开；high-water mark 防止 reset/delete 后复用 ID；
- 它不拥有 AbortController、output file 或运行中的 Promise。

### Cron Task

源码：`src/utils/cronTasks.ts`、`cronScheduler.ts`、`cronTasksLock.ts`。

快照事实：

- Cron record 拥有 cron expression、prompt、createdAt、lastFiredAt、recurring/permanent/target 等调度字段；
- file-backed 与 session-only record 的持久化和 owner 不同；
- 它描述“何时产生下一次工作”，不是当前 work-item，也不是 runtime execution。

结论：三者只能通过显式引用关联，不能压成一个 `Task.status` enum。

## Work-item claim 与 owner

### 普通 claim

`claimTask()` 先确认文件存在，再锁目标 task file。锁内重读目标、检查 owner/completed、读取 task list 计算 unresolved blockers，最后用 `updateTaskUnsafe` 写 owner。

精确边界：目标 owner 的 check-and-write 受同一 task lock 保护；blocker 集合来自锁内读取，但其他 blocker 文件没有被同一个事务锁住，因此不能扩大为“整个依赖图原子快照”。

### busy-aware claim

`checkAgentBusy` 走 task-list lock，读取全列表，同时检查目标、blockers 与 claimant 已拥有的其他 unresolved task，再写 owner。它用于收紧 busy-check TOCTOU。

精确边界：这是文件锁协议，不是数据库 serializable transaction。只有遵守相同锁纪律的路径才被序列化；不能宣传为跨机器 lease 或全局 exactly-once claim。

### owner 死亡

Work-item record 只有 owner，没有 expiresAt、heartbeat 或 lease token。`unassignTeammateTasks()` 在 teammate terminated/shutdown 后枚举其 unresolved tasks，把 owner 清空并重置为 pending。

H5 的 expiring lease、heartbeat、fencing token 与自动 reclaim 是 clean-room 增强。

## Subagent：一次调用怎样成为独立执行

源码入口：

- `src/tools/AgentTool/AgentTool.tsx`：sync/async 分支、foreground-to-background handoff；
- `src/tools/AgentTool/runAgent.ts`：context/tool/system/model/AbortController、sidechain transcript、cleanup；
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx`：AppState runtime task、pending message queue、background signal；
- `src/tools/AgentTool/resumeAgent.ts`：transcript/replacement/worktree 恢复；
- `src/tools/AgentTool/forkSubagent.ts`：parent context fork 与 recursive guard。

快照事实：

- sync agent 默认共享 parent AbortController；async agent 创建独立且不相连的 controller；
- async-from-start 明确不链接 parent abort，使主线程 ESC 后后台 agent 继续，只能通过 Task/Agent stop 显式杀掉；
- sync agent 先注册 foreground Runtime Task，`backgroundSignal` 与 iterator.next() race；handoff 后关闭 foreground iterator，并用同一 task controller 重新以 async mode 继续；
- Runtime Task 先 transition terminal 再做可能挂住的 handoff classification/worktree cleanup，使 TaskOutput 等待者及时解除；
- 发给 running local agent 的 plain message 进入 `pendingMessages`，在下一 tool round 由 attachments 路径 drain；stopped/evicted agent 可从 sidechain transcript 恢复后接收消息；
- resume 过滤 unresolved tool use/空 assistant，重建 replacement state；worktree 不存在时回退 parent cwd；
- resumed fork 不重新传已在 transcript 中的 parent context，避免 duplicate tool_use IDs；
- fork child 继承 parent context/system/tool pool 的精确前缀，源码同时用 query source 与 boilerplate guard 防 recursive fork。

H5 的 structured child scope 默认 parent-cancel propagation 是迁移设计，必须与快照 async unlinked 事实并列讲清。企业 Harness 可以提供 `linked` 与显式 `detached` 两种 ownership，不能把“background”自动等同“无人负责”。

## Team 不是多个 Subagent

源码入口：

- `src/tools/TeamCreateTool/TeamCreateTool.ts`；
- `src/utils/swarm/teamHelpers.ts`；
- `src/utils/swarm/inProcessRunner.ts`、`spawnInProcess.ts`；
- `src/tools/SendMessageTool/SendMessageTool.ts`；
- `src/utils/teammateMailbox.ts`、`src/utils/tasks.ts`。

快照事实：

- TeamCreate 建立 team config、deterministic leader id、leader session id、member list、共享 task list，并把 team context 放入 AppState；一个 leader 同时只管理一个 team；
- TeamFile member 记录 agentId、name、agentType、model、cwd/worktree、session/backend/pane、subscription、active/mode 等身份与运行定位；
- Team 的共享 task list 让 work-item owner 与 member identity 对齐；Team 还拥有 inbox 和 shutdown 协议，故不是“并发运行几个 AgentTool”；
- in-process teammate、process/pane teammate 的终止动作不同，但都需要更新 member/task owner，而不只是 abort 一个 Promise。

## 两种 Mailbox

### 进程内 Mailbox

`src/utils/mailbox.ts` 是 memory queue。`send()` 优先满足第一个 matching waiter，否则 push；`poll/receive` 消费并移除；revision 只表示队列变化。Message 有 id，但 Mailbox 不检查重复 ID，也没有 durable ack。

### Team file inbox

`src/utils/teammateMailbox.ts` 以 team/name 定位 JSON inbox。writer 锁住 inbox、重读、append `read:false` 再写回；reader 过滤 unread，并可按 index 或全部标 read。

精确边界：

- `TeammateMessage` 没有稳定 message id；顺序是 inbox 数组追加顺序，不是跨 sender 因果顺序；
- `read` 是消费展示状态，不是业务 side effect 的显式 acknowledgement；
- 没有 dedupe key，因此不能声称 exactly-once；重复写或消费崩溃可能重复呈现/处理；
- file lock 防 concurrent writer 丢更新，但不能提供分布式消息系统语义。

H5 Mailbox 增加 message ID、recipient sequence、dedupe 与 explicit ack，是 clean-room 增强。

## SendMessage 与 shutdown handshake

快照事实：

- plain text 可单发、broadcast、路由到 running local agent pending queue，或恢复 stopped agent；
- structured shutdown/plan messages 不能 broadcast，跨 session/bridge 也只允许 plain text；
- cross-machine bridge prompt injection 使用 bypass-immune safety check 要求显式用户同意，并在真正发送前重检连接；
- shutdown request 生成 requestId 并写目标 inbox；teammate 可以 approval/rejection；
- approval 写回 leader inbox。in-process teammate 随后 abort 自身 teammate controller；process-based teammate schedule graceful shutdown；rejection 保持运行；
- 这是一条带 correlation id 的 request/response protocol，不是 leader 直接把所有 member kill 掉。

不要宣传：自动重试、dedupe、严格 request state machine、exactly-once shutdown。H5 为这些行为增加显式 request state。

## Cron scheduler 的 owner 与崩溃窗口

快照事实：

- file-backed scheduler 用 `.claude/scheduled_tasks.lock` 保存 stable owner/session key、PID、acquiredAt；`wx` 做 exclusive create，live PID 阻止其他 session，dead/corrupt lock 触发 stale recovery；
- passive session 周期 probe；只有 owner 处理 file-backed tasks；session-only tasks process-private，不使用 shared scheduler lock；
- one-shot missed task 只在 initial load surfaced，并异步移除；recurring missed task 由 tick fire 后从 now 重排；
- recurring 使用 deterministic jitter，避免同一 wall-clock 边界惊群；
- in-process `inFlight` 防 async remove/stamp 与 chokidar reload 窗口内重复 fire；
- `onFire/onFireTask` 发生在 one-shot remove 或 recurring `lastFiredAt` 持久化之前。

结论：PID lock 与 `inFlight` 降低重复，但 crash 落在“副作用已发生、remove/stamp 未持久化”之间时仍可再次 fire。当前 record 没有 per-fire trigger id/ack ledger，不能声称 distributed exactly-once。

H6 foundation 增加 stable trigger id、pending outcome、commit/ack 与 recovery redelivery；它提供 at-least-once trigger 加下游 idempotency，不承诺神奇 exactly-once side effect。

## H5/H6 候选契约

### Merge

- `WorkItemStore`：revisioned record、atomic blocker check、expiring claim lease、heartbeat、lease token/fencing、completion/release/reclaim；
- `RuntimeExecutionRegistry`：与 WorkItem 分离，显式 linked/detached cancellation、terminal transition；
- `TeamDirectory`：team/member identity 与 lifecycle；
- `AcknowledgedMailbox`：message ID、dedupe、per-recipient sequence、redelivery-until-ack；
- `ShutdownCoordinator`：requestId、pending/approved/rejected；
- `DurableScheduler` foundation：stable trigger id、pending trigger、missed outcome、commit 后 advance/remove、可导出/恢复 state；
- 所有 trace 只记录 id/status/count/revision，不记录 payload。

### Defer

- 真实 process/tmux/container backend；
- database/queue adapter、跨进程 CAS 与 fencing enforcement；
- full transcript/recovery reducer；
- production Cron HA、distributed clock、full retry/dead-letter；
- Team permission bridge、plan approval、Remote Control/UDS。

### Reject

- 三类 Task 共用状态机；
- owner string 冒充 lease；
- background 等于无 parent owner；
- `read` flag 冒充业务 ack；
- PID lock/inFlight 冒充 exactly-once；
- telemetry 保存 message body、prompt 或 task payload。

## 风险与闸门

风险：R2。核心风险是把同名 Task 合并、把 async Subagent 误写成 parent-cancel、把 Team 简化成多个 child、把 read/lock/inFlight 扩大成 exactly-once，以及把 H5/H6 增强冒充快照事实。

事实闸门须独立核验上述 owner、取消、消息、shutdown 和 crash boundary。教学闸门须检查一条 work-item 纵切能否在 4-7 小时主体内走通，不能退化成五个子系统目录。
