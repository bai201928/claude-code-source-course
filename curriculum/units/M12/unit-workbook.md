# M12 研究工作簿

状态：`release-candidate`

本文件是作者工作区，不是教材正文。Graphify 只用于入口候选定位；下面标为“快照事实”的结论均已回到 `claude-code-CLI/` 直接核验。

## 1. 单元问题、边界与风险

核心问题：`query()` 返回的是 `AsyncGenerator`，那么一次 Agent 运行究竟由谁推进？模型流、Query Loop 和入口消费者之间怎样交接控制权？什么状态在 producer 内部跨迭代携带，什么状态必须由 REPL 或 QueryEngine 消费后写回？取消、错误、消费者提前退出和正常返回为什么不是同一种结束？

本单元复用：

- M02 的 `AsyncGenerator`、`yield`、`yield*`、`for await`、提前退出和 `finally`；
- M03 的 `AbortSignal`、协作式取消和资源收敛；
- M07 的进程、会话、请求局部状态分层；
- M10 的会话 owner 与查询快照；
- M11 的两入口汇合、请求投影和 Tool Loop 全链路。

本单元不替代后续专题：

- M13 才完整解释请求投影、压缩与 API 配对正规化；
- M14 才完整解释网络流事件组装、重试、usage 与成本；
- M15 才完整解释工具并发分组、Permission、Hook 和执行细节。

风险：`R2`。如果把 generator 当作“异步返回一个数组”，就会同时误判控制权、背压、状态提交顺序、取消收敛和消费者提前退出；如果把 Query Loop 的局部 state 写成持久会话 owner，又会与 M10/M11 冲突。

## 2. Graphify 候选与直接核验

Graphify 查询候选集中在：

- `src/query.ts`：`query()` 约 219 行、`queryLoop()` 约 241 行；
- `src/QueryEngine.ts`：`submitMessage()` 对 `query()` 的消费约 675 行；
- `src/screens/REPL.tsx`：`onQueryImpl()` 对 `query()` 的消费约 2793 行；
- `src/query/deps.ts`：`productionDeps()` 与 `callModel`；
- `src/utils/generators.ts`、`src/utils/stream.ts`；
- `src/services/tools/toolOrchestration.ts`、`StreamingToolExecutor.ts`。

Graphify 给出 `queryLoop -> runTools` 的 `EXTRACTED` 调用边；给出 `queryLoop -> productionDeps -> queryModelWithStreaming` 的第二跳为 `INFERRED indirect_call`。直接源码核验后确认：

- `queryLoop()` 直接调用 `runTools()` 的非 streaming 分支；
- `queryLoop()` 调用的是 `deps.callModel()`；
- `src/query/deps.ts` 的 `productionDeps()` 才把 `callModel` 绑定到 `queryModelWithStreaming`；
- 测试或其他调用方可通过 `QueryParams.deps` 替换该依赖。

证据状态：上述调用关系为`快照事实`；Graphify 自身不进入教材证据。

## 3. 当前版本不是递归，而是显式迭代状态机

`query()` 是很薄的包装器：

```text
query(params)
-> 创建 consumedCommandUuids
-> yield* queryLoop(params, consumedCommandUuids)
-> 仅在 queryLoop 正常 return 后通知 consumed command completed
-> return Terminal
```

`queryLoop()` 当前实现：

1. 拆出不跨轮修改的参数；
2. 选择 `params.deps ?? productionDeps()`；
3. 建立可替换的 `State`；
4. 进入 `while (true)`；
5. 每次迭代顶部从 `state` 解构；
6. 在各恢复、Hook、预算或工具反馈分支用 `state = next; continue`；
7. 在完成、取消、错误和上限分支 `return Terminal`。

决定性位置：`src/query.ts:219-238`、`241-321`、`1099-1115`、`1207-1220`、`1282-1305`、`1714-1728`。

源码仍有 `query_recursive_call` checkpoint 和“about to recurse”类注释，但当前控制流没有 `queryLoop()` 自调用。教材必须按当前 `while` 状态机讲解，并将这些名称解释为历史/观测命名，不能反推真实递归。

## 4. 三层 generator 形成控制权接力

主路径不是单个 generator：

```text
入口消费者（REPL / QueryEngine）
  pull query().next()
    -> query() 通过 yield* 委托 queryLoop()
      -> queryLoop() 通过 for await 拉取 deps.callModel()
        -> 模型 generator 产出 stream/message
      -> queryLoop() 处理后再 yield 给入口消费者
      -> 需要工具时再通过 for await 拉取 toolUpdates
        -> tool generator 产出 progress/result/context update
      -> queryLoop() 再 yield 给入口消费者
```

因此：

- 模型 generator 的产物不会自动穿透到 UI；`queryLoop()` 先检查、分类、收集或暂扣；
- `queryLoop()` 的 `yield` 把控制权交回入口消费者，并暂停当前位置；
- 入口消费者处理完成并请求下一项后，producer 才从该 `yield` 后继续；
- consumer 的处理速度可以对 producer 形成自然背压，但已在别处并发启动的任务不因此自动停止。

正常结束路径还存在一层同构委托：`queryLoop()` 在没有 tool follow-up 时通过 `yield* handleStopHooks()` 转发 Hook 过程消息，并取得 `StopHookResult` 决定完成、阻断结束还是把 blocking errors 放回下一轮。M12 只借它说明“`yield*` 可以在多层协议中同时转发事件和接收终值”，Hook 业务规则留给后续专题。

## 5. `yield` 既是事件出口，也是提交顺序边界

两个决定性例子：

### 5.1 assistant 消息

`src/query.ts` 约 823-845 行：

```text
yield yieldMessage
-- producer 暂停，外层消费者先处理 --
assistantMessages.push(originalMessage)
扫描 tool_use
可能加入 StreamingToolExecutor
```

外层 QueryEngine 在消费 assistant 时，会把消息追加到 `messages` 和 `this.mutableMessages`，并投影为 SDK 输出。producer 只有在下一次 pull 后才把原始 message 放入自己的 `assistantMessages`。

### 5.2 tool update

`src/query.ts` 约 1384-1407 行：

```text
yield update.message
-- 外层消费者先处理 --
normalizeMessagesForAPI([update.message])
toolResults.push(...)
接收 update.newContext
```

结论：`yield` 前后的代码不能随意互换。消费者若在该事件后提前退出，generator 会被关闭，当前 `yield` 后尚未执行的 producer bookkeeping 不会继续完成。这个事实必须用 clean-room 实验验证，而不能只靠语法解释。

## 6. producer 局部状态与 durable conversation 必须分开

`queryLoop()` 拥有的是一次 query 执行期间的循环状态：

- 当前迭代输入 `state.messages`；
- 当前 `toolUseContext`；
- compact/recovery 追踪；
- max output token 恢复次数；
- pending tool summary；
- turnCount 与上一次 `Continue` 原因。

每轮发起模型请求前，它从 `state.messages` 派生 `messagesForQuery`。出现工具结果时，它把：

```text
messagesForQuery + assistantMessages + toolResults
```

组装为下一轮 `State.messages`，然后 `continue`。

但 durable/UI 状态由外层消费者维护：

- REPL：`onQueryEvent(event)` 进一步交给消息处理器和 React 状态；
- SDK/Headless：`QueryEngine.submitMessage()` 在 switch 分支中把 assistant、user、progress、attachment、system 等分别写入 `messages` 与 `this.mutableMessages`，并投影为 SDK 事件。

这形成两条同步但职责不同的轨道：

```text
producer local state：保证当前 query 的下一次模型迭代能继续
consumer durable/UI state：保证会话、Transcript 与输出表面能观察和恢复
```

不能说“Query Loop yield 后等待消费者把消息写回，下一轮才能继续”。producer 自己已经收集原始 assistant/tool result 并构造 next state；消费者写回服务的是外层 owner 和输出语义。

## 7. `for await` 消费事件，但看不到 generator 的 return 值

`query()` 的类型声明把产出值和终止值分开：

```text
AsyncGenerator<QueryEventUnion, Terminal>
```

`yield* queryLoop()` 会把内部 generator 的普通产出继续向外转发，也会在内部正常结束时取得其 `Terminal` 并由 `query()` 返回。

但当前两个主消费者都使用：

```ts
for await (const event of query(...)) { ... }
```

`for await` 只暴露 `done: false` 的值，不提供最终 `done: true` 携带的 return value。REPL 在循环自然结束后执行自己的成功收尾；QueryEngine 则根据已消费消息、stream stop reason、预算和结构化输出状态生成自己的 SDK `result`。它们没有读取 `query()` 的 `Terminal`。

若调用方确实需要 return value，必须手动循环 `iterator.next()`，或使用能保留终值的 helper。`src/utils/generators.ts:returnValue()` 展示了捕获 generator 终值的另一种消费方式，但不能把它误写成当前 REPL/QueryEngine 的实际调用。

QueryEngine 还给出三个具体的 consumer early-close 点：在消费循环中遇到 `max_turns_reached` attachment、达到 `maxBudgetUsd`、或超过 structured output retry 上限时，它先 yield 自己的 SDK error result，随后直接 `return`（约 873、1001、1046 行）。特别是 max-turns 路径，`queryLoop()` 先 yield attachment，QueryEngine 随即 return，于是 producer 尚未恢复执行紧随其后的 `return { reason: 'max_turns' }`。这不是错误，而是两层协议各自终止；它证明不能把 inner Terminal 与 SDK result 画成同一个对象。

## 8. 继续与结束不是一个布尔值

当前 `continue` 至少服务于不同语义：

- context collapse drain 后重试；
- reactive compact 后重试；
- max output token 提升或恢复；
- Stop Hook 阻断信息加入上下文后重试；
- token budget 续写；
- 工具结果进入下一轮模型请求。

当前可直接从 return sites 观察到的 Terminal reason 包括：

- `blocking_limit`；
- `image_error`；
- `model_error`；
- `aborted_streaming`；
- `prompt_too_long`；
- `completed`；
- `stop_hook_prevented`；
- `aborted_tools`；
- `hook_stopped`；
- `max_turns`。

快照缺少 `src/query/transitions.ts`，因此无法从原始类型定义完整确认 `Continue`/`Terminal` 联合和字段。教材可以引用当前可见的 return/transition 对象，但必须标明缺失文件边界，不得声称穷举了原类型。

## 9. 取消、错误与消费者退出的差异

### 9.1 协作式取消

同一个 signal 传给模型调用和工具上下文。Query Loop 在模型流结束、工具收敛等边界再次检查：

- streaming 阶段取消：消费 StreamingToolExecutor 剩余结果或合成缺失 tool result，再可选产出 interruption message，返回 `aborted_streaming`；
- tool 阶段取消：工具更新先收敛，必要时产出 interruption/max-turn attachment，返回 `aborted_tools`。

`abort()` 是取消意图，不等于 generator 已经关闭；producer 仍可能为了协议配对和资源清理继续 yield 若干收敛事件。

### 9.2 producer 错误

模型调用的代表性异常在 Query Loop 内被转成 API error message 和 `model_error` terminal；已经暴露的 tool_use 会先得到合成 tool_result。其他未捕获异常可继续穿过 `yield*` 抛给消费者，`query()` 的正常 completion 通知不会执行。

### 9.3 consumer 提前退出

`break`、consumer body 抛错或显式 `iterator.return()` 会请求关闭 generator。通过 `yield*`，关闭继续传给 `queryLoop()`；`query()` 中只在正常 return 后执行的 command completed 通知会被跳过。提前退出不是业务 terminal reason，也不应伪装成 `completed`。

当前 Query Loop 还有一个真实的退出清理机制：入口处用 `using pendingMemoryPrefetch = ...` 绑定一个带 `[Symbol.dispose]()` 的 handle。正常 return、throw 或 consumer `.return()` 关闭 generator 时都会调用 dispose；该方法 abort 子 controller 并记录 terminal telemetry。`using` 是 JavaScript/TypeScript Explicit Resource Management 语法，可把十多个 return site 的共同清理集中到资源声明处。它仍不代表所有模型/工具资源自动结束：这里只能确认 memory prefetch handle 的 dispose 契约。

## 10. Clean-room 实验设计

实验不运行静态快照，不调用真实模型，TypeScript 与 Python 分开表达各自语言能力。

TypeScript：

- `query()` 返回 `AsyncGenerator<QueryEvent, LoopTerminal>`；
- `scriptedModel()` 是 async generator，可产生 assistant/tool_use 或抛错；
- `drainWithTerminal()` 手动 `next()`，同时收集事件和 terminal；
- `for await` 对照路径证明事件可见而 return terminal 不可见；
- 在 `yield assistant` 后放置 producer bookkeeping，consumer 提前 `return()`，断言 bookkeeping 未执行但 `finally` 执行；
- 取消发生在 model await 时，断言没有下一轮 request；
- tool_use -> tool_result -> 第二次 request -> final text 验证 next state。

Python：

- Python async generator 不能携带非空 return value，因此 terminal 作为显式事件或由包装对象保存；
- 其余实验保持同一行为目标：pull、yield 后暂停、`aclose()`、取消传播和 next-state 组装；
- 教材必须明确这是语言差异，不能伪造 TypeScript 的 return channel。

反证条件：

1. producer 在没有 consumer pull 时仍无条件完成全部循环；
2. consumer 提前退出后，yield 后 bookkeeping 或下一轮模型调用仍发生；
3. TypeScript `for await` 能直接取得 generator return terminal；
4. 取消后仍开始新的模型请求；
5. 外层 owner 写回与 producer next state 被描述或实现为同一个数组。

## 11. Harness 候选裁决

当前 `mini-agent-harness` 已有：

- `AgentEvent` 与可 await 的 `AgentEventSink`；
- `submit()` 返回显式 `AgentRunSummary`；
- signal 向模型、Permission 与工具传播；
- single-flight run lease、最大轮次和配对恢复。

候选：

- `merge`：在 H2 契约与架构文档中明确区分 durable state、observer event 和 terminal summary；补一条测试证明 event sink 失败不能拥有控制流（当前已有）。
- `defer`：不要只为模仿 Claude Code 把当前稳定 runtime 重写为 `AsyncGenerator`。等 M14 实现真实 SSE 聚合时，再决定是否增加 pull-based `AgentRunStream`，并同时设计缓冲、背压、consumer close -> abort 和 terminal summary 获取语义。
- `reject`：把 callback sink 直接包装成无界队列，却不处理提前退出和取消；这会制造比当前实现更差的资源语义。

初步判断：教材实验实现 pull-based QueryEvent/Terminal；正式 Harness 本轮以文档/契约合并为主，完整 AsyncIterable API 延后到 M14。事实与教学闸门后再最终裁决。

## 12. 当前证据边界

- 源码为发布包 source map 静态分析快照，不含 `package.json`、原始测试和若干类型文件；不能声称原项目可构建或测试通过。
- `src/query/transitions.ts` 在当前快照缺失；Terminal/Continue 只能从 import、类型使用和对象字面量反向观察。
- feature gate 的运行值无法仅靠静态快照确定；教材只描述决定性分支，不把某一 gate 当作所有环境的默认路径。
- 源码结论为`快照事实`，clean-room 行为为`运行验证`，Harness API 取舍为`设计迁移`。

## 13. 事实双闸门裁决

FACT_A 使用独立会话完成源码研究，但其 `PASS / 6` 头部自相矛盾，且正文包含三类错误：把 assistant/tool-result 的 yield 前后顺序读反；声称 consumer 不再 pull 后 producer 仍会自行执行；把 signal abort 与 consumer close 混同。FACT_B 在同一会话看到 Codex 摘要后重新核对源码，确认正确顺序和 pull 语义，并给出 `PASS / 3`。

Codex 裁决：

- 接受：当前实现是 while 状态机；两主消费者丢弃 generator return channel；producer local state 与 outer durable state 分离；abort 后仍可能 yield 收敛事件；缺失 transitions 类型文件。
- 接受并补充：`yield* handleStopHooks()` 是多层委托实例；`using` / `[Symbol.dispose]` 是当前 memory prefetch 的真实退出清理。
- 驳回：无人 pull 时 queryLoop 会自行跑完。async generator 在 yield 处暂停，除非已独立启动的 Promise/工具任务在自己的 owner 下继续。
- 驳回：编译掉 compact gate 会必然吞掉 withheld 413。withheld 标志本身由对应启用分支设置，FACT_A 的组合假设不成立。
- 驳回：`QueryDeps.callModel` 注入是材料问题。类型使用 `typeof queryModelWithStreaming` 保持契约；普通数组本身也可被 `for await` 消费，非 iterable fake 才是调用方违反类型。
- 限定：signal abort 通常由 Query Loop 正常收敛并 return，因此会走 wrapper 的正常完成段；只有外层 consumer 自身 early return/throw/break 才属于 iterator close。
