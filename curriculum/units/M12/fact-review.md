# M12 事实闸门记录与 Codex 裁决

状态：`fact-reviewed`

审查会话：`6e8b49e4-3b84-4858-bdd8-3f39396c2e6a`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max；FACT_A/FACT_B 主审实际模型记录为 `deepseek-v4-pro[1m]`，首轮路由包含 `deepseek-v4-flash`。两次有效进程均自然退出，无应用层超时、无权限拒绝。

第一次启动因 `--tools` 没有授予读取权限而作废；显式增加 `--allowedTools Read,Glob,Grep` 后，用新的独立会话重新执行 FACT_A。作废调用没有读取源码，也没有进入裁决。

## 闸门结果

```text
GATE: FACT_A
VERDICT: PASS
MATERIAL_ISSUES: 6
```

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 3
```

FACT_A 的头部把 `PASS` 与 6 个 issue 同时给出，不能机械采纳；其中多项是审查者自身误读。FACT_B 对照 Codex 摘要后确认核心机制，并提出 3 个补充点。最终裁决以源码和可运行实验为准。

## 已确认事实

- `query()` 用 `yield* queryLoop()` 转发 yielded values，并只在内部正常 return 后执行 command completed 通知。
- `queryLoop()` 当前是 `while (true)` 和显式 `State` 的迭代状态机，不是递归。
- REPL 与 QueryEngine 都用 `for await` 消费 `query()`，不读取 generator return `Terminal`。
- Query Loop 的跨迭代 state 与外层 durable/UI conversation 属于不同 owner。
- assistant 与 tool update 路径都先向外 yield，恢复后才完成对应的 producer-local bookkeeping。
- abort 是协作意图；Query Loop 可能先 yield 配对/中断等收敛事件，再正常 return abort terminal。
- `queryLoop()` 还通过 `yield* handleStopHooks()` 转发过程事件并取得 `StopHookResult`。
- `using pendingMemoryPrefetch` 依赖 `[Symbol.dispose]()` 在 generator 的 return、throw 和 `.return()` 退出路径上清理该预取资源。
- 快照缺少 `src/query/transitions.ts`，不能声称完整确认 `Terminal`/`Continue` 联合定义。

## 对 FACT_A 的纠正

### A-1 yield 顺序

Decision: `rebutted`

`src/query.ts` 先在约 824 行 `yield yieldMessage`，恢复后才在约 827 行 `assistantMessages.push(message)`；工具路径先在约 1386 行 yield，恢复后才在约 1395 行把正规化结果放入 `toolResults`。FACT_A 将两处顺序写反。

### A-2 consumer 不 pull 后 producer 仍执行

Decision: `rebutted`

Async generator 在 yield 处暂停，下一次 `.next()` 才继续。consumer early close 会调用 iterator `.return()`，执行退出清理但跳过 yield 后普通代码。已经由其他 owner 启动的 Promise 或工具任务可能继续，不等于 generator 自己继续推进。

### A-3 abort 与 early close

Decision: `rebutted`

signal abort 不会让 `for await` consumer 自动 return。Query Loop 通常继续被 pull，补齐协议消息后正常 return `aborted_streaming` 或 `aborted_tools`。consumer close 是外层主动停止迭代，语义不同。

### A-4 withheld 413 必然丢失

Decision: `rebutted`

FACT_A 构造了“对应恢复模块编译掉但 withheld 仍为 true”的不一致组合。当前代码只有启用的 collapse/reactive/media/max-output 分支才设置 withheld，并有对应 surface/recovery 分支；该推断不能成为教材事实。

### A-5 可注入 callModel 的契约风险

Decision: `rebutted`

`QueryDeps.callModel` 使用 `typeof queryModelWithStreaming`；错误 fake 属于测试调用方违反端口契约。普通数组是同步 iterable，也可以被 `for await` 消费。缺失 transitions 类型文件与该依赖类型无关。

## 对 FACT_B 的处理

### B-1 多层 yield* 委托

Decision: `accepted`

教材增加 `queryLoop -> yield* handleStopHooks`，但只用于解释事件转发和终值捕获，不提前展开 Hook 规则。

### B-2 缺失 transitions 类型

Decision: `accepted`

教材仅列出当前 return/transition 对象字面量的代表性 reason，明确不是完整类型穷举。

### B-3 using 与 Explicit Resource Management

Decision: `accepted`

教材解释 `using`、`[Symbol.dispose]` 与 generator 退出的关系，并限制结论到 memory prefetch handle；clean-room 实验用 `finally` 呈现通用生命周期，说明形状差异。

## 结论

事实闸门闭合。M12 可以进入双语言实验和教材写作，核心叙事以 pull 驱动、显式状态机、双 owner 轨道和三种结束语义为准。
