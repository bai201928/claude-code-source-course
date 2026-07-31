# M17 作者工作簿：Compact 事务、边界与恢复

状态：`fact-reviewed`

本文件是作者工作区，不是教材正文。Graphify 只用于候选定位；以下快照结论均已回到 `claude-code-CLI/` 直接核验。`contextCollapse`、`reactiveCompact` 的实现文件在当前快照中缺失，只能使用可见接口、调用点和注释限定边界。

## 单元问题、前置与风险

M16 已经说明 durable history、query view、API view 和 wire request 不是同一个对象，也验证了轻量 projection 可以不改写长期事实。M17 继续回答更危险的问题：轻量裁剪仍装不下时，系统怎样生成摘要、切换 history boundary、继续当前请求，并让下一次 `--resume` 找到一条可用链？

真正的难点不是“调用模型生成一段 summary”，而是下面四个时点不能混成一个“压缩成功”：

```text
summary 生成完成
-> CompactionResult 组装并返回
-> 当前内存/query view 替换为 post-compact view
-> boundary + summary + 后续消息进入 Transcript，并能在 resume 时重建
```

本单元风险为 `R2`：涉及取消、失败、副状态清理、append-only Transcript、恢复链和 stale writer。源码快照没有提供一个覆盖上述四步的原子事务，因此教材必须准确描述已有的顺序和恢复技巧，同时把更强的事务语义明确标成 H3-2 clean-room 设计迁移。

主体目标为 4 至 7 小时，实践与故障注入另计。

## Graphify 候选与直接核验

已查询：

```text
compact autocompact summary messages boundary transcript session resume retry cancel context collapse
```

Graphify 用于把阅读范围收敛到 `query.ts`、`services/compact/`、`useLogMessages.ts` 和 `sessionStorage.ts`。图中的结构可达关系没有直接写入结论；以下调用和状态均重新核对源码。

## 第一条运行链：为什么会触发 auto compact

`src/services/compact/autoCompact.ts`：

```text
queryLoop(messagesForQuery)
-> autoCompactIfNeeded()
-> shouldAutoCompact()
-> tokenCountWithEstimation(messages) - snipTokensFreed
-> calculateTokenWarningState()
-> threshold exceeded
-> trySessionMemoryCompaction()
-> traditional compactConversation() fallback
```

关键事实：

- `getEffectiveContextWindowSize()` 先为摘要输出保留 headroom；auto threshold 再减 buffer。它不是“到模型最大窗口才开始压缩”。
- `shouldAutoCompact()` 对 `session_memory`、`compact` 等 query source 有递归保护，并受用户配置、环境变量、reactive/context-collapse gate 影响。
- `AutoCompactTrackingState.consecutiveFailures` 是会话内失败熔断计数；短路逻辑属于 `autoCompactIfNeeded()`，不属于只负责 gate/threshold decision 的 `shouldAutoCompact()`。达到阈值后停止重复发起注定失败的 compact。
- auto path 先尝试 Session Memory compact，失败或不适用才进入 traditional compact。
- traditional compact 抛错时，`autoCompactIfNeeded()` 通常返回 `wasCompacted: false`，Query Loop 继续使用原 `messagesForQuery`，同时更新失败计数。

## 第二条运行链：traditional compact 的准备阶段

`src/services/compact/compact.ts -> compactConversation()` 的决定性顺序：

```text
PreCompact hooks
-> 组装 compact prompt 与 summary request
-> cache-sharing fork
-> 必要时 streaming fallback
-> prompt-too-long 分组裁头重试
-> 验证 summary 文本
-> snapshot readFileState
-> clear readFileState / loadedNestedMemoryPaths
-> 重建 file/agent/plan/skill/tool/MCP attachments
-> SessionStart hooks
-> 创建 boundary + summary message
-> telemetry / cache baseline / metadata re-append
-> PostCompact hooks
-> 返回 CompactionResult
```

### 摘要请求不是普通 Tool Loop

`streamCompactSummary()` 优先调用 `runForkedAgent()` 共享 Prompt Cache。它把同一个 `abortController` 传给 fork，限制 `maxTurns: 1`，并通过 `createCompactCanUseTool()` 拒绝工具执行。若 fork 没有得到可用文本或发生异常，则进入 `queryModelWithStreaming()` fallback；fallback 同样使用 `context.abortController.signal`，system prompt 固定为摘要任务，并禁用 thinking。

因此可教的结论是：compact summary 是受限的独立模型请求，不是原 Query Loop 中任意继续执行工具的 assistant turn。

### prompt-too-long 重试改变的是摘要输入

`truncateHeadForPTLRetry()` 按 API round group 从最老部分开始丢弃，至少保留一组。若裁切后 assistant 位于首部，则插入 synthetic user marker；后续 pairing 逻辑负责避免 orphan result。fork path 的 `forkContextMessages` 与普通 messages 输入同时换成 truncated set。

这个重试只保证“仍有可总结输入”，不等于被裁掉的最老内容已被另一份摘要保存。教材必须把它解释为失败恢复中的信息损失权衡。

## 普通 hook 失败为什么通常不构成事务回滚

`src/utils/hooks.ts -> executeHooksOutsideREPL()` 把 command/callback/http hook 的超时、取消、非零退出和解析错误转换成 `HookOutsideReplResult`。`executePreCompactHooks()` 与 `executePostCompactHooks()` 再把结果格式化为 instruction 或 display message。

因此：

- 普通 PreCompact hook 失败不会自动阻止摘要；只有成功且非空的输出会进入 custom instructions。
- 普通 PostCompact hook 失败通常只进入用户可见文本，不会让已经完成的摘要回滚。
- 已 abort 的 hook 通常返回 cancelled result，而不是把 abort 继续抛给 `compactConversation()`。
- 外层基础设施仍可能在 `getMatchingHooks()` 等非逐 hook 边界抛错，所以不能绝对声称“hook 永不让 compact 失败”。

这是事实闸门必须复核的边界。教材不把 hook 的 `decision: block` 类比成数据库回滚。

## 最危险的失败窗口：摘要成功后还有可变副状态

traditional compact 在 summary 文本通过校验后执行：

```text
preCompactReadFileState = cacheToObject(context.readFileState)
context.readFileState.clear()
context.loadedNestedMemoryPaths?.clear()
```

随后才异步重建附件、运行 SessionStart、创建 post-compact payload 并执行 PostCompact hooks。如果附件或 SessionStart 基础设施在此后失败，`compactConversation()` 会抛错而没有 `CompactionResult`，但 `readFileState` 与 nested-memory path 状态已经被清除。

因此快照事实只能表述为：

- 原 messages 数组尚未被 `compactConversation()` 直接替换；
- 部分辅助内存状态可能已经变化；
- auto path 会回到原 query view，但不能宣称整个系统状态原封不动；
- `finally` 只恢复 UI/SDK compact 状态，不恢复这些缓存。

H3-2 不复制这个窗口。clean-room 方案应先生成不可变 plan，把可回滚准备与不可回滚提交分开。

## `CompactionResult` 不是 durable commit

`buildPostCompactMessages()` 的顺序固定：

```text
boundaryMarker
-> summaryMessages
-> messagesToKeep
-> attachments
-> hookResults
```

`src/query.ts -> queryLoop()` 在拿到 `compactionResult` 后：

1. 建立 `postCompactMessages`；
2. 逐条 `yield`；
3. 把本 iteration 的 `messagesForQuery` 指向新数组；
4. 继续当前请求，而不是要求用户重新输入。

这说明 `CompactionResult` 是“可提交的替换计划已准备好”，Query Loop 的 view replacement 才让当前请求开始使用新历史。但这两个动作仍不等于 JSONL 已落盘。

manual `/compact` 经 command path 返回同一个 post-compact 顺序，并把 synthetic caveat、slash command user message 和 display message追加到 `messagesToKeep`；命令本身不继续触发模型查询。

## Session Memory compact：保留尾段而不是重新调用摘要模型

`src/services/compact/sessionMemoryCompact.ts`：

- 读取现有 Session Memory；空文件、模板内容、summarized ID 丢失等情况返回 `null`，让 traditional compact 接管。
- `calculateMessagesToKeepIndex()` 从已总结位置之后开始，并向前扩展到 token/text minimum；不会跨过最近 compact boundary。
- `adjustIndexToPreserveAPIInvariants()` 向前纳入 tool_use/tool_result pair 和共享 response ID 的 thinking fragments。
- 生成 boundary、Session Memory summary message、少量 attachment 与 SessionStart hook result。
- 若 post-compact estimate 仍超过 auto threshold，则返回 `null`。

它通过 `annotateBoundaryWithPreservedSegment()` 写入：

```text
headUuid
anchorUuid
tailUuid
```

这些不是消息内容摘要，而是 resume 时把已存在于 JSONL、仍保留旧 `parentUuid` 的尾段重新接到新 summary 后面的 relink metadata。

## Transcript 写入：append-only、排队和链重建

### 写入 owner

交互式路径由 `src/hooks/useLogMessages.ts` 观察 messages 数组。compact 改变首 UUID 时，它把完整 post-compact 数组交给 `recordTranscript()`，但调用是 fire-and-forget。SDK/Headless 的 `QueryEngine` 在非 bare 路径会等待 `recordTranscript()` 完成清理、去重、入队和可能的 remote persistence；由于 local `appendEntry()` 仍以 `void enqueueWrite()` 排队，这个 await 也不等于 local file append 已完成。eager/cowork 等模式才在相应边界继续显式 flush。

`recordTranscript()`：

- 清理不可记录消息；
- 用 session message set 去重；
- compaction 后 boundary/summary 是新消息，`messagesToKeep` 已存在于磁盘；
- 一旦遇到新 boundary，后面的 dedup-kept messages 不再被当作 prefix parent；
- 把真正的新消息交给 `insertMessageChain()`。

`insertMessageChain()` 对 compact boundary 写 `parentUuid: null`，把旧 parent 只保存在 `logicalParentUuid`。summary 再以 boundary 为 parent。于是恢复主链从结构上被新 boundary 截断，而不是物理删除旧 JSONL 行。

### 排队不等于落盘

`Project.appendEntry()` 调用 `enqueueWrite()`，但大多数分支使用 `void`，所以 `insertMessageChain()` 完成通常只说明消息完成去重、组装和入队，不说明 `fs.appendFile` 已结束。

每个文件有一个 queue；默认约 100ms 后 drain。一次 drain 会把队列中的多行串成 content，并通过一次或多次 append 写入。因此 boundary 与 summary 在正常调度下常会落入同一批 append，但源码没有：

- compact transaction record；
- write-ahead prepare/commit marker；
- checksum/framing；
- `fsync`；
- SIGKILL 下的 durable guarantee。

`Project.flush()` 会取消 timer、等待 active drain、drain 剩余队列，并等待其他 tracked write；graceful shutdown 注册了 flush，QueryEngine 也在多个边界显式 flush。但突然进程终止仍可能截断最后一行或只留下部分 post-compact 序列。

`parseJSONL()` 对 malformed 或 crash-truncated 行采取 skip，因此不完整 summary 行不会让整个文件解析失败，但也不会成为有效恢复消息。graceful shutdown 虽优先运行 session cleanup，外层对 cleanup 仍有约 2 秒等待预算；不能把正常退出优化扩大成 hard-crash guarantee。

## Resume：已有的结构修复与仍需缩小的结论

`loadTranscriptFile()` 解析 JSONL 后执行 `applyPreservedSegmentRelinks()`：

1. 找到绝对最后 boundary 与最后带 preserved segment 的 boundary；
2. 若 segment 仍 live，从 `tailUuid` 沿旧 parent 链走到 `headUuid`；
3. 完整验证后再把 head 接到 anchor，并把 anchor 的其他 child 接到 tail；
4. preserved assistant usage 归零，避免 resume 后立即再次 compact；
5. 删除最后 boundary 之前、且不在 preserved set 的旧消息。

如果 preserved metadata malformed、tail-to-head 断裂或 UUID 不存在，函数在 prune 前返回，保留完整 pre-compact history。这是明确的 fail-open-to-history 恢复策略：宁可加载更多历史，也不静默丢掉保存尾段。

没有 preserved segment 的 traditional compact 主要依靠 boundary 的 `parentUuid: null` 截断可达链；大文件 reader 还会从最后 non-preserved boundary 开始截取缓冲区。

### boundary-only 崩溃窗口

当前源码没有显式 recovery state 判断“boundary 已写而 summary 未写”。初步推导：

- 小文件完整解析时，旧 user/assistant entries 仍在 Map 中；孤立 system boundary 不会成为 user/assistant leaf，resume 可能退回旧链。
- 大文件 pre-boundary skip 会直接丢弃 boundary 之前的 message buffer；若 boundary 后没有有效 user/assistant leaf，loader 可能得到“没有有效 conversation chain”。
- 截断 JSONL 行会被 `parseJSONL()` 如何处理、上层 picker 如何回退，需要事实闸门或 clean-room 故障注入进一步限定。

在核验前，教材不承诺 boundary-only 一定回退原历史，也不声称一定暴露截断链。

## 状态所有权表

| 状态 | Owner | 主要修改者 | 观察者/消费者 |
|---|---|---|---|
| 当前 Query view | `queryLoop State.messages/messagesForQuery` | compact transition / next state | request projection、Tool Loop |
| summary request | `compactConversation()` 局部状态 | compact fork/stream | summary validation、result builder |
| `readFileState` | `ToolUseContext` | Read tool、compact clear | post-compact attachment builder |
| auto failure count | `AutoCompactTrackingState` | `autoCompactIfNeeded()`/query transition | next Query iteration |
| preserved segment metadata | compact boundary | session-memory/partial/reactive result builder | Transcript loader |
| Transcript message set | `Project` session cache | `appendEntry()`/load | dedup、parent construction |
| JSONL write queue | `Project.writeQueues` | `enqueueWrite()`/drain/flush | filesystem append |
| restored chain | `loadTranscriptFile()` Map | relink/prune/build chain | resume/continue |

## 事实状态

- `快照事实`：auto threshold、traditional compact 顺序、summary fork/fallback、PTL retry、post-compact ordering、query continuation、append-only Transcript、write queue、preserved relink 与 malformed fallback。
- `快照事实但保证较弱`：`CompactionResult` 前存在辅助状态清理；Transcript enqueue 与 durable append 分离；graceful flush 不能覆盖 hard crash。
- `快照缺口`：`reactiveCompact.ts`、`contextCollapse/index.ts` 及部分 gated tests/implementation 不存在，不能描述其内部事务。
- `待事实闸门限定`：boundary-only、summary-only、不完整 JSONL 行在不同文件大小和 resume 入口下的精确结果。
- `运行验证`：M17 双语言故障注入只验证 clean-room CompactTransaction 行为，不反向证明 Claude Code 私有实现。
- `设计迁移`：revision-gated plan、explicit commit state、summary provenance、repair report 和 original-history fallback 属于 H3-2。

## 实验假设与反证条件

将实现一个独立 `CompactTransaction` 状态机：

```text
IDLE
-> PREPARING(summary + retained tail + provenance)
-> PREPARED(expected revision)
-> COMMITTING
-> COMMITTED(new revision)

任意 prepare 失败/取消 -> original history unchanged
stale expected revision -> reject
partial durable record -> recovery report + original-history fallback
complete commit record -> boundary + summary + retained tail
```

必须验证：

1. summary 生成阶段取消不改变 ConversationStore；
2. prepared plan 在 commit 前取消不改变 owner revision；
3. 两个相同 revision 的 plan 只有一个能提交；
4. boundary-only、summary-only、malformed provenance 都回退原 history并给出 repair report；
5. complete commit 恢复得到相同 post-compact view；
6. tool_use/result pair 不因 retained-tail boundary 被拆开；
7. report 不包含 summary 或用户内容，只包含 ID、revision、计数和 reason。

反证条件：任何失败让 owner messages 部分替换；stale plan 覆盖新状态；恢复静默丢消息；repair report 泄露正文；TypeScript/Python 观察结果不一致。

## H3-2 候选契约

计划合入：

- runtime-owned `CompactCoordinator`；
- `CompactPlan(expectedRevision, sourceRange, retainedTail, summary, provenance)`；
- prepare 与 commit 分离，commit 前 strict validation；
- `ConversationStore` expected revision gate；
- explicit durable record phases 或等价的单记录 committed envelope；
- recovery 返回 `restored | fell_back | repair_required`；
- original-history fallback；
- metadata-only Trace/report。

继续 defer：真实 tokenizer、Provider summary client、完整 Transcript JSONL、Session Memory extraction、Prompt Cache edit、distributed lease 和跨进程 WAL。

拒绝：原地清空后再构造摘要、boundary 到达即视为 committed、无 revision 的 late writer、只记录 summary 不记录 source provenance、恢复失败时静默返回截断链。

## 事实闸门重点

1. `CompactionResult`、query view replacement、Transcript enqueue、append 与 resume-visible chain 的准确边界；
2. Pre/PostCompact 普通失败和取消是否阻断；
3. summary 之后附件/SessionStart/PostCompact 失败能留下哪些副状态；
4. query/manual/session-memory 三条 replacement path 的差异；
5. queue batching、flush、graceful shutdown 与 crash durability 的上限；
6. preserved segment relink 与 malformed fallback；
7. boundary-only/summary-only/partial-line 恢复能否从源码确定；
8. H3-2 是否把迁移设计误写成快照实现。
