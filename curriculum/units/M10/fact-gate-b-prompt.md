# M10 FACT_B 同会话对照提示词

继续刚才的 FACT_A 会话。请把阶段 A 的独立结论与下面 Codex 的定向源码核验、实验设计和 clean-room 候选契约逐项对照。不要重新扩散阅读整个源码树；只有发现明确冲突时，才回到相关路径与符号。

## Codex 机制摘要

### 1. 两个长期 owner 与本轮浅视图

Interactive REPL 的主消息 owner 是 `REPL.tsx` 局部的 `messagesRef.current`；React `messages` 是渲染投影。包装 `setMessages()` 对 ref 中的最新数组立即求值并写回，再调用 `rawSetMessages(next)`。`onQuery` 先追加 `newMessages`，再读取 `messagesRef.current` 作为 `latestMessages` 传给 `onQueryImpl()`。

Headless 的跨 command owner 是 `print.ts` 的 `const mutableMessages = initialMessages`。每次 `ask()` 创建新 QueryEngine，构造时 engine 字段与外部数组初始同引用；普通 `push()` 同时更新共享数组。随后 `const messages = [...this.mutableMessages]` 只冻结本轮数组成员集合。

`ProcessUserInputContext.setMessages` 使用 `this.mutableMessages = fn(this.mutableMessages)`，因此返回新数组会重绑定 engine 字段，不会自动改变 `print.ts` 外部 const 的引用；`ask()` finally 只回写 read-file cache。这一静态引用边界可确认。但当前快照缺失 feature-gated `commands/force-snip`，普通 local-jsx 在 non-interactive 下也可能提前解析为空结果，因此不能从现有证据断言真实可达的 Headless 用户流程一定丢历史。教材应表述为“共享依赖保持同一引用；重绑定是需要 owner API 或回写契约解决的风险边界”，而不是未经运行验证的产品故障。

### 2. array snapshot 不等于 immutable message

`[...this.mutableMessages]` 只复制数组。`services/api/claude.ts` 在 `content_block_stop` 创建并 yield assistant envelope，随后 `message_delta` 直接修改同一 `lastMsg.message.usage` 和 `stop_reason`，使延迟 transcript serialization看到最终字段。因此旧数组 view 不随 owner append 增长，但共享 element mutation仍可见。

### 3. 只从使用点确认消息族

当前快照缺失 `src/types/message.ts` 和 `coreTypes.generated.ts`，不能声称完整内部 union。可以确认 creator 构造的 user、assistant、progress、attachment、system，以及 owner 实际 push 的这些 envelope；`tombstone`、`stream_event`、`stream_request_start`、`tool_use_summary` 等出现在 QueryEngine 消费的 query event switch 中，不能因此全部叫作“长期 Message owner中的 family”。教材会明确使用点反推边界。

`coreSchemas.ts` 可以确认外部 SDK event union，但 SDK event不等于 internal Message。

### 4. identity 分层

```text
internal envelope uuid
!= provider assistant message.id
!= tool_use.id / tool_result.tool_use_id
!= sourceToolAssistantUUID / serialized parentUuid
!= SDK session_id / parent_tool_use_id
```

- streamed content blocks可以成为不同 envelope UUID，却共享一次 provider response 的 `message.id`；
- tool result block通过 `tool_use_id` 与 tool use配对；
- local user-role tool result另带 `sourceToolAssistantUUID`，写 transcript 时覆盖其 `parentUuid`；
- `parentUuid` 是持久化边，不是 message creator预先写入的统一字段；
- new user message可由 caller传入 UUID，恢复消息也保留既有 identity，所以不能把“每个 uuid一定由本进程 randomUUID生成”写成事实。

### 5. human turn 是领域谓词，不是 user role

接受 FACT_A Issue #1 的核心发现：`isHumanTurn()` 只排除 `toolUseResult !== undefined`，而 subagent 在 `preserveToolUseResults=false` 时可能保留 content 中的 `tool_result` block并把字段设为 undefined。`attachments.ts:hasToolResultContent()` 的注释和结构检查证明该近似谓词不是全局完备分类器。

教材不会把这个 helper写成完整真理；Harness 会使用显式 domain kind和结构 validator区分 human input与 tool result。

### 6. progress 与 attachment 必须按四个平面判断

接受 FACT_A Issue #2：当前 `recordTranscript()` 先经过 `cleanMessagesForLogging()`，`isLoggableMessage()` 过滤 progress，loader 的 `isTranscriptMessage()` 也排除 progress；QueryEngine progress case及 recordTranscript return邻近的“已写入/参与 dedup”注释与当前 filter链不一致。教材以执行链为准，把旧 progress JSONL仅作为 loader bridge兼容对象。

但 FACT_A 的“attachment 永远不进入 API”是错误的：`normalizeMessagesForAPI()` 保留 `AttachmentMessage`，在 `case 'attachment'` 调 `normalizeAttachmentForAPI()`，生成一个或多个 user message并与相邻 user合并。Attachment在 external transcript通常被过滤，但 ant用户和特定 hook context开关存在例外。

Progress 的 SDK 投影也不是一个简单映射：agent/skill progress会展开内部 nested message为 SDK assistant/user；bash/powershell progress在远程/容器条件下节流为 `tool_progress`；其他类型可不输出。当前 progress不会进入 provider API请求。

### 7. pairing 与 transcript topology

`query.ts` 的 tool result同时写：

```text
tool_result.tool_use_id = tool_use.id
sourceToolAssistantUUID = assistant envelope uuid
```

第一条满足 provider content协议，第二条服务 transcript topology。`normalizeMessagesForAPI()` 先归并/过滤/attachment projection，`ensureToolResultPairing()` 再检查跨消息 duplicate tool-use ID、missing/orphan/duplicate result以及相邻结构；strict mode抛错，非 strict模式合成错误 result或剥离孤儿。合成占位只代表恢复动作，不能冒充真实工具结果。

`insertMessageChain()` 普通推进 parent cursor，tool result可改挂 source assistant，compact boundary重置物理 parent。并行 tool use形成 DAG：不同 envelope UUID可共享 provider response ID，不同 tool result挂到各自 assistant。`buildConversationChain()` 单 parent walk后用 `recoverOrphanedParallelToolResults()` 按 message.id和 parent index补 sibling/result；cycle时返回部分链；legacy progress通过 bridge绕过已删除节点。

## 对 FACT_A 七项 Issue 的 Codex 裁决候选

1. `isHumanTurn` 覆盖缺口：`accepted`，影响教材与 Harness domain kind。
2. progress transcript注释冲突：`accepted`，正文以 filter/load链为准。
3. slash-command重绑定：`accepted as a conditional ownership boundary`；静态 alias分叉确定，真实 feature-gated Headless可达故障未闭合，不得升级为已发生产品 bug。
4. REPL `getToolUseContext` 旧 closure：`rebutted`。该 callback第一参数就是显式 `messages`，`onQueryImpl` 在约2746行传入 `messagesIncludingNewMessages`；函数体把该参数写入 context，不是偷偷读取 React state。
5. parallel recovery依赖 message.id：`accepted as documented design boundary, not a demonstrated fork defect`。当前报告没有给出 fork后 message.id丢失的源码路径或失败实验；synthetic assistant creator也生成 message.id。
6. `sourceToolAssistantUUID` 一致性：`rebutted as a material issue`。定向搜索 `query.ts`、`StreamingToolExecutor.ts` 和 `toolExecution.ts` 的主要 result路径均显式设置该字段；fallback顺序 parent是代码刻意支持的兼容边界。若存在具体遗漏路径，请指出，否则不阻断本单元。
7. 缺失 type文件：`accepted as evidence boundary, not a correctable issue`。教材缩小类型表述，不恢复或想象缺失文件。

## clean-room 实验与 Harness 候选契约

独立实验将验证：

- shallow array snapshot隔离 append但不隔离 element mutation；
- 两个 writer从同一 revision replace会被 expected-revision CAS拒绝，而不是 silent lost update；
- envelope ID、provider response ID、tool use ID和 parent ID不能混为同一个 key；
- human input与 user-role tool result按 domain kind区分；
- progress不进入 durable parent chain；
- missing/orphan/duplicate tool result在 projection前 fail closed。

H2-in-progress `ConversationStore` 候选：

- 单 writer store拥有 immutable envelope list与 monotonic revision；
- `snapshot()` 返回 source revision和不可变 view；
- append/replace要求 expected revision，stale commit显式失败；
- durable message与 ephemeral progress分离；
- human/tool-result使用不同 domain kind；
- envelope ID、response ID、tool use ID、parent ID使用不同概念并分别校验；
- tool result只解析 pending且未完成的 tool use，重复/孤儿/missing显式失败；
- publication复制并深冻结 nested payload，避免共享 element被外部修改；
- trace只记录 revision、operation、IDs和 rejection reason。

上述是设计迁移，不冒充 Claude Code 当前数组和修复函数的现有 API。

## 审查要求

只检查事实错误、重要遗漏、证据不足、owner/identity/durability/pairing混淆，以及实验或 Harness 契约不能验证正文结论的问题。M11-M15 的完整 Query/Context/Tool教学、完整 Transcript/fork/compact专题、普通措辞偏好和无学习影响的边缘问题不构成 Issue。

输出必须以以下三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有 Issue，给出路径、符号、为什么会改变正文/实验/Harness与最小修正。没有实质问题时明确写 `No material issues`。
