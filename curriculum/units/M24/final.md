# M24 进程退出后，Agent 为什么还能继续：Transcript、Resume、Fork 与恢复事务

你在终端里让 Agent 创建一个工单。工具已经向工单系统发出了 `POST`，终端却在返回结果前被系统杀掉。重新运行 Claude Code 并恢复会话后，界面里还能看到之前的对话，模型也可以继续回答。

这时最危险的一句话是：

> “既然对话恢复了，刚才的工具调用当然也恢复了。”

不是。恢复出一段能够继续送给模型的消息历史，与确认一个外部副作用到底有没有发生，是两种完全不同的能力。

本单元要沿一次真实崩溃把这条界线看清。我们先追踪消息怎样进入 JSONL，再看一个看似线性的日志为什么会形成 DAG；随后让读取器面对半写尾行、断裂 parent、并行 Tool Loop 和中断轮次；最后把 Normal Resume、Fork、后台 Agent、Cron pending trigger 与企业级 effect journal 接起来。你会得到的不只是“会话恢复”知识，而是一套能迁移到订单、RAG ingestion、异步工作流和多 Agent 平台的恢复方法。

先把整条路看见：

~~~mermaid
flowchart TD
  INPUT["用户消息被接受"] --> REC["recordTranscript 请求记录"]
  REC --> QUEUE["Project 内存写队列"]
  QUEUE --> APPEND["JSONL append"]
  APPEND --> CRASH["任意位置可能崩溃"]
  CRASH --> PARSE["逐行解析可用记录"]
  PARSE --> DAG["选择 leaf 并重建消息 DAG"]
  DAG --> CLEAN["清理未配对 Tool 与无效尾部"]
  CLEAN --> KIND{"Normal 还是 Fork"}
  KIND -->|"Normal"| ADOPT["复用 session 与 transcript"]
  KIND -->|"Fork"| ISOLATE["新 session 与身份隔离"]
  ADOPT --> OWNERS["各状态 owner 分别恢复"]
  ISOLATE --> OWNERS
  OWNERS --> EFFECT["副作用按 prepared / indeterminate / committed 分类"]
  EFFECT --> CONTINUE["继续、人工裁决或幂等重投"]
~~~

这张图只给地图。接下来每增加一种状态或失败语义，我们都会在它附近重新画一张更小的图。

## 先分清三样东西：历史、运行和事实

初学者很容易把“Agent 状态”想成一个可以序列化的大对象。真实系统通常不是这样。

第一样是 **Transcript 历史**。它回答“哪些事件被记录了、消息之间怎样相连”。Claude Code 快照的主载体是 append-only JSONL。

第二样是 **当前运行状态**。例如 live `AbortController`、正在读的 stream、子进程句柄、内存队列和 UI task。它们属于进程，进程退出后不能从 JSONL 里原样复活。恢复时只能创建一个新的 attempt。

第三样是 **外部世界的事实**。文件是否真的改完、工单是否已经创建、支付接口是否已经扣款，不由 Transcript 单方面决定。Transcript 最多记录“我准备调用”“我开始调用”“我收到结果”；如果崩溃发生在外部成功与本地提交之间，事实就是不确定的。

~~~mermaid
flowchart LR
  T["Transcript\n消息与事件证据"] --> R["Recovery Reducer\n重建可继续视图"]
  LIVE["旧进程运行状态\ncontroller/stream/process"] -. "不能反序列化复活" .-> R
  WORLD["外部副作用\n文件/API/数据库"] --> J["Effect Journal\n提交证据"]
  J --> R
  R --> NEW["新 attempt"]
  NEW --> WORLD
~~~

这一区分会贯穿全章：Transcript 是证据之一，不是宇宙真相；Resume 是重建，不是时间倒流。

## 用户消息“已经记录”到底意味着什么

在 Headless/SDK 路径，`QueryEngine.submitMessage()` 接受用户输入后，会在进入模型 query loop 之前调用 `recordTranscript(messages)`。这个顺序很重要：如果连用户消息都没记录，进程在等待模型时退出，下一次启动连“用户刚才问了什么”都不知道。

但“先调用记录函数”仍不等于“此刻已经耐久落盘”。真正的链路在：

```text
src/QueryEngine.ts -> QueryEngine.submitMessage()
src/utils/sessionStorage.ts -> recordTranscript()
src/utils/sessionStorage.ts -> Project.insertMessageChain()
src/utils/sessionStorage.ts -> Project.appendEntry()
src/utils/sessionStorage.ts -> Project.enqueueWrite()
src/utils/sessionStorage.ts -> Project.drainWriteQueue()
src/utils/sessionStorage.ts -> Project.appendToFile()
```

### Project 为什么先不创建文件

`Project` 拥有当前 `sessionFile`、待物化 metadata、每文件写队列、flush timer 和 drain 状态。新进程刚启动时，`sessionFile` 可以还是 `null`。mode、agent setting、hook attachment 等记录先进入 `pendingEntries`；只有第一次出现 user/assistant message，`materializeSessionFile()` 才真正确定文件、写 metadata 并放出缓冲记录。

这解决一个现实问题：用户只运行了一条本地命令、打开后立刻退出，或者初始化阶段只产生 metadata，不应该在 Resume 列表里留下大量“没有对话的空会话”。

~~~mermaid
stateDiagram-v2
  [*] --> Unmaterialized: Project 创建
  Unmaterialized --> Unmaterialized: metadata / hook 进入 pendingEntries
  Unmaterialized --> Materializing: 首条 user 或 assistant
  Materializing --> Active: 确定 sessionFile 并释放 pendingEntries
  Active --> Active: message / metadata 进入写队列
  Active --> Flushed: 显式 flush 或 cleanup
  Flushed --> Active: 后续仍可 append
~~~

这里第一次遇到一个 Node/TypeScript 难点：**一个 `async` 函数返回 Promise，不代表它内部发起的所有异步工作都属于这个 Promise。**

`appendEntry()` 的多数分支采用这种形状：

```ts
void this.enqueueWrite(sessionFile, entry)
```

`enqueueWrite()` 自己返回一个“该 entry 写完时才 resolve”的 Promise，但调用点用 `void` 明确丢弃了它。因此：

```ts
await recordTranscript(messages)
```

等待的是清理、去重、构造 entry 和“把写请求放进队列”等上层工作，不必然等待底层 `appendFile`。队列由一个约 100ms 的 timer 批量 drain。这样减少每个 content block 都触发磁盘系统调用的成本，也让同一文件内的写入保持顺序，但制造了一个清楚的 crash window。

Java 中最接近的误解，是一个 `CompletableFuture` 回调内部又把任务提交给 executor，却没有把那个 future 返回到外层；Python 中则像 `asyncio.create_task(write())` 后外层 coroutine 立即返回。`await` 只等待 Promise 链里真正连接起来的工作。

~~~mermaid
sequenceDiagram
  participant Q as QueryEngine
  participant P as Project
  participant M as Memory Queue
  participant F as JSONL File
  Q->>P: await recordTranscript(messages)
  P->>M: void enqueueWrite(entry)
  P-->>Q: recordTranscript resolve
  Note over Q,F: 此处进程崩溃，entry 仍可能只在内存
  M->>F: timer 后 append batch
  F-->>M: append 完成
~~~

### flush 到底加强了什么

`Project.flush()` 会：

1. 取消尚未触发的 timer；
2. 等待正在执行的 drain；
3. 立即 drain 剩余队列；
4. 等待少数由 `trackWrite()` 跟踪的非队列操作。

cleanup handler 的顺序是先 `flush()`，再 `reAppendSessionMetadata()`。后者把 title、tag、last prompt、agent、mode、worktree state 等重新放到文件尾部，让只读 tail window 的 Resume 索引仍能找到它们。如果先同步写 metadata、后 drain 旧消息，metadata 可能被旧批次压到前面，甚至让顺序难以解释。

但是严格说，`appendFile` resolve 仍不是数据库 WAL 的 fsync commit，也不是远程副本 quorum，更不是“工具副作用与 Transcript 同一事务”。教材中只写到源码能够证明的边界：flush 等到当前进程的 append 操作完成。

~~~mermaid
flowchart LR
  A["recordTranscript resolve"] --> B["entry 已进入 Project 控制"]
  B --> C["flush resolve"]
  C --> D["本地 append 操作完成"]
  D -. "不能自动推出" .-> E["断电后必然保留"]
  D -. "不能自动推出" .-> F["远程副本已提交"]
  D -. "不能自动推出" .-> G["外部工具 exactly-once"]
~~~

这不是抠字眼。你在企业系统设计面试里说“await 了所以持久化了”，面试官通常会继续问：await 的是哪一个 future？有没有 fsync？有没有事务边界？崩溃发生在 future resolve 前后分别怎样？

## JSONL 为什么适合恢复，又为什么不够

JSONL 每行一个独立 JSON object。与把整个会话反复写成一个巨大 JSON array 相比，append-only 有三个直接收益：

- 新事件只需追加，不必重写全部历史；
- 已完成行天然形成可恢复前缀；
- metadata、message、compact commit 等不同 entry 可以共享时间顺序。

`src/utils/json.ts -> parseJSONL()` 对 Buffer/String/Bun 三条路径都按行解析。某一行 `JSON.parse` 失败时，它跳过该行，继续读下一行。于是崩溃只写出：

```text
{"type":"user", ...完整...}\n
{"type":"assistant","uuid":"abc"
```

第二行会被丢弃，第一行仍能恢复。这是 append-only 的可用性优势。

~~~mermaid
flowchart TD
  BYTES["JSONL bytes"] --> L1["完整行 1"]
  BYTES --> L2["坏的中间行 2"]
  BYTES --> L3["完整行 3"]
  BYTES --> TAIL["半写尾行 4"]
  L1 --> KEEP["保留"]
  L2 --> DROP["跳过并报告"]
  L3 --> KEEP
  TAIL --> PARTIAL["忽略 partial tail"]
  DROP --> RISK["可能产生 dangling parent"]
~~~

但不要把“其余行能读”说成“会话完整”。如果坏掉的是中间 parent：

```text
m1 <- m2 <- m3
       ^
       这一行损坏
```

那么 `m3.parentUuid = m2` 仍然存在，Map 里却没有 `m2`。链会在 `m3` 截断。Claude Code 的读取器偏向 availability：坏行不让整个文件报废；企业 Harness 还应在 recovery report 中暴露 `malformedLineNumbers`、`partialTailIgnored`、`danglingParentIds` 和 `completeChain=false`，让上层知道“能继续”不等于“证据无缺口”。

另一个边界是 `loadTranscriptFile()` 外层对文件读取/处理错误的 catch：失败时返回已经初始化的空 maps。这个设计让 Resume 列表或调用者可以降级，但同样要求上层不要把“空”误认成“用户确实没有历史”。

## 一行一条消息，为什么最后却是 DAG

如果每次只有“用户一句、助手一句”，`parentUuid` 看起来像单链表：

```text
u1 <- a1 <- u2 <- a2
```

Tool Loop 改变了拓扑。流式模型可能为同一个 provider assistant message 的多个 content block 生成多条本地 AssistantMessage。两个并行 `tool_use` 各自有 assistant UUID，各自的 `tool_result` 又指回对应 assistant。它们共享逻辑起点，却形成分支。

~~~mermaid
flowchart LR
  U1["u1"] --> A1["assistant block A\ntool_use t1"]
  A1 --> A2["assistant block B\ntool_use t2\n同一 provider message.id"]
  A1 --> TR1["tool_result t1"]
  A2 --> TR2["tool_result t2"]
  TR1 --> NEXT["下一轮消息"]
  TR2 -. "并行 sibling" .-> NEXT
~~~

从 `NEXT` 沿单一 `parentUuid` 反向走，可能只经过 `TR1 -> A1`，遗漏 `A2/TR2`。所以 `buildConversationChain()` 完成逆向主链后，还调用 `recoverOrphanedParallelToolResults()`：

1. 找出主链上的 assistant；
2. 以 provider `message.id` 把 sibling assistant 分组；
3. 以 tool_result 的 assistant parent 建索引；
4. 把 off-chain sibling 和其 tool result 插到最后一个 on-chain group member 附近；
5. 保持 tool use 在 result 前面。

这是一条很值得迁移的设计思想：**持久层可以保存自然产生的图，读取层再投影出协议所需的顺序视图。** 强行在写入时把所有并行结果塞成单链，反而需要等待、锁和跨工具协调，容易拖慢流式路径。

### leaf、cycle 与 dangling parent

`loadTranscriptFile()` 先找出没有 child 的 terminal message，再向上找到最近的 user/assistant，得到候选 leaf。`loadFullLog()` 通常从最新 user/assistant leaf 恢复；分析类调用可以保留所有 leaves。

`buildConversationChain()` 从 leaf 反向走，维护 `seen`：再次遇到同一 UUID 就记录 cycle 并返回 partial chain。遇到不存在的 parent 时，Map lookup 得到 `undefined`，链自然结束。

~~~mermaid
stateDiagram-v2
  [*] --> ReadLeaf
  ReadLeaf --> AddCurrent: 未访问
  AddCurrent --> RootDone: parentUuid = null
  AddCurrent --> ReadParent: parent 存在
  AddCurrent --> Dangling: parent 不存在
  ReadParent --> Cycle: parent 已在 seen
  ReadParent --> AddCurrent: 新 parent
  RootDone --> ParallelPass
  Dangling --> ParallelPass: 返回 partial
  Cycle --> ParallelPass: 返回 partial
  ParallelPass --> [*]
~~~

注意，Claude Code 会记录 cycle 事件，但 dangling parent 本身主要表现为链截断。H6 把两者都变成显式 recovery metadata，不让上层误判完整性。

### Compact 和 Snip 为什么还需要读侧修复

append-only 意味着旧消息通常仍在物理文件中。Compact boundary 通过新 summary 和边界改变“以后应该投影哪段历史”，而不是逐行删除旧 bytes；preserved segment 还可能保留边界前的一小段关键消息。Snip 同样通过记录移除语义让读侧排除旧节点。

因此 `loadTranscriptFile()` 在计算 leaves 之前执行 preserved-segment relink 与 Snip removal。否则旧 parent 仍把链拖回已经压缩的历史，或者 preserved tail 因磁盘 parent 关系没有改变而变成 orphan。

~~~mermaid
flowchart LR
  RAW["append-only 原始 entries"] --> BOUNDARY["Compact/Snip 边界解释"]
  BOUNDARY --> RELINK["preserved segment relink"]
  BOUNDARY --> REMOVE["Snip removal"]
  RELINK --> VIEW["恢复时消息图"]
  REMOVE --> VIEW
  VIEW --> LEAF["leaf + chain"]
~~~

这里和 M17 的 Compact transaction 接上了：Compact 不只是当轮少发 token；如果它不能在 Resume 时重建相同投影，下一次启动就可能把全部旧历史重新送进模型，既超预算又破坏 prompt cache。

## “没有 tool_result”不是“工具没有执行”

读取出候选消息链后，`deserializeMessagesWithInterruptDetection()` 还要把它变成 API 可以接受的历史。第一步是 `filterUnresolvedToolUses()`。

它遍历所有 user/assistant content blocks，分别收集 `tool_use.id` 与 `tool_result.tool_use_id`。如果某条 assistant message 的 **全部** tool use 都没有任何 result，这整条 assistant message 被删除。

要留意一个决定性细节：函数不检查该 assistant 是否还包含有意义 text。若一条 message 是：

```text
[ text("我先创建工单"), tool_use(id=t1) ]
```

而 `t1` 没有 result，整条 message 都会消失，text 也一起消失。若同一条 message 同时有一个 resolved 和一个 unresolved tool use，因为不是“全部 unresolved”，整条 message 会保留。教材不能把函数描述成一个完美的 block-level 修复器；它是 message-level 防御，适配当前流式消息形状，但有清楚边界。

~~~mermaid
flowchart TD
  A["assistant message"] --> USES["收集本 message 的 tool_use IDs"]
  USES --> NONE{"没有 tool_use?"}
  NONE -->|"是"| KEEP["保留"]
  NONE -->|"否"| ALL{"是否全部缺少 tool_result?"}
  ALL -->|"是"| DROP["删除整条 assistant message"]
  ALL -->|"否"| KEEP
  DROP --> NOTE["不能据此判断外部副作用未发生"]
~~~

随后还会过滤 orphan thinking-only 与 whitespace-only assistant，避免恢复后请求被无配对 thinking 或只有换行的尾部污染。

为什么不把 unresolved tool use 直接重新执行？因为日志缺失无法回答外部世界发生了什么。工具可能：

- 根本没开始；
- 开始但失败；
- 成功改变外部系统，只来不及写 result；
- 部分成功，无法原子回滚。

自动重跑第三、第四种会复制副作用。Claude Code 快照选择不把 unresolved tool use 原样重新送给模型执行；企业系统则需要比“删除消息”更强的 effect journal。

## Interrupted prompt 与 interrupted turn 不是一回事

过滤后，`detectTurnInterruption()` 查看最后一条与轮次相关的消息，并跳过 system、progress 和 synthetic API error。

- 最后是有效 assistant：通常认为轮次完成。流式持久消息上的 `stop_reason` 可能仍为 null，因此不能只靠 stop_reason。
- 最后是普通 user：模型还没有形成回复，叫 interrupted prompt。
- 最后是非终止 tool_result：说明 Tool Loop 后仍应继续模型，但下一 assistant 没出现，叫 interrupted turn。
- 最后是 attachment：同样是用户轮次尚未完成。
- 某些本身终止轮次的 tool result 会被特殊排除，避免每次 Resume 都注入虚假的 Continue。

~~~mermaid
flowchart TD
  LAST["最后 turn-relevant message"] --> KIND{"类型"}
  KIND -->|"assistant"| DONE["none / completed"]
  KIND -->|"普通 user"| PROMPT["interrupted_prompt"]
  KIND -->|"非终止 tool_result"| TURN["interrupted_turn"]
  KIND -->|"attachment"| TURN
  KIND -->|"terminal tool_result"| DONE
  TURN --> META["追加 meta Continue user"]
  PROMPT --> SENTINEL["在尾部 user 后插 assistant sentinel"]
  META --> SENTINEL
~~~

mid-turn 会先被统一转换成一条 meta user：“Continue from where you left off.”。只要清理后的最后相关消息是 user，恢复器就在它后面插一个 synthetic assistant sentinel。这样即使调用者不自动继续，历史也维持 user/assistant 交替，不会把裸 user 尾部直接发给要求严格配对的 API。

### Headless 自动恢复做了什么，没做什么

当 `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` 开启，`print.ts` 会：

1. 在内存消息中找到 interrupted user；
2. 删除它与紧随其后的 sentinel；
3. 以新 queue item 把同一内容 enqueue 一次；
4. 让正常输入队列再次驱动 query。

~~~mermaid
sequenceDiagram
  participant D as Deserialize
  participant M as mutableMessages
  participant Q as Input Queue
  participant L as Query Loop
  D->>M: interrupted user + sentinel
  M->>M: removeInterruptedMessage splice 两项
  M->>Q: enqueue prompt once in this process
  Q->>L: 正常 drain
  Note over Q,L: 再次崩溃时没有 durable ack 证明已经处理
~~~

源码注释中的“model sees it exactly once”必须放回这个局部上下文理解：这次启动的内存数组不会同时保留旧 user 又 enqueue 新 user。它不是跨多次崩溃的 durable exactly-once，也不是外部工具 exactly-once。

## Resume 不是一个函数恢复所有状态

`loadConversationForResume()` 负责集中加载与消息反序列化，真正接管状态时却分散给各 owner。

读路径大致是：

```text
loadConversationForResume()
-> loadMessageLogs / getLastSessionLog / JSONL path
-> loadFullLog()
-> loadTranscriptFile()
-> buildConversationChain()
-> deserializeMessagesWithInterruptDetection()
-> processResumedConversation() 或 restoreSessionStateFromLog()
```

恢复的内容包括：

| 状态 | owner 如何恢复 | 为什么不能只塞进 Message[] |
| --- | --- | --- |
| file history | snapshot chain 交回 file-history store | 用于 rewind 与外部修改检测 |
| attribution | attribution snapshots 重建 | 它是提交归因状态，不是模型对话 |
| todo | 从最后 TodoWrite tool input 提取 | Headless AppState 需要自己的索引 |
| context collapse | ordered commits + last snapshot | 压缩投影必须跨进程一致 |
| content replacement | records 重建 replacement/seen state | 决定下一请求发 full result 还是 preview |
| session metadata | tag/title/agent/mode/worktree/PR 等 cache | 供状态页、恢复和后续尾部重写 |
| agent/model | bootstrap owner 重新设置 | 定义下一轮 system/tool/model 行为 |
| cost | cost tracker 按 session 接管 | 不能从单条 assistant usage 猜总成本 |
| plan/skill | 定向复制或从消息 attachment 恢复 | 它们各有生命周期与作用域 |

~~~mermaid
flowchart TB
  LOG["LogOption / Transcript projection"] --> MSG["Message history owner"]
  LOG --> FH["FileHistory owner"]
  LOG --> ATTR["Attribution owner"]
  LOG --> COLLAPSE["ContextCollapse owner"]
  LOG --> REPL["ContentReplacement owner"]
  LOG --> META["Session metadata owner"]
  LOG --> COST["Cost tracker"]
  LOG --> AGENT["Agent/model bootstrap"]
~~~

这是企业设计里非常有价值的模式：ResumeCoordinator 负责顺序和边界，不永久拥有所有业务状态。每个 owner 提供自己的 `restoreFromEntries/snapshot`，既可以独立演进 schema，也可以独立测试清空旧 session 遗留状态。

### worktree 的恢复为什么用 chdir

Transcript 可能记录“上次退出时仍在某个 worktree”。下一次启动时目录可能已经被用户删除。先 `exists()` 再 `chdir()` 会有 TOCTOU：检查后、使用前仍可能消失。

`restoreWorktreeForResume()` 直接调用 `process.chdir(worktreePath)`。成功才更新 cwd owner；失败就把缓存改成 `null`，让下次 metadata re-append 明确记录“已经退出”，而不是反复保存一个死路径。

~~~mermaid
flowchart LR
  META["Transcript worktree state"] --> FRESH{"本次 CLI 已创建 fresh worktree?"}
  FRESH -->|"是"| KEEP["fresh state 优先"]
  FRESH -->|"否"| CD["process.chdir(saved path)"]
  CD -->|"成功"| RESTORE["更新 cwd/worktree owner"]
  CD -->|"失败"| EXITED["记录 null 并留在可用 cwd"]
~~~

注意它没有恢复旧进程里的 open file descriptor 或 shell process。恢复的是逻辑工作目录选择。

## Normal Resume 与 Fork 的身份语义

Normal Resume 的目标是“继续同一会话”：复用 session ID，重新指向原 JSONL，让后续消息继续 append。`resetSessionFilePointer()` 先清掉进程启动时的临时路径，`switchSession()` 改 bootstrap identity，`restoreSessionMetadata()` 重建 cache，worktree 恢复后 `adoptResumedSessionFile()` 接管原文件。

Fork 的目标是“从同一历史开始另一条未来”：保留启动时 fresh session ID，不接管原 worktree。`branch.ts -> createFork()` 读取原 entries，过滤主会话消息，重写 session ID，按复制顺序重建 parent chain，并保存 `forkedFrom` 追踪。

~~~mermaid
flowchart TD
  SOURCE["source session S1"] --> MODE{"恢复模式"}
  MODE -->|"Normal"| N1["sessionId = S1"]
  N1 --> N2["adopt S1.jsonl"]
  N2 --> N3["可接管 saved worktree"]
  MODE -->|"Fork"| F1["sessionId = fresh S2"]
  F1 --> F2["写 S2.jsonl + forkedFrom"]
  F2 --> F3["不接管 S1 worktree owner"]
~~~

### 为什么 Fork 还要复制 content-replacement record

M16/M17 已经看到，大 tool result 可能被替换成 preview。这个决定不是消息正文里的天然事实，而由 `ContentReplacementState` 和独立 Transcript entry 记录。

Fork 如果只复制消息，不用新 session ID seed replacement records，下一次 Resume S2 时会看到那些 tool result，却不知道它们此前已经被替换。结果可能把 full content 重新送入模型，破坏 prompt cache 并永久超预算。

所以 Fork 隔离不是“什么都不复制”，而是：复制形成相同请求语义所需的已提交历史，换新 owner identity；不复制原 session 的未决 worktree、live controller 或不确定副作用所有权。

H6 clean-room 比快照再收紧一步：fork clone 为每条消息 mint 新 message ID，同时保存 `sourceMessageId`。这不是声称 Claude Code 当前如此，而是作品集系统减少跨 session identity collision 的迁移设计。

## 后台 Agent 恢复的是上下文，不是旧进程

Local Agent 有自己的 sidechain Transcript。`runAgent.ts` 会记录 initial messages、agent metadata，之后按 `lastRecordedUuid` 增量记录新消息。Fork-inherited context 可能复用主会话 UUID，所以 local sidechain 写入不能用主 Transcript UUID set 去重。

`resumeAgentBackground()` 读取：

- sidechain messages；
- sidechain content replacement records；
- agent type、description、worktree metadata；
- parent 当前可提供的 tool/permission/system prompt 边界。

它过滤 unresolved/thinking/whitespace，重建 replacement state，检查 worktree 是否还存在，然后调用 `registerAsyncAgent()` 创建新的 Runtime Task 和新的 `AbortController`，再启动一个新的 `runAgent` lifecycle。

~~~mermaid
sequenceDiagram
  participant S as Sidechain JSONL
  participant R as resumeAgentBackground
  participant T as Runtime Task Registry
  participant A as New Agent Attempt
  S->>R: messages + replacement + metadata
  R->>R: 清理协议并检查 worktree
  R->>T: registerAsyncAgent(new controller)
  T->>A: start new runAgent lifecycle
  Note over S,A: 旧 controller/process 不会复活
~~~

如果旧 Agent 已经向外部 API 成功写入、却没写 tool result，sidechain 仍不能确认成功与否。Resume 只能说“我有足够历史创建一个新 attempt”；是否重试必须交给 effect journal、幂等键或人工对账。

## 四个 commit point，把恢复风险一次看透

我们现在把一次工具轮次拆成四个阶段：

```text
用户/模型消息 commit
-> effect prepare commit
-> 外部调用 attempt
-> effect/result commit
```

真实 Claude Code 快照主要持久化消息与 tool result，没有一个通用的企业 effect transaction。H6 为作品集补上 `prepared -> attempted -> committed` 日志。

~~~mermaid
stateDiagram-v2
  [*] --> Prepared: 写 effectId + idempotencyKey
  Prepared --> Attempted: 调用外部系统前记录 attempt
  Attempted --> Committed: 结果与业务提交证据已记录
  Prepared --> PreparedRecovery: crash
  Attempted --> Indeterminate: crash / timeout
  Committed --> NoReplay: resume
  PreparedRecovery --> DispatchPolicy: 尚无 attempt 证据
  Indeterminate --> Reconcile: 查询外部系统或人工裁决
  NoReplay --> [*]
~~~

为什么 `attempted` 不能叫 failed？因为网络 timeout 可能发生在服务端成功、本地未收到 response 的窗口。为什么 `prepared` 可以与 `attempted` 分开？因为只有 prepare record 时，dispatcher 还没有记录自己开始调用；系统可以按照队列事务重新调度。但即便如此，真正的生产实现仍要让“写 attempted 与发请求”的边界配合幂等键，不能靠名称消灭所有窗口。

四类 crash 的恢复动作如下：

| 崩溃点 | 可观察证据 | 安全动作 |
| --- | --- | --- |
| 用户消息 enqueue 后、append 前 | 下次看不到该 entry | 不得声称已接受；需要 upstream ack/retry |
| assistant tool_use 已记录、外部调用前 | unresolved use 或 prepared | 过滤旧 use；由 dispatcher policy 决定新 attempt |
| 外部调用后、commit 前 | attempted，无 committed | `indeterminate`；按 idempotency key 查询/对账 |
| committed/result 后 | committed + tool_result | 不重放 effect，继续后续 Query Loop |

~~~mermaid
flowchart TD
  CRASH["进程恢复"] --> STATUS{"effect 最新状态"}
  STATUS -->|"prepared"| READY["可交给 dispatcher 策略"]
  STATUS -->|"attempted"| UNKNOWN["indeterminate"]
  STATUS -->|"committed"| SKIP["禁止重复执行"]
  UNKNOWN --> LOOKUP["按 idempotency key 查询外部事实"]
  LOOKUP -->|"已成功"| COMMIT["补写 committed"]
  LOOKUP -->|"明确未发生"| RETRY["创建新 attempt"]
  LOOKUP -->|"仍未知"| HUMAN["人工/补偿流程"]
~~~

面向数据库写入，可以用本地事务把业务 row 与 outbox row 一起提交；面向第三方 API，则依赖对方支持 idempotency key、查询接口或补偿。所谓 exactly-once 通常不是“网络只发送一次”，而是“业务效果在可接受的故障模型中只提交一次”。

## 后台任务与 Cron 怎样接管

M23 的 `DurableScheduler` 已先生成 stable pending trigger，再由 consumer 处理；显式 commit 后 one-shot 才删除、recurring 才推进。M24 ResumeCoordinator 接受 scheduler state 时，不重新 poll 制造一个新 trigger，也不自动 commit；它把原 `pending.triggerId` 放进 recovery report，交给下游幂等消费者。

后台 execution 采用独立 journal：`started/heartbeat/completed/failed`。恢复时最新状态仍是 started 或 heartbeat，说明旧进程已不存在、但没有 terminal 证据，归类为 orphaned。Supervisor 根据 `restartPolicy` 决定 resume 或 manual；它创建新 attempt，不把旧 controller 当成还活着。

~~~mermaid
flowchart LR
  SCHED["DurableScheduler state"] --> PENDING["stable pending trigger"]
  BG["Background journal"] --> ORPHAN{"latest 是否 terminal"}
  ORPHAN -->|"否"| SUP["Supervisor"]
  ORPHAN -->|"是"| DONE["保持 terminal"]
  PENDING --> SUP
  SUP --> NEW["new attempt + same idempotency key"]
  NEW --> COMMIT["effect / trigger 显式 commit"]
~~~

这里三种 ID 不要混：schedule ID 表示规则，trigger ID 表示某次应运行，execution/attempt ID 表示某个 worker 的一次执行。把它们压成一个 `taskId`，恢复时就很难判断应该去重规则、去重业务事件，还是 fencing 一个迟到 worker。

## H6：把恢复协议做成可运行作品

Mini Agent Harness 新增两个双语言模块：

```text
typescript/agent/transcriptRecovery.ts
python/transcript_recovery.py
```

核心 owner 如下：

| 组件 | 它拥有的状态 | 它明确不拥有的状态 |
| --- | --- | --- |
| `TranscriptStore` | append-only records、record ID、revision | 外部副作用、live process |
| `RecoveryReducer` | 无长期可变状态；从 records 生成 projection/report | 持久化写入、业务执行 |
| `ResumeCoordinator` | 一次 Normal/Fork 编排与身份映射 | 所有 domain store 的永久状态 |
| effect journal records | effect phase、idempotency key | 第三方系统事实本身 |
| background journal records | attempt lifecycle 证据 | 旧 AbortController |
| `DurableScheduler` | schedule、pending trigger、commit | consumer 业务效果 |

~~~mermaid
flowchart TB
  STORE["TranscriptStore"] --> REDUCER["RecoveryReducer"]
  REDUCER --> VIEW["messages projection"]
  REDUCER --> REPORT["metadata-only RecoveryReport"]
  REDUCER --> EFFECTS["effect classifications"]
  REDUCER --> ORPHANS["orphaned executions"]
  COORD["ResumeCoordinator"] --> REDUCER
  COORD --> NORMAL["Normal identity"]
  COORD --> FORK["Fork identity mapping"]
  SCHED["DurableScheduler state"] --> COORD
~~~

### TranscriptStore 的两个去重层次

record ID 相同且内容相同，`append()` 幂等返回，不增加 revision；record ID 相同、内容不同则报 collision。另一个层次是 message ID：不同 record 可以声称同一个 message ID。Reducer 保留第一个，并把 ID 放进 `duplicateMessageIds`，而不是静默 last-wins。

为什么要两层？网络重投通常重复 record；错误 producer 或 Fork identity collision 可能产生两个不同 record 却争夺同一个 message identity。前者适合幂等，后者必须报警。

### RecoveryReport 为什么不能放正文

报告包含 revision、数量、message/tool/effect/execution/trigger IDs 与状态，不包含 prompt、tool input、tool result 或 secret。这样 SRE 可以看见链不完整、effect indeterminate、trigger pending，却不需要获得用户正文。

这不是说所有 ID 都天然无敏感性；生产系统仍应使用不可逆/租户隔离 ID，并设置 retention。这里强调的是观察者没有取得执行 payload 的默认能力。

## 现在运行实验，不先看答案

进入 Harness：

```powershell
cd "D:\agent\Claude code最新\mini-agent-harness"
node typescript/agent/transcriptRecovery.test.ts
cd python
python -m unittest -v test_transcript_recovery.py
```

先写下预测：

1. 中间坏行与半写尾行分别出现在报告哪个字段？
2. cycle/dangling 会返回空、抛错，还是 partial chain？
3. 含 text 的全 unresolved assistant 是否保留？
4. attempted effect 是否允许自动重试？
5. Fork 是否复制 orphaned execution？
6. scheduler pending trigger ID 在 Resume 后是否改变？

实际验证结果：TypeScript `9/9`，Python `7/7`，strict typecheck 通过。重要的不是数字，而是下面几条可观察现象。

### 破坏实验一：截断最后一行

测试输入包含一条完整 message、一条坏的中间行和一条未闭合尾行。预期：完整 message 保留，中间行号进入 `malformedLineNumbers`，尾部进入 `partialTailIgnored=true`。

反证条件：解析器因最后一行失败而丢失完整前缀，或悄悄返回“完整恢复”。实际结果支持预期。

### 破坏实验二：parent cycle 与 dangling

分别构造：

```text
m2 -> missing
m1 -> m2 -> m1
```

预期：不会死循环；已有节点作为 partial chain 返回；报告 `completeChain=false`。实际结果支持预期。

### 破坏实验三：工具成功但 commit 未写

构造 `prepared -> attempted`，不追加 committed。预期：Reducer 输出 `indeterminate`，而不是 failed 或 retryable。再加入 committed，预期变成 committed。实际结果支持三态分类。

### 破坏实验四：Fork 与 orphan 隔离

source session 有一个 started background execution。Normal Resume 应报告 orphan；Fork 应获得新 session/message/record ID，并保留 `sourceMessageId`，但不复制原 orphan owner。实际结果支持预期。

### 破坏实验五：报告泄密

message content 写入 `secret-prompt/secret-text`，序列化 RecoveryReport。预期：报告只出现 ID/status/count，不包含 `secret`。双语言测试都验证了这个反证条件。

## 修改挑战：从能解释到能设计

不要一次做完。每个挑战都先写失败测试。

### 挑战 A：schema migration

当前 codec 只接受 `schemaVersion: 1`。增加 migrator registry：旧版本先迁移到当前内存类型，再进入 reducer；未来版本默认拒绝。报告记录 migrated count/version，不记录 payload。思考：迁移失败是跳过单行、阻断 session，还是进入隔离队列？

### 挑战 B：mixed resolved/unresolved tool block

把 message-level filter 改成 block-level projector，保留 text 与已配对 tool use/result，只删除 unresolved block。注意不能修改原 Transcript；projection 是新视图。给 provider API pairing 写性质测试。

### 挑战 C：事务 outbox

把 effect prepared/attempted/committed 接入一个 SQLite/PostgreSQL adapter。要求业务状态与 outbox commit 同事务，worker 用 idempotency key，迟到 attempt 用 fencing token。故障注入点放在每次 commit 前后。

### 挑战 D：多 leaf 选择策略

当前 H6 默认按 sequence 选最新 leaf。增加显式 branch selector，禁止只靠 timestamp 猜用户要恢复哪条分支。Resume API 返回候选 leaf metadata，让调用者选择。

## 迁移到 Java/Spring、RAG 和 LangGraph

### Java/Spring：把 owner 做成接口，不做万能 SessionEntity

可以这样划分：

```java
interface TranscriptStore {
    AppendResult append(TranscriptRecord record, long expectedRevision);
    List<TranscriptRecord> load(SessionId sessionId);
}

interface RecoveryReducer {
    RecoverySnapshot reduce(List<TranscriptRecord> records, LeafId leaf);
}

interface EffectReconciler {
    ReconcileResult reconcile(IndeterminateEffect effect);
}
```

`@Transactional` 适合把本库业务 row、effect/outbox record 一起提交；它不能覆盖第三方 HTTP。对第三方请求，使用 idempotency key、查询 API 和补偿。用 `@Scheduled` 只负责触发扫描，不让 scheduler bean 直接拥有所有业务状态。

~~~mermaid
flowchart LR
  API["Spring API"] --> TX["DB transaction"]
  TX --> BUSINESS["business row"]
  TX --> OUTBOX["effect/outbox row"]
  WORKER["worker"] --> OUTBOX
  WORKER --> EXT["external API + idempotency key"]
  EXT --> RECON["reconcile/commit"]
  RECON --> OUTBOX
~~~

### RAG ingestion：文档索引也有 indeterminate

文档已经写入对象存储，embedding 请求成功但 vector DB upsert response 丢失，就是典型 attempted-without-commit。若 chunk ID 是稳定内容哈希或业务 ID，upsert 可幂等；若每次重试生成随机 ID，就会产生重复 chunk。

Transcript 记录“Agent 计划索引文档”并不足够。需要 ingestion job、chunk identity、embedding version、vector upsert effect 和 commit checkpoint 各自持久化。

### LangGraph：checkpoint 不替你解决外部副作用

LangGraph checkpoint 可以恢复 graph state 和下一节点，但节点内部的外部 API 同样存在成功后 checkpoint 前崩溃。你仍需要 idempotent node、effect journal 或 compensation。框架负责 orchestration state，不自动成为业务数据库事务管理器。

## 资深 Agent 开发岗会怎样追问

下面的回答不是背诵稿。练习时只记住第一句结论和三四个机制支点，再用自己的语言说满约两分钟。

### 1. “你怎样设计一个可恢复的 Agent 会话？”

**结论：我会把 append-only 事件证据、恢复投影和外部副作用提交拆成三个边界，而不是序列化一个万能 Agent 对象。**

以 Claude Code 快照为例，用户和 assistant/tool 消息先进入 JSONL，消息通过 UUID/parentUuid 形成图；Resume 时先逐行容错解析，再选 leaf、走 parent chain、补并行 tool siblings，并过滤无 result 的 tool use。session metadata、file history、cost、context collapse、agent setting 又分别交回自己的 owner。这个设计能恢复“下一次请求该看到什么”，但不能证明外部工具是否只执行一次。

企业实现里我会再加 effect journal 和 background attempt journal。effect 用 prepared、attempted、committed 区分；attempted 没 committed 是 indeterminate，需要按 idempotency key 查询外部系统，不能盲重试。ResumeCoordinator 只编排，不永久拥有所有状态。这样既能继续对话，也能明确恢复证据的边界。

### 2. “`await recordTranscript()` 为什么还可能丢消息？”

**结论：因为 await 只等待实际连接到返回 Promise 的工作，源码把底层写 Promise 用 `void` fire-and-forget 了。**

Claude Code 的 `appendEntry()` 把 entry 放进 per-file queue，timer 后批量 drain；`recordTranscript()` 可以在物理 append 前 resolve。所以它解决的是“记录请求已被 Project 接受”，不是 durable commit。显式 `flush()` 才取消 timer、等待 active drain 并写完剩余队列，但它也不等于 fsync 或远程 quorum。

Java 里类似于在 `CompletableFuture` 回调中 submit 新任务却不 return；Python 类似 create_task 后立即返回。设计审查时我会画 Promise ownership，列出 crash window，并把 upstream ack 放在真正需要的 durable boundary 后面。

### 3. “为什么 Transcript 不是普通数组？”

**结论：因为流式 content block、并行工具、分支和压缩会让逻辑历史天然成为 DAG，数组只是某次请求的投影视图。**

Claude Code 的并行 tool use 可能对应同一 provider message ID 的多个 assistant records，每个 tool result 指向自己的 assistant parent。单 parent 逆向 walk 会漏 sibling，所以读取器还要按 provider message ID 和 result parent 补回。Compact/Snip 又通过读侧 relink/removal 改变投影，而不是物理删除旧 bytes。

企业系统里我会保留 stable event/message identity 与 parent/causal links，在请求前投影成 provider 需要的线性序列。这样写路径不必为了线性化所有并行事件而阻塞，但 reducer 必须报告 cycle、dangling 和 branch selection。

### 4. “坏了一行 JSONL，你会让整个会话失败吗？”

**结论：默认应保留完整前缀和其他有效行，但必须把完整性缺口显式报告，不能静默声称恢复成功。**

快照里的 `parseJSONL()` 是逐行 try/catch，半写尾行和坏行被跳过。优点是一条坏记录不会报废数百 MB 历史；代价是坏 parent 可能让链截断。H6 因此把 malformed line、partial tail、dangling parent、cycle 和 completeChain 都放入 metadata-only report。

生产上我还会按风险分级：聊天展示可以 partial，财务/审批 effect ledger 不能静默跳行，应该隔离并阻断自动执行。容错策略要按数据的业务权威性，而不是所有 JSONL 共用一个答案。

### 5. “未配对 tool_use 在恢复时该不该重跑？”

**结论：不能仅凭缺少 tool_result 自动重跑，因为外部副作用可能已经成功。**

Claude Code 快照会删除全部 tool use 都 unresolved 的 assistant message，避免把裸 tool_use 重新送给模型；但这个过滤是 message-level，含 text 时 text 也会丢，mixed resolved/unresolved 又会保留整条，所以它是协议防御，不是副作用事务。

企业系统需要 effect ID、idempotency key 与 prepared/attempted/committed。attempted 没 commit 时先 reconcile：查工单、支付或 vector DB 的外部状态；确认成功就补 commit，确认没发生才重试，仍未知就人工或补偿。这个回答的重点是把“消息配对”和“业务效果”分开。

### 6. “Normal Resume 和 Fork 的本质区别是什么？”

**结论：Normal 是同一 owner identity 的接管，Fork 是复制已提交历史后创建新的 owner identity。**

Normal Resume 复用 session ID 和原 Transcript，恢复 metadata/worktree/cost 等 owner 后继续 append。Fork 使用 fresh session/file，不接管原 worktree；它复制形成相同请求语义所需的消息和 content replacement records，并保留 forkedFrom 追踪。

我自己的 Harness 会给 fork message mint 新 ID，同时保留 source mapping，而且不复制未决 effect、orphaned execution 或 lease。否则两个 session 会同时认为自己有权提交同一个迟到副作用。面试追问到数据库时，我会说 copy-on-write、tenant/session key 和 fencing 是隔离的具体手段。

### 7. “恢复后台 Agent 时，哪些东西不能恢复？”

**结论：可以恢复输入、消息、配置和已提交 checkpoint，不能恢复旧进程的 controller、stream、socket 和正在进行的外部调用。**

Claude Code 的 `resumeAgentBackground()` 读 sidechain、replacement state、agent metadata 与 worktree，然后注册新的 Runtime Task/AbortController，启动新 attempt。它不是把旧 JS generator 从某条指令继续执行。

企业 supervisor 应把非 terminal attempt 标为 orphaned，按 policy 创建新 attempt，并用 fencing 拒绝旧 worker 的迟到 completion。对于外部 API，仍通过 effect journal reconcile。这个边界和 Kubernetes 重建 Pod 类似：重建的是声明和工作，不是原进程内存。

### 8. “你如何实现 exactly-once 的 Agent 工具调用？”

**结论：我不会承诺网络调用 exactly-once，而会设计业务效果幂等提交，并明确故障模型。**

本地数据库可以把业务 row 和 outbox record 放进同一事务；worker 带稳定 idempotency key 调第三方；对方支持幂等或查询时，attempted timeout 后可以 reconcile。scheduler stable trigger ID、mail ack、Transcript tool_result 都只是证据链的一部分，任何一个单独都不够。

若第三方既不幂等、也不能查询、也无补偿，那就不存在通用 exactly-once，只能接受 at-least-once 重复、at-most-once 丢失，或引入人工确认。面试里敢于说出不可实现边界，比喊“加分布式锁”更专业。

### 9. “恢复报告为什么只放 metadata？”

**结论：可观测者需要判断完整性与风险，不需要默认获得 prompt 和工具 payload。**

H6 report 包含 revision、count、duplicate/dangling/cycle IDs、unresolved tool IDs、effect status、orphan execution 和 pending trigger。SRE 可以据此告警或阻断自动继续；正文仍留在 Transcript store 的受控访问域。

生产上还要对 ID 做租户隔离、retention 和访问审计，并允许安全团队获取经过审批的 payload。这个设计与 M26 的 telemetry 会直接相连：observer 不应因为“排障”自动取得执行权和用户内容。

### 10. “如果让你把这套恢复接入 Spring 和 LangGraph，你怎么分工？”

**结论：Spring 管业务事务与持久化 adapter，LangGraph 管编排 checkpoint，effect reconciler 单独管理外部副作用。**

我会定义 TranscriptStore/RecoveryReducer/EffectReconciler 接口，PostgreSQL 保存 records、outbox、lease 和 commit；Spring transaction 把本库业务与 outbox 原子提交。LangGraph state 记录节点进度与下一跳，但节点调用第三方仍必须使用 idempotency key/effect journal。

恢复时先重建 graph state，再列出 indeterminate effects 和 orphaned workers；只有 reconcile 通过的项才自动推进。这样框架不会冒充业务数据库，数据库也不会拥有模型请求投影。Claude Code 的多 owner 恢复与 sidechain/new attempt 设计，是这个拆分的很好参考。

## 最后把本章压成一张复习图

~~~mermaid
flowchart TD
  W["写入：record != flush != fsync"] --> J["JSONL：完整前缀可恢复，坏行会留缺口"]
  J --> G["图：leaf + parent chain + parallel sibling"]
  G --> P["协议：tool use/result 配对 + interruption"]
  P --> O["所有权：各 store 分别 restore"]
  O --> I["身份：Normal 接管，Fork 隔离"]
  I --> B["后台：旧 process 变 orphan，新 attempt"]
  B --> E["副作用：prepared / indeterminate / committed"]
  E --> D["可靠性：idempotency + reconcile + explicit commit"]
~~~

如果你能不看正文解释每条箭头，再回答下面四个问题，本单元才算真正完成：

1. 为什么 `await recordTranscript()` 可能早于磁盘 append？
2. 为什么一条 JSONL 坏行既不必摧毁全部会话，又不能被忽略为“无影响”？
3. 为什么 Resume 能继续模型对话，却不能证明工具副作用 exactly-once？
4. 为什么 Fork 必须复制部分已提交语义，却不能共享未决 owner？

核心源码定位：

```text
src/QueryEngine.ts -> QueryEngine.submitMessage -> pre-query record/optional flush
src/utils/sessionStorage.ts -> Project / recordTranscript / loadTranscriptFile / buildConversationChain
src/utils/json.ts -> parseJSONL / readJSONLFile
src/utils/messages.ts -> filterUnresolvedToolUses
src/utils/conversationRecovery.ts -> deserializeMessagesWithInterruptDetection / loadConversationForResume
src/utils/sessionRestore.ts -> restoreSessionStateFromLog / processResumedConversation / restoreWorktreeForResume
src/cli/print.ts -> interrupted turn auto-resume / removeInterruptedMessage
src/commands/branch/branch.ts -> createFork
src/utils/toolResultStorage.ts -> reconstructContentReplacementState
src/tools/AgentTool/resumeAgent.ts -> resumeAgentBackground
```

快照事实解释 Claude Code 当前怎样做；H6 的 effect journal、新 message ID Fork、metadata-only recovery report 和 persistence-neutral stores 是 clean-room 设计迁移。两者都服务同一个原则：

> 恢复系统最重要的能力，不是让一切看起来像从未崩溃，而是诚实区分哪些已经提交、哪些可以重建、哪些仍然不确定。
