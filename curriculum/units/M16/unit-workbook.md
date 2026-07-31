# M16 作者工作簿：Context 视图、预算与轻量裁剪

状态：`fact-reviewed`

本文件是作者工作区，不是教材正文。Graphify 只用于候选定位；“快照事实”均已回到 `claude-code-CLI/` 直接核验。

## 单元问题、边界与风险

真实问题不是“超过 token 就把最老文字删掉”，而是：完整会话已经合法地保存在长期 owner 中，当前模型请求为什么仍要重新选择可见起点、压缩大工具结果、注入附件并维护 Prompt Cache 前缀；这些派生操作怎样不污染 durable history，也不破坏 tool-use/result 配对。

前置：M10 的 durable message owner 与 pairing；M12 的 producer-local state；M13 的 durable/query/API/wire 四层投影；M14-M15 的模型响应、Tool Loop 与结果提交。

本单元闭合：

```text
queryLoop state.messages
-> getMessagesAfterCompactBoundary
-> messagesForQuery 浅容器视图
-> aggregate tool-result budget
-> snip 接口 / microcompact 可见路径
-> attachment 已有内容与下一轮注入
-> prependUserContext
-> normalizeMessagesForAPI
-> addCacheBreakpoints / cache edits
-> Provider wire request
```

本单元不展开 M17 的 auto-compact 摘要生成、替换提交与崩溃恢复，不展开 M18 的指令来源与附件 provenance，也不补造快照中缺失的 snip、cached-microcompact 和 context-collapse 内部实现。

风险：`R2`。错误的 history 起点会产生 orphan result；错误预算单位会让多个“小结果”合并后越限；原地裁剪会污染恢复事实；不稳定 replacement 决策会破坏缓存前缀；并发或恢复若没有 revision，会让旧 decision 覆盖新 state。

## Graphify 候选与准确性边界

查询词来自图谱词表：`query context messages history budget tool result replacement compact microcompact attachment cache`。

有效候选：

- `src/query.ts -> query()` / `queryLoop()`；
- `src/utils/messages.ts -> getMessagesAfterCompactBoundary()` / `normalizeMessagesForAPI()`；
- `src/utils/toolResultStorage.ts -> applyToolResultBudget()` / `enforceToolResultBudget()` / `recordContentReplacement()`；
- `src/services/compact/microCompact.ts -> microcompactMessages()`；
- `src/services/api/claude.ts -> addCacheBreakpoints()`；
- `src/utils/attachments.ts` 与 `processUserInput()` 的附件入口。

图谱同时返回 UI `Messages.tsx`、`history.ts`、`/context` 命令和多个仅结构相邻节点。它们不是本单元主运行边，已经丢弃。图谱没有证明调用顺序、状态 owner 或预算语义。

## 精简源码地图

| 位置 | 决定性符号或分支 | 本单元意义 |
| --- | --- | --- |
| `src/query.ts:365-535` | `messagesForQuery`、budget、snip、microcompact、collapse、autocompact | 当前请求视图的真实处理顺序 |
| `src/query.ts:638-660` | blocking token check、`prependUserContext()` | token 阈值与请求时 context 的边界 |
| `src/query.ts:1538-1718` | tool results 后注入 attachments、next state | 普通附件不能夹进 tool-result 配对区 |
| `src/utils/messages.ts:4608-4656` | last compact boundary 与 slice | 选择可见历史，不删除原数组 |
| `src/utils/toolResultStorage.ts:205-337` | per-tool persistence/preview | 单个结果进入消息前的内容缩减 |
| 同上 `390-946` | `ContentReplacementState` 与 aggregate group budget | 跨轮冻结请求视图 replacement 决策 |
| 同上 `960-1000` | resume reconstruction | 精确 preview 记录用于恢复缓存前缀 |
| `src/services/tools/toolExecution.ts:1398-1460` | `processToolResultBlock()` 后创建 user message | per-tool preview 位于消息构造之前 |
| `src/services/compact/microCompact.ts:253-398` | cached MC 可见接口 | local messages 不变，cache edits 在 API 层加入 |
| 同上 `402-529` | time-based microcompact | cache 已冷时 copy-on-write 清除旧结果内容 |
| `src/utils/tokens.ts:226-261` | `tokenCountWithEstimation()` | API usage 基线加新增消息估算，不是累计每轮 token |
| `src/services/tokenEstimation.ts:203-434` | char/token 粗估和附件正规化估算 | 字符阈值、token 阈值不能混用 |
| `src/services/api/claude.ts:1528-1704` | cache edits 单次消费、retry params 重建 | 同一请求重试不能把 edit 消费多次 |
| 同上 `3063-3210` | `addCacheBreakpoints()` | wire 层 cache marker/reference/edit 的最终加入 |

## 真实运行链

### 1. history boundary 只选择当前请求的可见起点

`getMessagesAfterCompactBoundary()` 反向寻找最后一个 `system/compact_boundary`。没有 boundary 时返回传入数组；找到时 `slice(boundaryIndex)`，包含 boundary。`queryLoop()` 随后再做 `[...result]`，因此 `messagesForQuery` 有独立数组容器，但 message/block 仍共享引用。

boundary 本身不是 Provider 内容，后续正规化会过滤。`HISTORY_SNIP` 开启时，同一 helper 还调用缺失快照模块 `projectSnippedView()`；只能确认调用接口，不能描述其内部选段算法。

结论：这里是 read projection，不是 durable delete。任意实现若直接修改共享 block，仍可能通过浅别名污染源历史。

### 2. 两层大结果处理发生在不同时间

第一层是 per-tool threshold。`runToolUse()` 完成后，`processToolResultBlock()` 在创建 user/tool-result message 前调用 `maybePersistLargeToolResult()`：超出工具阈值的文本被完整写到 session tool-results 文件，message content 改为路径加固定 preview；图片不走这条持久化。此时 message 的 model-facing content 从一开始就是 preview，envelope 还可按上下文保留独立 `toolUseResult` 字段。这不是一次请求临时裁剪。

工具把 `maxResultSizeChars` 声明为 `Infinity` 时会硬退出这一层，GrowthBook override 也不能把它重新打开。Read 一类工具依赖自身 `maxTokens` 自限，不能说 per-tool persistence 覆盖所有结果。

第二层是 aggregate group budget。`queryLoop()` 已拿到 history view 后调用 `applyToolResultBudget()`。它按 `normalizeMessagesForAPI()` 最终会形成的 user-message group 收集候选：只有新的 assistant response ID 才形成边界，progress、attachment、system 不能错误地把同组并行结果拆开；同 response ID 的 assistant fragments 也不形成新边界。若同组 eligible 结果总字符数超过限制，则优先替换最大的 fresh results。

第二层只 copy-on-write 替换 `messagesForQuery` 中的 tool-result block。没有替换时可返回原数组；有替换时只复制触及的 message/message.content/block。原 message membership 和嵌套 content 不应被修改。

`queryLoop()` 还把 `maxResultSizeChars` 非有限的工具名作为 `skipToolNames` 传给 aggregate budget。这些候选会被标记 seen/frozen，却永不进入 replacement selection，也不计入 eligible fresh size。因此同一 wire group 即使实际仍很大，也可能按本 wrapper 的契约保持 over-budget；不能把 aggregate limit 描述成硬性的全请求上限。

### 3. replacement state 是缓存一致性状态，不是普通优化缓存

`ContentReplacementState` 每个 conversation thread 一份：

- `seenIds` 冻结“曾经看到但未替换”的结果；
- `replacements` 保存已经替换的 `tool_use_id -> 精确 preview 字符串`；
- 已替换结果每轮从 Map 重新应用相同字符串，不重新读文件；
- 新 replacement 记录可写入 Transcript，resume 时恢复精确字符串；
- cache-sharing fork 复制父 state；AgentTool resume 用 sidechain records 重建，并用父 `replacements` 补齐继承但未单独落盘的 decision；swarm teammate 创建 fresh state。

原因不是节省一次字符串计算，而是避免同一个已缓存前缀在后续轮次从全文突然变 preview，或因为模板代码变化产生不同字节。已冻结全文本身超过预算时，快照接受 overage，等待后续 microcompact，而不是破坏已经观察过的前缀。

单次 `enforceToolResultBudget()` 把成功 replacement 的 `seenIds.add` 与 `replacements.set` 放在同一个 await 之后，避免观察到半个 decision。但 state 是可变 Set/Map，源码没有通用 revision transaction；快照主要依赖每线程稳定 owner 与 clone/fresh 分支。企业 Harness 若允许多个 projector、恢复 writer 或分布式 worker，仍需 expected revision 防 stale commit。

### 4. snip、microcompact 与 autocompact 是连续但不同的层

可见顺序是：aggregate budget -> snip -> microcompact -> context collapse -> autocompact。

- snip 返回 `messages`、`tokensFreed` 和可选 boundary message。其内部模块在快照中缺失；`tokensFreed` 会传给 autocompact 与 blocking check，修正仍引用旧 API usage 的估算。
- cached microcompact 按 tool-use ID 和消息组登记可删结果，local messages 原样返回；删除意图变成 cache edits，在 `addCacheBreakpoints()` 才进入 wire。
- time-based microcompact 只在明确 main-thread source、长时间间隔和配置满足时触发；cache 已冷，因而 copy-on-write 把除最近 N 个以外的可压缩 tool results 改成 cleared marker，并重置 cached-MC state。
- 缓存不可用的路径不再执行已移除的 legacy microcompact，交给 autocompact 处理。

当前快照还有一个必须保留的版本事实：`microCompact.ts` 的 main-thread 判断接受 `querySource.startsWith('repl_main_thread')`，但 `claude.ts` 的 wire `useCachedMC` 要求严格等于 `repl_main_thread`。自定义 output-style source 可能在 compact 层产生 pending edit；API 层又先按 `cachedMCEnabled` 消费它，却因 `useCachedMC=false` 不传给 `addCacheBreakpoints()`，造成 edit 静默丢失与 module state/wire 漂移。这是快照实现缺口，不应包装成推荐设计；clean-room 实验不把这条不一致复制进 Harness。

M16 只解释这些轻量路径如何改变当前视图或 wire cache，不讲 M17 的 summary transaction。

`prependUserContext()` 也要画在正确边界：它不是先写回 `messagesForQuery` 再进入下一 stage，而是在 `deps.callModel({ messages: prependUserContext(...) })` 的参数表达式里创建一个临时新数组。合成的 user message 位于索引 0，明确设置 `isMeta: true`；`messagesForQuery`、`toolUseContext.messages` 和 next state 都不包含它。随后 normalize 仍会把它作为 Provider user content，并可能与相邻 user message 合并。FACT_B 关于“未设置 isMeta”的子判断与 `src/utils/api.ts:449-474` 相反，已反驳；“只存在于 API call boundary”的结构结论接受。

### 5. attachment 在两个时点进入消息链

用户轮次开始时，`processUserInput()` 先收集附件，`processTextPrompt()` 返回 `[userMessage, ...attachmentMessages]`。Tool Loop 中途的新附件、队列通知、memory/skill prefetch 则在全部 tool results 完成后加入 `toolResults` 容器，再组合进 next state。源码明确避免普通 user 内容与 tool_result 交错导致 API 错误。

下一请求的 `normalizeMessagesForAPI()` 会把 attachment envelope 转成一个或多个 user messages并参与合并。因此 attachment 会消耗真实上下文，但 aggregate tool-result char budget只统计 eligible tool-result content；它不是“整个请求 token 上限”。M18 再讲附件来源、scope、去重和 provenance。

### 6. 四种预算单位必须分开

| 单位 | 代表实现 | 回答的问题 | 不能推出 |
| --- | --- | --- | --- |
| 字符/近似字节 | per-tool threshold、aggregate group limit | 哪些大文本先外置或替换 | 精确模型 token 数 |
| token/估算 token | 最后一次 API usage + 其后新消息粗估、snip tokens freed | 是否接近 context/autocompact/blocking 阈值 | 哪个 tool result 应替换；也不等于从头重新 tokenizer |
| message group | 最终会合并的 user group | 并行结果合并后是否一起越限 | 当前内部 envelope 数就是 wire 数 |
| wire payload | normalize、pairing、cache marker/reference/edit 后的 params | Provider 实际收到什么形状 | durable history 已被同样改写 |

`roughTokenCountEstimation()` 默认约为 JavaScript 字符串 `length / 4`；常量虽命名为 `BYTES_PER_TOKEN`，这里并没有实际测量 UTF-8 字节。JSON/JSONL 文件路径可使用更保守比率；图片和 document 用近似固定 token。`tokenCountWithEstimation()` 则以最后一次真实 API usage 为基线，只估算其后的新增消息；它们都是混合 heuristic，不是从完整 wire payload 重新 tokenizer 的真值。

## 状态所有权

| 状态 | owner | 修改者 | 观察者 |
| --- | --- | --- | --- |
| durable message membership | REPL / QueryEngine 上层运行时 | 上层提交路径 | `queryLoop`、Transcript、UI |
| `messagesForQuery` | 当前 `queryLoop` iteration | budget/snip/microcompact/collapse/autocompact 的返回值替换 | model call、next state |
| per-tool persisted file | session tool-results store | tool-result mapping | preview 指引、后续 Read |
| `ContentReplacementState` | conversation-thread `ToolUseContext` | aggregate budget、resume reconstruction | 后续 request projection |
| replacement Transcript record | session storage | query source 允许时 fire-and-forget append | resume/fork reconstruction |
| cached microcompact state | compact module main-thread state | registration/pin/reset | API cache-edit projection |
| pending cache edits | compact/API 边界 | microcompact 产生、`queryModel` 单次消费 | retry params builder |

## 失败、取消、并发与恢复

1. **orphan boundary**：完整 history 合法，slice 若从 tool result 开始仍非法；projection 后必须 strict validate，不能只信 durable store 的先验校验。
2. **预算破坏 pairing**：错误的全局字符串截断可能删掉 tool-use 或 result；正确 aggregate budget 只替换 result content，保留 call ID 和消息结构。
3. **投影污染 durable history**：数组 spread 不是 deep clone；对嵌套 block 原地写会污染 UI、resume 和后续请求。
4. **group 误判**：把 progress/attachment/同 ID assistant fragment 当边界，会让多个结果分别低于限制却在 wire 合并后越限。
5. **excluded tool overage**：Infinity/self-bounded 工具两层都跳过 replacement；wrapper budget 不是强制把全部 wire group 降到 limit 的保证。
6. **缓存前缀抖动**：每轮重新选择 replacement 或重新生成 preview，会降低 Prompt Cache 命中；resume 必须恢复精确字符串，而不是只恢复“替换过”布尔值。
7. **cached-MC gate 漂移**：output-style main-thread source 在 compact 层命中 prefix gate，却在 API 层严格相等 gate 失败；pending edit 可被消费但不进入 wire。教材把它标为快照缺口，Harness 使用单一 gate decision。
8. **stale replacement writer**：单线程快照依赖 owner 约束；可并发 Harness 必须以 revision snapshot + compare-and-swap 提交 metadata，拒绝旧 writer。
9. **persist/Transcript 失败**：aggregate persist 失败时原 content 本轮仍会发送并冻结；Transcript append 是异步的。不能把“记录已排队”说成 crash-durable commit，完整恢复事务留给 M24。

## 证据边界

- `快照事实`：上述顺序、分组规则、state 字段、copy-on-write、附件时点和 cache-edit wire 注入来自直接源码。
- `运行验证`：M16 双语言实验将验证 clean-room 预算契约，不代表运行了 Claude Code。
- `设计迁移`：Harness 的 aggregate budget ledger、expected revision、strict post-validation 和 content-free report 是课程方案。
- `无法确认`：快照缺少 `snipCompact.ts`、`snipProjection.ts`、`cachedMicrocompact.ts`、context-collapse 实现和相关测试；不声明其完整算法、默认 gate 或所有边界。

## 实验假设与反证条件

双语言实验比较三种策略：

1. naive global truncation：证明可能切断 tool pair 或把无关附件计入错误单位；
2. deterministic per-result preview：证明单个结果受限，但多个小结果的最终 group 仍可能越限；
3. aggregate final-group budget：证明按 wire group 选择最大 fresh result、保留 pairing、源 snapshot 不变、重复请求 byte-stable。

代表性失败实验：

- history start 落在 result 时 strict fail；
- 两个 writer 从同一 replacement revision 计算，只有第一个 commit 成功，第二个 stale fail；
- progress/attachment 插入不能拆分同一 tool-result group；
- excluded/self-bounded result 可以使 wrapper group 保持 over-budget，报告必须显式暴露该状态；
- replacement report 不含原正文或 preview 内容。

反证条件：源对象任何嵌套 content 改变；group 预算按 envelope 分裂后漏检；重复投影 preview 改变；orphan 仍进入 Provider；stale writer 静默覆盖。

## Harness 候选契约

候选 `merge`：

- `maxToolResultGroupChars` 聚合同一 assistant tool-call group；
- `ResultBudgetLedger` 保存 exact replacement、seen decision 和单调 revision；
- projection 在 ledger commit 前完成 strict pairing；stale expected revision 显式失败；
- content-free replacement metadata 与 projection report；
- 保留旧 per-result preview policy 作为兼容边界，明确它不等于 aggregate budget；
- TypeScript/Python 同行为契约。

候选 `defer`：

- 外置大结果文件、replacement Transcript 持久化与 resume reconstruction；
- Prompt Cache provider-specific marker/cache-edit；
- snip、full compact transaction、memory、distributed ledger。

候选 `reject`：

- 原地截断 `ConversationStore`；
- 在 Provider adapter 内临时猜预算；
- 全局字符 slice；
- 没有 revision 的共享 replacement Map；
- projection 后不重验 tool pairing。

## 事实闸门范围

重点让独立审查者确认：真实处理顺序；per-tool 与 aggregate 两层差异；API-level user group 的边界规则；replacement state 与 resume/cache 语义；snip/microcompact 可确认范围；attachment 注入时点；字符/token/group/wire 四种单位；shallow-copy、stale writer 与 crash-durability 的准确边界。
