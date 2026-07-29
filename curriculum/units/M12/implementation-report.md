# M12 实现与实验报告

状态：`implemented`

## 实现范围

M12 创建了一组不依赖真实模型、不修改源码快照的 clean-room 实验：

- `code/typescript/query-loop.ts`：`AsyncGenerator<QueryEvent, LoopTerminal>`、显式循环状态、模型 async generator、工具反馈、双 owner 和取消收敛；
- `code/typescript/query-loop.test.ts`：6 个控制流与状态契约测试；
- `code/typescript/demo.ts`：两轮 Tool Loop 时间线；
- `code/python/query_loop.py`：同一行为目标的 Python 实现，由 `QueryRun` 保存 terminal side channel；
- `code/python/test_query_loop.py`：5 个对称契约测试；
- `code/python/demo.py`：与 TypeScript 相同的两轮可观察运行。

这些代码是`运行验证`和`设计迁移`，不是 Claude Code 私有实现的复制。

## 被验证的结论

### 1. Pull 决定 producer 何时继续

两种语言都记录了以下顺序：

```text
producer.assistant.before_yield
consumer.assistant.persist
producer.assistant.after_yield
```

只有 consumer 再次请求下一项，producer 才执行 `yield` 后的本地 bookkeeping。

### 2. Producer local state 与 durable conversation 是两个 owner

两轮工具实验中，producer 不依赖 consumer 回传消息，自己把：

```text
初始 user + assistant tool_use + user tool_result
```

组成第二次模型请求，因此两次请求消息数为 `[1, 3]`。与此同时，`DurableConversation` 独立消费 assistant 与 tool result 事件，最终持有 4 条会话消息。两者同步观察同一运行，但不共享一个可变数组。

### 3. TypeScript 的事件与 terminal 是两个通道

手动 `.next()` 可以同时得到 5 个事件和：

```json
{"reason":"completed","turns":2}
```

普通 `for await` 只能取得 yielded events。循环耗尽后再次 `.next()` 得到 `done: true, value: undefined`，原 terminal 已没有接收位置。

### 4. Python 不能伪造 TypeScript return channel

Python async generator 不允许 `return <value>`。Python 实现让 `QueryRun.terminal` 成为显式 side channel：自然耗尽后可读，消费者 `aclose()` 后保持 `None`。这保留了“业务完成”和“consumer close”不可混同的契约，而没有逐行翻译 TypeScript。

### 5. Consumer close 跳过普通后续代码，但执行退出清理

TypeScript 在 assistant event 后调用 iterator `.return()`，Python 在同一点调用 `aclose()`。两边都观察到：

- `producer.assistant.after_yield` 未执行；
- producer 与 wrapper 的 `finally` 执行；
- wrapper 的 `normal_completion` 未执行；
- 没有 terminal business reason。

### 6. Model await 期间取消不会开始下一轮

模型脚本停在可取消等待上，测试在 request event 后触发取消。两边都先产出 `interruption(model)`，再以 `aborted` 收敛，模型请求总数保持 1。

### 7. 可恢复的模型失败可走事件与 terminal

脚本化模型抛出普通异常时，clean-room 状态机产出 `model_error` 事件，并以 `model_error` terminal 结束。该实验只验证本教材协议；Claude Code 中仍可能存在未捕获异常穿过 `yield*` 的路径。

## 实际运行结果

环境：Node `v24.14.1`、Python `3.11`、项目锁定 TypeScript `7.0.2`。

```text
TypeScript M12 contract tests: 6 passed
TypeScript strict typecheck: passed
Python unittest: 5 passed
TypeScript demo: events=5, requests=[1,3], terminal=completed/2
Python demo: events=5, requests=[1,3], terminal=completed/2
```

首次运行暴露 Node strip-only 不支持构造器参数属性，已改为显式字段声明。这是运行环境兼容修改，不改变行为契约。

## 反证条件结果

| 反证条件 | 结果 |
| --- | --- |
| 无 consumer pull，producer 仍越过 `yield` 自行完成 | 未发生 |
| consumer close 后，yield 后 bookkeeping 或下一轮模型请求继续 | 未发生 |
| TypeScript `for await` 直接取得 generator terminal | 未发生 |
| 模型等待期取消后仍开始第二次请求 | 未发生 |
| durable owner 与 producer next state 必须共享同一数组 | 未发生 |

## Harness 裁决

Decision: `merge + defer`

Merge：把 durable state、observer event、terminal summary 三种契约明确写入 H2 架构文档。当前正式 Harness 已有 durable `ConversationStore`、可等待 `AgentEventSink` 与显式 `AgentRunSummary`，并已有 sink 失败不接管控制流的测试，M12 不需要复制实验 API。

Defer：完整 `AgentRunStream` 延后到 M14。届时必须同时决定缓冲上限、背压、consumer close 到 `AbortSignal` 的传播、SSE 上游关闭和 terminal summary 的获取方式。

Reject：本轮不把 callback sink 包装成无界 async queue，也不为了表面模仿 Claude Code 将稳定 runtime 重写为 `AsyncGenerator`。

Compatibility：M12 不改变现有 runtime API；H0、H1、H2-in-progress 的累计回归应保持通过。

## 候选稿最终验证

- 11/11 Mermaid 图使用 Mermaid CLI `11.16.0` 实际渲染成功；
- TypeScript M12 `6/6`，strict typecheck 通过；
- Python M12 `5/5`；
- 集成 TypeScript Agent `34/34`，集成 Agent 回归 `4/4`；
- H2-in-progress `4/4`，包含 H1 `12/12` 与 S0 `15/15`；
- 教学闸门 `PASS / 0`；
- `release-candidate.md` 已生成，`final.md` 保持缺失。

## 证据边界

- `快照事实`：当前 `query()`/`queryLoop()`、REPL/QueryEngine 消费、yield 顺序、early close、Stop Hook 委托与 memory prefetch dispose 来自直接源码核验和事实双闸门。
- `运行验证`：本文件的测试结果只证明 clean-room 行为。
- `设计迁移`：`QueryRun.terminal`、`DurableConversation` 与 Harness defer 决策是本课程设计。
