# M24 研究工作簿：Transcript、Resume、Fork 与恢复事务

状态：`researched`

风险：`R2`。本单元涉及 append-only 持久化、崩溃窗口、DAG 重建、Tool Loop 配对、Fork 隔离和后台执行恢复。任何把“可继续对话”扩大成“外部副作用 exactly-once”的表述都会改变系统设计结论。

## 1. 单元问题与边界

真实问题不是“怎样读取聊天记录”，而是：进程可能在用户消息、模型流、工具副作用、tool_result、后台任务或 Transcript 写入之间任意退出，下一进程怎样恢复一个协议有效、身份清楚、能够继续、又不掩盖不确定副作用的运行视图？

本单元闭合：

- 主 Transcript 的惰性物化、append queue、UUID 去重和 flush；
- JSONL 半写/坏行、消息 DAG、leaf 选择、parent chain、并行 tool 分支恢复；
- unresolved tool use、thinking/whitespace 清理和 interrupted turn 分类；
- normal resume、fork session、worktree、content replacement、context collapse、file history、todo、agent/cost/metadata 的分 owner 恢复；
- Local Agent sidechain resume 与后台执行“可重建上下文但不可证明副作用状态”的边界；
- H6 的 TranscriptStore、RecoveryReducer、ResumeCoordinator、effect journal、orphaned background 与 scheduler pending trigger 接管。

本单元不把 resume picker UI、全部远程会话协议、所有旧格式兼容分支或管理命令列为主体。它们只在改变恢复语义时出现。

## 2. 源码地图与真实运行链

### 2.1 写路径

```text
QueryEngine.submitMessage
-> processUserInput 得到用户消息
-> recordTranscript(messages)
-> Project.insertMessageChain()
-> Project.appendEntry()
-> enqueueWrite(filePath, entry)
-> 100ms 批量 drain / 显式 flush
-> JSONL append
```

决定性锚点：

- `src/QueryEngine.ts -> submitMessage()`：进入模型前先请求记录用户消息；普通路径 `await recordTranscript()`，但只有 eager/cowork 路径继续 `flushSessionStorage()`。
- `src/utils/sessionStorage.ts -> Project.appendEntry()`：多数分支使用 `void this.enqueueWrite(...)`，因此 `appendEntry()` 和上层 `recordTranscript()` 可以在物理 append 前返回。
- `src/utils/sessionStorage.ts -> Project.flush()`：取消 timer，等待 active drain，再同步 drain 剩余队列；cleanup 先 flush，再把 session metadata 重写到尾部。
- `Project.materializeSessionFile()`：metadata/hook 等可先缓冲，直到第一条 user/assistant 才创建会话文件，避免 metadata-only session。
- 主文件 message UUID 去重；本地 agent sidechain 写入故意绕过主文件 UUID set，因为 fork 继承上下文会复用 UUID。sidechain UUID 不能反向污染主文件 set，否则主链可能产生 dangling parent。

结论边界：`await recordTranscript()` 不等于 durable commit；显式 `flushSessionStorage()` 才等待队列写完，但文件系统 append 完成也不自动等价于跨机器复制或外部副作用事务。

### 2.2 读路径

```text
loadConversationForResume
-> loadMessageLogs/getLastSessionLog 或 JSONL path
-> loadFullLog/loadMessagesFromJsonlPath
-> loadTranscriptFile
-> 解析 entries + 恢复 metadata/compact/replacement
-> 计算 user/assistant leaves
-> buildConversationChain(newest leaf)
-> 恢复并行 assistant/tool_result sibling
-> deserializeMessagesWithInterruptDetection
-> restoreSessionStateFromLog/processResumedConversation
```

决定性锚点：

- `src/utils/json.ts -> parseJSONL()`：逐行解析，坏行直接跳过；最后一条半写 JSON 不会阻断其他完整行。
- `src/utils/sessionStorage.ts -> loadTranscriptFile()`：消息按 UUID 放入 Map，metadata 按类型采用 last-wins、ordered list 或 session/agent keyed accumulation；读失败被捕获并返回空结构。
- `loadTranscriptFile()` 在读侧执行 compact preserved-segment relink 和 Snip removal，再按 parent relation 计算 leaf。
- `buildConversationChain()` 从 leaf 逆向走 `parentUuid`，cycle 时记录并返回 partial chain；dangling parent 会自然截断。
- `recoverOrphanedParallelToolResults()` 以 provider `message.id` 找并行 assistant sibling，再用 tool_result 的 assistant parent 关系补回单 parent walk 遗漏的 DAG 分支。
- `loadFullLog()` 选择最新 user/assistant leaf；fork 文件的根可能保留来源信息，因此 session ownership 以 leaf/session metadata 为准。

### 2.3 协议清理与 interrupted turn

- `filterUnresolvedToolUses()` 收集 `tool_use` 与 `tool_result` ID，只删除“所有 tool_use 都未配对”的 assistant message；它避免把无结果工具调用重新送进 API。
- `filterOrphanedThinkingOnlyMessages()` 与 `filterWhitespaceOnlyAssistantMessages()` 继续清除会导致 API 无效或无意义的尾部消息。
- `detectTurnInterruption()` 跳过 system/progress/API error；末尾普通 user 是 `interrupted_prompt`，末尾非终止 tool_result/attachment 是 `interrupted_turn`，末尾有效 assistant 视为已完成。
- mid-turn interruption 会追加 meta continuation user；只要最后相关消息为 user，再插入 assistant sentinel，使“用户消息后没有 assistant”的历史仍满足 API 交替约束。
- Headless 自动恢复在 `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` 开启时删除 interrupted user 与 sentinel，再把内容放回同一输入队列一次。这个“消息级一次”不证明工具副作用只执行一次。

## 3. 状态所有者

| 状态 | 快照中的 owner | 恢复动作 |
| --- | --- | --- |
| JSONL 写队列、sessionFile、metadata cache | `Project` | cleanup flush；normal resume adopt 旧文件 |
| 消息拓扑 | Transcript entry 的 `uuid/parentUuid` | leaf 选择、逆向 chain、DAG sibling 补回 |
| tool use/result 配对 | 消息 content block ID | resume 过滤 unresolved assistant tool use |
| interruption classification | `conversationRecovery.ts` | continuation + sentinel；可选 auto re-enqueue |
| file history / attribution / todo | 各自 store/AppState | `restoreSessionStateFromLog()` 分别接管 |
| context collapse | context-collapse persist store | ordered commits + last snapshot 重建 |
| tool-result replacement | `ContentReplacementState` | Transcript records 重建，fork 另行 seed |
| session ID、agent/model、cost | bootstrap/cost/agent owners | normal resume 复用；fork 保留 fresh ID |
| worktree cwd | process cwd + worktree owner | `process.chdir()` 作为存在性检查，缺失则回退 |
| Local Agent live execution | Runtime Task/AbortController | sidechain 只恢复消息和配置，再注册一个新 live attempt |

关键设计思想：恢复不是一个大对象反序列化，而是多个 owner 以同一 Transcript/metadata 为输入，各自重建本领域状态。这样可避免一个 ResumeCoordinator 变成所有可变状态的永久 owner。

## 4. Normal Resume 与 Fork

Normal resume：

- `switchSession()` 复用 leaf 所属 session ID；
- `resetSessionFilePointer()` 防止临时启动 session 路径泄漏；
- `restoreSessionMetadata()`、worktree restore、`adoptResumedSessionFile()` 让后续写入继续落在旧 JSONL；
- 恢复 cost、agent/model、file history、attribution、todo、context collapse 与 replacement state。

Fork：

- 保留 fresh session ID，不接管原 session 的 worktree；
- `branch.ts -> createFork()` 复制主会话消息，重写 session ID、重建线性 `parentUuid`，保留 `forkedFrom` 追踪；
- content-replacement entry 必须用 fork session ID 单独 seed，否则相同 tool result 会在下一次请求被错误分类；
- clean-room H6 进一步为 fork 消息 mint 新 ID，并保留 source ID mapping，降低跨 session identity collision；不复制未决 effect/background ownership。

## 5. 四类崩溃窗口

1. 模型请求：用户消息只 enqueue 未 flush 就退出，下一进程可能看不到该 prompt；已 flush 但无 assistant 时可识别为 interrupted prompt。
2. 工具调用：外部 API 成功后、tool_result/commit 前退出，Transcript 只能看到 unresolved tool use 或 attempted effect，无法判断副作用是否发生；必须是 `indeterminate`，不能盲目重试。
3. Transcript：append 产生半行，`parseJSONL()` 跳过该行并保留之前完整记录；若坏行位于中间也会被跳过，可能形成 dangling parent，恢复报告应显式暴露而非静默宣称完整。
4. 后台任务/Cron：live process 已消失但 started/heartbeat 没有 terminal record，恢复为 orphaned execution；stable pending trigger 可用同一 trigger ID 重投，但外部消费者仍需 idempotency ledger/outbox。

## 6. H6 候选契约

- `TranscriptStore`：append-only、record ID 去重、message ID 冲突可见、export/import、JSONL 坏行与 partial tail 报告。
- `RecoveryReducer`：按 session/leaf 重建 chain，报告 cycle/dangling/duplicate，补 parallel group，过滤全 unresolved tool-use assistant。
- effect journal：`prepared -> attempted -> committed`；恢复分类为 `prepared / indeterminate / committed`。
- background journal：started/heartbeat/terminal；非 terminal attempt 作为 orphaned，交给 supervisor 选择 resume/manual，不把旧 AbortController 复活。
- `ResumeCoordinator`：normal 复用 session；fork mint 新 session/message/record ID，并隔离未决 effect/background；接管 `DurableScheduler` pending trigger 但不自动 commit。
- `RecoveryReport`：只含 revision、count、record/message/tool/effect/execution/trigger ID 和状态，不含 prompt、tool payload、result 或 secret。

预期裁决：`merge` persistence-neutral H6 核心；`defer` 文件/数据库 adapter、outbox、跨进程 worker、schema registry、leader election；`reject` unresolved tool 自动重跑、用 Transcript 猜副作用成功、fork 共享未决 owner、report 记录正文。

## 7. 实验假设与反证条件

- 截断最后 JSONL 行后，完整前缀仍恢复，报告标记 partial tail；若整个恢复失败则反证。
- 重复 record ID 幂等，冲突 message ID 可见；若后写静默覆盖则反证。
- dangling parent 与 cycle 返回 partial chain 且报告不完整；若宣称完整或死循环则反证。
- tool use 无 result 时不进入可发送历史；attempted effect 恢复为 indeterminate；若自动重试则反证。
- normal resume 保持 session ID；fork 使用新 ID 且不复制 orphan/effect owner；若两边共享可变 owner 则反证。
- pending scheduler trigger 恢复后 ID 不变，直到显式 commit；若 poll 生成新 ID 或自动消失则反证。
- report 序列化不含测试 payload/secret；若泄漏则反证。

## 8. 事实闸门范围

R2。FACT_A 独立确认写入 durability 边界、DAG/partial-tail 读语义、interrupted classification、normal/fork state takeover、sidechain/background 边界。FACT_B 对照上述结论和 H6 契约，重点拒绝 exactly-once 扩大、fork identity 混淆与静默恢复完整性假设。
