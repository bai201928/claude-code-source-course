# M11 研究工作簿

状态：`release-candidate`

本文件是作者工作区，不是教材正文。所有 Graphify 输出只用于定位候选源码，下面标为“快照事实”的结论均已回到 `claude-code-CLI/` 直接核验。

## 1. 单元问题、边界与风险

核心问题：一次普通用户输入如何从交互式 REPL 或 SDK/Headless 入口成为会话消息，进入 `query()`，被投影为模型请求，在模型返回 `tool_use` 后执行工具、形成 `tool_result`，并触发下一次模型请求？

本单元闭合端到端纵切，但不替代后续专题：

- M12 详细讲 `AsyncGenerator`、消费者提前退出和 Query Loop 控制流；
- M13 详细讲所有 Context 投影、压缩和 API 合法化规则；
- M14 详细讲流事件组装、重试、成本和 Span；
- M15 详细讲工具并发、Permission、Hook 与执行细节。

风险：`R2`。原因是它同时涉及共享可变消息、不可变查询快照、异步流、取消和两轮 Tool Loop；入口归属或消息层级写错会污染后续课程心智模型。

## 2. Graphify 候选与直接核验

Graphify 候选集中在 `REPL.tsx`、`AppStateStore.ts`、`QueryEngine.ts`、`query.ts`、`query/deps.ts`、`services/api/claude.ts`、`StreamingToolExecutor.ts` 和 `toolOrchestration.ts`。

直接核验后的边界：

- `AppStateStore.ts` 是权限、工具、任务等运行状态的重要容器，但 REPL 主会话消息的直接所有者不是 AppState。
- REPL 消息由 `REPL.tsx` 的本地 React `messages` 和同步更新的 `messagesRef` 维护。
- REPL 不调用 `QueryEngine`；它通过 `handlePromptSubmit -> processUserInput -> onQuery -> onQueryImpl -> query()`。
- Headless `print.ts` 维护跨 `ask()` 调用共享的 `mutableMessages`；`ask()` 每次创建一个 `QueryEngine`，把该数组作为 `initialMessages` 传入，再调用 `submitMessage()`。
- 两条路径在 `query()` 汇合。Graphify 的 `imports`、`contains` 和无向最短路径不作为上述结论的证据。

证据状态：`快照事实`。

## 3. 两条输入适配路径

### 3.1 REPL

```text
用户提交
-> REPL.onSubmit
-> handlePromptSubmit
-> executeUserInput
-> processUserInput
-> processTextPrompt / createUserMessage
-> onQuery(newMessages)
-> setMessages(...newMessages)
-> latestMessages = messagesRef.current
-> onQueryImpl(latestMessages)
-> query(...)
```

决定性位置：

- `src/screens/REPL.tsx`：`messages`/`messagesRef` 创建于约 1182 行，`setMessages` 同步更新 ref 于约 1198 行。
- `src/utils/handlePromptSubmit.ts`：`executeUserInput()` 约 396 行；调用 `processUserInput()` 约 476 行；聚合 `newMessages` 约 513 行；交给 `onQuery()` 约 560 行。
- `src/utils/processUserInput/processUserInput.ts`：`processUserInput()` 约 85 行；普通文本最终进入 `processTextPrompt()` 约 577 行。
- `src/utils/processUserInput/processTextPrompt.ts`：普通输入通过 `createUserMessage()` 形成 `type: 'user'` 消息，约 19 至 96 行。
- `src/screens/REPL.tsx`：`onQuery()` 约 2855 行，先追加 `newMessages`，随后从同步 ref 读取 `latestMessages`；`onQueryImpl()` 约 2661 行并在约 2793 行消费 `query()`。

关键语义：React render state 是 UI 投影；同步 ref 让同一调用栈在 React 调度前也能读到刚追加的用户消息。这里不能简单写成“setState 后立即读取 state”。

### 3.2 SDK / Headless

```text
print/SDK 输入队列
-> print.ts 共享 mutableMessages
-> ask(... mutableMessages)
-> new QueryEngine(initialMessages: mutableMessages)
-> QueryEngine.submitMessage
-> processUserInput
-> mutableMessages.push(...new input messages)
-> messages = [...mutableMessages]
-> query(...)
```

决定性位置：

- `src/cli/print.ts`：共享数组约 1145 行；调用 `ask()` 约 2147 行并传入同一 `mutableMessages` 约 2167 行。
- `src/QueryEngine.ts`：类约 184 行；字段约 186 行；构造时接收 `initialMessages` 约 202 行；`submitMessage()` 约 209 行。
- `src/QueryEngine.ts`：调用 `processUserInput()` 约 416 行；将结果 push 到内部数组约 431 行；以展开运算符创建当前查询快照约 434 行；消费 `query()` 约 675 行。
- `src/QueryEngine.ts`：`ask()` 约 1186 行，每次创建 engine 约 1249 行，再委托 `submitMessage()` 约 1288 行。

关键语义：Headless 的长期消息连续性来自 `print.ts` 共享数组；单次 `ask()` 内部由 QueryEngine 管理。对普通 prompt，QueryEngine 的数组字段与传入数组最初是同一对象，push 会反映到共享数组；本次 `query()` 读取的是约 434 行创建的浅拷贝快照。

## 4. 汇合后的主循环

核验后的生产调用链：

```text
query()
-> queryLoop()
-> productionDeps().callModel
-> queryModelWithStreaming()
-> queryModel()
-> normalizeMessagesForAPI()
-> paramsFromContext()
-> anthropic.beta.messages.create({ ...params, stream: true })
```

决定性位置：

- `src/query.ts`：`query()` 约 219 行；`queryLoop()` 约 241 行。
- `src/query.ts`：每轮从会话/循环状态派生 `messagesForQuery` 约 365 行；之后经过 Tool Result Budget、microcompact、collapse/autocompact 等请求视图处理。
- `src/query.ts`：约 659 行调用注入的 `deps.callModel()`，同时把 `userContext` 前置，并传入 system prompt、工具、signal 和请求选项。
- `src/query/deps.ts`：`productionDeps()` 约 33 行，把 `callModel` 绑定到 `queryModelWithStreaming`。
- `src/services/api/claude.ts`：`queryModelWithStreaming()` 约 752 行，内部委托 `queryModel()` 约 1017 行。
- `src/services/api/claude.ts`：约 1266 行才把内部消息正规化为 API 消息，约 1301 行修复 `tool_use`/`tool_result` 配对；约 1538 行构造请求参数；约 1822 行发起真实流式 API 请求。

## 5. 四层消息不能混称

| 层次 | 典型变量 | 所有者 | 可否直接等同下一层 |
| --- | --- | --- | --- |
| REPL 会话/UI 历史 | `messages`、`messagesRef.current` | REPL 本地状态 | 否 |
| Headless 会话历史 | `print.ts mutableMessages`、engine 内部数组 | print/QueryEngine | 否 |
| 当前 Query Loop 状态 | `state.messages`、`messagesForQuery` | `queryLoop()` 当前执行 | 否 |
| API 请求参数 | `messagesForAPI`、`params.messages` | `queryModel()` 当前请求 | 已是派生请求视图 |

从会话历史到 API 参数之间会发生边界截取、预算替换、压缩投影、附件正规化、连续 user 合并、显示消息过滤、工具输入正规化和配对修复。M11 只建立“存在投影层”的准确心智模型，具体算法留给 M13。

## 6. Tool Loop 如何形成第二次请求

模型流中出现 assistant `tool_use` block 时：

1. `query.ts` 把 block 放入 `toolUseBlocks` 并设置 `needsFollowUp = true`（约 833 行）。
2. 开启 streaming executor 时可边流式接收边调度；否则在模型流结束后调用 `runTools()`。
3. `runTools()` 按工具的并发安全性把连续只读调用分组，并把非并发安全工具串行执行；实际单工具入口是 `runToolUse()`。
4. 成功、拒绝、未知工具、取消或异常都会形成内部 user message，其中 content 包含与 `tool_use.id` 配对的 `tool_result`。
5. `query.ts` 将工具更新正规化后收集进 `toolResults`。
6. 下一轮 `State.messages` 被替换为 `messagesForQuery + assistantMessages + toolResults`，while 循环继续，因而第二次 `deps.callModel()` 收到配对后的工具结果。

决定性位置：`src/query.ts` 约 1380、1396、1715 行；`src/services/tools/toolOrchestration.ts` 的 `runTools()` 约 19 行；`src/services/tools/toolExecution.ts` 的 `runToolUse()` 约 337 行及多条 `tool_result` 构造分支。

## 7. 取消与代表性失败

- 同一个 `AbortSignal` 从入口创建的 controller 传入 `query()`，再传给 `deps.callModel()` 和工具上下文。
- 流式模型阶段被取消时，Query Loop 先补齐或消费剩余工具结果，避免留下孤立 `tool_use`，然后返回 `aborted_streaming`。
- 工具阶段被取消时，执行路径生成取消结果并在收敛后返回 `aborted_tools`；若是“新提交打断旧轮次”，可省略额外中断提示，由队列中的新用户消息提供上下文。
- 普通模型运行异常会生成 API 错误消息；若已经输出 `tool_use`，路径会补合成 `tool_result`，避免后续历史违反配对约束。

本单元不穷举 retry、compact、hook 和 permission 的所有分支，只验证一个取消场景和一个工具错误消息场景。

## 8. 实验假设与反证条件

实验使用 clean-room fake model/tool，不调用真实 Claude/DeepSeek，也不运行泄露快照。

假设 A：入口状态在调用 Query Loop 前形成快照。反证：模型 adapter 能观察到入口在提交后对原数组做的、未通过循环追加的突变。

假设 B：第一次 assistant 返回 `tool_use` 时不会结束；工具结果以 user/tool_result 消息加入下一轮请求。反证：只有一次模型调用，或第二次请求缺少匹配 ID 的 `tool_result`。

假设 C：无 `tool_use` 的 assistant 结束循环。反证：模型被无条件重复调用。

假设 D：取消信号能阻止继续调用工具或下一轮模型。反证：取消后仍出现新的 model request 或 tool success。

实验观察点：`input.accepted`、`request.projected`、`model.request`、`assistant.received`、`tool.started`、`tool.finished`、`tool_result.appended`、`loop.completed`/`loop.cancelled`，以及每次模型请求的消息副本。

## 9. Harness 候选契约

候选模块：

- `SessionStore`：唯一拥有可变会话消息；只通过 append 修改。
- `InputAdapter`：把 REPL/Headless 原始输入转为领域 `UserMessage`。
- `RequestProjector`：从只读快照派生模型请求，不反向修改会话。
- `ModelAdapter`：接收请求和取消信号，返回 assistant 消息。
- `ToolRegistry`：按 name 查找工具并返回结构化结果。
- `AgentLoop`：拥有本次运行的循环状态与终止判定。
- `TraceSink`：记录实验可观察事件，不拥有业务状态。

初步决定：`merge` 到 M11 的独立 H2 纵切实现；它是 H2 主循环首版，不冒充尚未生成的 H0/H1 完整实现。后续 M01-M10 发布时再补齐课程顺序上的前置模块，并保持当前行为测试兼容。

## 10. 当前证据边界

- 源码目录来自发布包 source map 的静态分析快照，根目录只有 `README.md` 和 `src/`，缺少 `package.json`、完整类型源文件和原仓库测试，因此不能声称“原项目测试通过”。
- 本单元的调用与状态结论属于 `快照事实`；clean-room 实验结果属于 `运行验证`；企业 Harness 设计属于 `设计迁移`。
- Graphify 输出没有进入任何事实表述。

## 11. 用户标杆批准与后续校准

2026-07-28，用户正式批准 M11 作为全课程质量标杆，并要求把两项改进推广到后续单元：

1. 章首总图之后，正文每遇到状态所有权、请求投影、循环反馈、模型边界、取消收敛等重要认知转折，应在就近位置增加能独立用于复习的局部运行图；图量由理解负荷决定，不设配额。
2. 面试训练由资深互联网大厂 Agent 开发面试官视角选题。核心题给出面试现场能组织出来的、结论先行的口语化约两分钟回答，并根据问题自然连接 Claude Code 设计、失败边界、工程权衡和企业迁移。

本轮把正文 Mermaid 图从 2 张扩展为 9 张，把原单题表达扩展为 7 道机制驱动的面试题。所有 9 张图均经 Mermaid CLI `11.16.0` 实际渲染通过；TypeScript 与 Python 契约测试仍为 4/4 通过，两个 demo 的两轮 Tool Loop 事件序列不变。

这两项校准已经写入 `2.md`、`3.md`、`AGENTS.md`、课程设计包和 `curriculum/design/benchmark-rules.md`。它们约束后续质量，不要求其他单元复制 M11 的标题或图数。
