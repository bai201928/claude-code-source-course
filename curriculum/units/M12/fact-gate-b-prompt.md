# FACT_B 同会话对照提示词

继续刚才的 FACT_A 会话。现在请把你在阶段 A 独立得到的结论，与下面 Codex 的机制摘要和实验设计逐项对照。不要重新扩散阅读整个源码树；只有发现明确冲突时，才回到相关路径和符号定向核验。

## Codex 机制摘要

### generator 与消费者

```text
REPL.onQueryImpl 或 QueryEngine.submitMessage
-> for await 拉取 query()
-> query() 通过 yield* 委托 queryLoop()
-> queryLoop() 通过 for await 拉取 deps.callModel()
-> 处理/暂扣/收集模型事件后再向外 yield
-> 需要工具时通过 for await 拉取 toolUpdates
-> 向外 yield 工具进度或结果
```

Codex 结论：当前 `queryLoop()` 是 `while (true)` + 可替换 `State` 驱动的显式迭代状态机，没有对自身递归调用；`query_recursive_call` checkpoint 和相关注释不能作为递归证据。

### `yield*` 与 terminal

Codex 结论：`query()` 通过 `yield* queryLoop()` 转发产出并在内部正常 return 时取得 `Terminal`。只有正常 return 后，wrapper 才执行 consumed command 的 completed 通知。throw 或外部 `.return()` 会跳过这段正常完成代码。

REPL 与 QueryEngine 当前都以 `for await` 消费，只取得 yielded values，不读取 generator 最终 return value。REPL 在循环自然结束后做自己的成功收尾；QueryEngine 根据已消费消息、stream stop reason 与自身预算/输出状态生成 SDK result。

### 状态所有权

Codex 结论：`queryLoop.State` 是一次 query 执行中的 producer-local 跨迭代状态，不是 durable conversation owner。REPL 本地状态或 QueryEngine `mutableMessages` 由外层 consumer 在处理 yielded message 时写入；producer 则独立收集 `assistantMessages`、`toolResults` 并构造下一轮 state，所以它不依赖 consumer 把消息“回传”后才能继续。

### yield 顺序

代表性源码顺序：

1. assistant 路径先 `yield yieldMessage`，恢复后才 `assistantMessages.push(message)`、扫描 tool_use 并加入 streaming executor；
2. tool update 路径先 `yield update.message`，恢复后才把正规化 user/tool_result 放入 `toolResults`，并接收 `update.newContext`。

Codex 结论：consumer 在某个 yield 后提前关闭 generator 时，当前 yield 后尚未执行的 producer bookkeeping 不会继续发生；这与 durable owner 已消费该事件并不矛盾。

### Continue、Terminal 与取消

Codex 结论：context 恢复、max-output 恢复、Stop Hook blocking、token-budget continuation 和 tool feedback 都可以通过 `state = next; continue` 进入下一次迭代；completed、blocking/error、stream/tool abort、hook stop 和 max turns 通过 return 结束。当前快照缺少 `src/query/transitions.ts`，只能引用可见对象字面量，不能声称完整穷举类型联合。

AbortSignal 是协作式取消。streaming 或 tools 阶段收到取消后，Query Loop 仍可能为了 tool_use/tool_result 配对、interruption message 和清理而产出收敛事件，然后才返回 terminal；`abort()` 不等于 iterator 已立刻关闭。

## 拟写入教材的关键表述

1. “Async generator 把生产数据和转移控制权绑定在同一个 `yield`；consumer 的下一次 pull 才允许 producer 从该行之后继续。”
2. “Query Loop 拥有本次执行的循环 state，外层入口拥有 durable/UI conversation；两者通过事件同步，但不是同一个可变数组。”
3. “当前实现以 while state machine 表达多种 Continue/Terminal；不是递归 Tool Loop。”
4. “`for await` 消费事件但丢弃 generator return channel；QueryEngine 的 SDK result 是外层根据消息与统计重新构造的产品结果。”
5. “取消意图、generator close 和业务 terminal 是三个不同概念。”

## 实验设计

使用独立 clean-room TypeScript 与 Python，不运行静态快照、不调用真实模型：

- TypeScript `query()` 返回 `AsyncGenerator<QueryEvent, LoopTerminal>`，scripted model/tool 形成两轮 loop；
- 手动 `next()` 的 drain 能捕获 terminal，而 `for await` 对照只能观察事件；
- consumer 在 assistant event 后调用 `.return()`，验证 producer finally 执行、yield 后 bookkeeping 和下一轮请求不执行；
- 取消 model await，验证没有取消后的新 request；
- Python 由于 async generator 不允许携带非空 return value，改用显式 terminal event 或包装对象，并明确语言差异；
- 所有实验区分 producer local state 与 consumer-owned event log/store。

## Harness 取舍

当前正式 Harness 已有 awaitable `AgentEventSink`、显式 `AgentRunSummary`、取消传播和 event-sink failure isolation。Codex 候选裁决是：M12 在教材实验中完整实现 pull-based QueryEvent/Terminal；正式 Harness 本轮只强化三类边界与契约，不为模仿源码强行改成 AsyncGenerator。真正的 pull stream 与缓冲/背压/consumer close -> abort 设计延后到 M14 的真实 SSE 聚合一起处理。

## 审查要求

只检查：事实错误、重要遗漏、证据不足、层次混淆、版本/快照边界混淆，以及实验不能验证正文结论的问题。普通措辞偏好、目录格式和无现实影响的理论漏洞不构成 Issue。

输出必须以以下三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后按 Issue 列出：源码路径与符号、与 FACT_A 的对照、为什么影响教材或 Harness、应接受的修正或定向验证。没有实质问题时明确写 `No material issues`。

