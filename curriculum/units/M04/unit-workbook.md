# M04 研究工作簿

状态：`final`

Graphify 只用于候选定位；以下机制结论均回到当前 `claude-code-CLI/` 静态快照核验。

## 1. 核心问题与边界

核心问题：面对导入、类型引用、同文件包含、图邻接、回调参数和真实调用混在一起的大型 TypeScript 项目，怎样重建一条可以被源码和实验推翻的运行解释？

本单元讲源码追踪方法，不提前完整讲解 Query 状态机、模型流、Tool Loop 或持久化。真实样本选用 `ask()`、`QueryEngine.submitMessage()`、`processUserInput()` 与 `query()`，因为它同时包含构造、依赖注入、状态 owner、浅快照、条件分支、async generator 和状态副作用。

风险：R1。主要风险是把结构关系升级成运行事实，或只证明“函数被调用”却没有证明传了什么数据、改了谁的状态和失败后留下什么。

## 2. Graphify 候选与直接源码核验

图谱查询先后出现两个失败模式：高频词查询扩展到 253 个节点，`query engine` 又因同名 `ink/layout/engine.ts` 扩展到 1149 个节点。它们证明图命中量不是证据质量。

定向 `explain .submitMessage()` 后选择两条候选：

1. `EXTRACTED calls`：`.submitMessage() -> query()`，位置 `src/QueryEngine.ts:L675`。
2. `INFERRED indirect_call`：`.submitMessage() -> tool()`，位置 `src/QueryEngine.ts:L253`。

源码核验：

- 第一条为真：`for await (const message of query({...}))` 是运行时调用和消费边；但只有 `shouldQuery` 为真并走过前置本地分支后才发生。
- 第二条为假：`tool` 是 `wrappedCanUseTool` 的形参，L252-L259 实际调用的是注入的 `canUseTool(tool, input, ...)`；没有执行 `tool()`。
- `QueryEngine.ts imports query` 只证明模块可见性；`QueryEngine contains submitMessage` 只证明成员归属；两者都不能代替上述调用点。

## 3. 真实纵向样本

```text
ask()
-> new QueryEngine(initialMessages, injected dependencies)
-> yield* engine.submitMessage(prompt)
-> processUserInput(prompt, mutableMessages)
-> mutableMessages.push(user/attachment messages)
-> messages = [...mutableMessages] request-side array snapshot
-> shouldQuery ? query(params) : local result branch
-> for await query events
-> selected events mutate mutableMessages / transcript / usage
-> SDK messages yield to caller
-> ask finally copies read-file state back to outside owner
```

决定性边界：

- `QueryEngine` 拥有跨 turn 的 mutable messages、abort controller、usage、permission denials、file state 与发现集合。
- `messages = [...this.mutableMessages]` 是当前 turn 的数组视图，不是深冻结；后续向两个数组 push 不改变彼此长度，但元素对象仍可能共享身份。
- `processUserInput()` 是真实调用；它返回的 `shouldQuery` 决定是否进入 `query()`。
- `for await` 不只消费值：switch 分支把 assistant/progress/user/attachment 推入 owner store，并记录 transcript 或 usage。
- `ask()` 是 one-shot adapter；`finally` 负责把 engine 内的 read-file state 交回外部 callback。

## 4. 证据梯子

源码解释按强度逐层推进：

```text
名字/搜索命中
< import、contains、references
< 具体 call site 与条件
< 参数/返回/事件的数据流
< 状态 owner 与 mutation site
< 失败、取消、finally 和恢复边界
< 测试、日志或最小复现的可观察结果
```

低层证据不是无用，而是只能回答较弱问题。一个 import 可以帮助定位，但不能证明分支在真实运行中被执行；一个 call site 可以证明可能调用，却不能证明特定输入下必然调用。

## 5. 双语言实验

clean-room 实验注入 `processInput` 与 `query`，用 `TraceLog` 记录：

- `call.entered`：谁调用谁；
- `state.mutated`：哪个 owner 修改哪个字段；
- `view.snapshotted`：何时创建请求视图；
- `event.yielded`：异步边界产生了什么；
- `branch.skipped`：为何未进入 Query；
- `call.failed`：部分状态后在哪里失败。

代表性反证：把 `tool` 作为参数传给 permission callback，但不执行 `tool.run()`。若仅看图的 indirect call 或变量名，容易误报调用；运行计数必须保持 0。

共享行为契约：主路径观察到 input/query 调用与状态变化；本地分支 query 调用数为 0；请求数组视图不随 owner 后续 append 增长；传参不等于调用；query 在产生部分消息后失败时，已写状态不会自动回滚。

## 6. H0 候选

- `TraceEvent`：稳定事件联合，继承 M01 的判别思路。
- `TraceLog`：只记录可观察事实，不把静态结构边伪装成运行边。
- `ProcessInput` / `QueryStream`：显式注入依赖，继承 M02 的异步事件协议。
- `StateOwner` 约定：mutation event 必须写 owner 与 field。
- `Cancellation/Resource` 事件：后续合并 M03 requested/exited/cleanup 顺序。
- 同一组 TypeScript/Python 行为测试名称和不变量。

初步裁决：`merge` 行为追踪与跨语言测试骨架。Graphify 候选、Claude Code 私有符号和图边不进入通用 Harness。

事实闸门结果：FACT_A `REVISE / 2`，FACT_B `PASS / 0`。接受当前快照缺少 `src/query/transitions.ts` 与 QueryEngine 专题测试的证据边界；FACT_A 在盲审阶段无法读取作者最小复现，FACT_B 已确认双语言 5/5 覆盖声明的 H0 契约且不冒充官方测试。

## 7. 证据边界

QueryEngine 调用、状态与分支是快照事实；Graphify 的两个候选只记录导航价值和准确性边界；双语言 TraceableEngine 是运行验证；H0 TraceLog 与测试骨架是设计迁移。
