# H2 行为契约（进行中）

版本：`H2-in-progress`

当前来源单元：M10、M11、M12、M13、M14，以及用户批准的 S0/S1 核心纵切升级。S2 尚未完成；本文件冻结已经验证并合入累计 Harness 的消息所有权、请求投影、Provider 边界、单 Agent Tool Loop、运行通道分层和有界单消费者流契约。Provider-specific SSE 组装、Runtime 消费、完整 Context Pipeline 与并发 Tool 调度仍由后续单元演进。

## M10 消息与会话不变量

43. `ConversationStore` 是 durable conversation membership 的唯一 owner；调用者只能通过 `append`、`replace` 和 `snapshot` 进入其状态边界，不能依赖共享数组别名写回。
44. 每次成功 publication 产生单调递增 revision。writer 必须提交读取时的 expected revision；stale writer 显式失败，不得静默覆盖另一 writer 的更新。
45. snapshot 固定创建时的 revision 与消息成员集合。后续 append 不改变旧 snapshot；publication 会复制并深冻结嵌套 payload，调用者后续修改输入对象不能回写已发布消息。
46. `EnvelopeId`、`ResponseId` 与 `ToolUseId` 是不同概念。envelope ID 在 store 内唯一；多个 assistant envelope 可以共享一个 response ID，但不能因此互相覆盖。
47. human input 与 tool result 是不同领域类别，即使 provider 协议可能把二者都编码为 user role。领域判断必须使用显式 kind，不能把 role 当作完整分类器。
48. tool result 只能解析一个已登记且仍 pending 的 tool use。孤儿 result、重复 result 和重复 tool-use ID 在 publication 前 fail closed。
49. provider request 边界额外要求 tool results 紧邻产生它们的 assistant turn；并行 tool uses 可以按任意结果顺序各解析一次，但缺失或被其他消息隔开的结果不能进入请求。
50. progress 是 ephemeral event：它有独立 sequence 和 trace，但不进入 durable message membership，也不推进 conversation revision；只有 pending tool use 可以产生 progress。
51. parent ID 必须指向 publication 顺序中已经存在的 envelope。`replace` 先完整校验新序列，失败时保留原状态与 revision。
52. `ConversationTrace` 记录 operation、status、revision、message IDs 和 rejection reason，不记录 prompt 或 tool payload；它用于观察所有权与冲突，不充当 Transcript 持久化。

## M11 与 S0/S1 核心纵切不变量

53. 集成路径只使用 `ConversationStore` 作为 durable message owner；M11 教学实验中的第二套 `SessionStore` 不进入累计 Harness。每次 append 经过 revision 和 tool-use pairing 校验。
54. 一个 `ConversationStore` 只绑定一个 `AgentRuntime` owner；第二个 Runtime 必须在装配时显式失败。同一 owner 内只允许一个 active run；运行期间所有 durable publication 必须持有 Store 发出的 run lease，外部 writer 直接拒绝。模型响应按发请求时的 expected revision 提交，不能把针对旧快照的 assistant 接到后来消息之后。
55. 每次模型迭代创建新的 `RequestContext`、`CapabilitySnapshot` 和 `ModelRequest`。后续 session/capability publication 不修改已经送往 Provider 的请求视图。
56. `ModelAdapter` 只负责 Provider 协议投影、传输和响应运行时校验；它不拥有会话、不执行工具，也不决定是否进入下一轮。
57. 工具 dispatch 同时要求当前 capability snapshot 可见、PermissionGate 允许、本地 handler 存在。三者任一失败都不得执行工具。
58. 未知工具、输入错误、Permission 拒绝、工具异常和不可序列化的工具输出都形成与原 tool-use ID 一一配对的 error result；随后由模型决定是否修复或结束，运行时不伪造成功，也不能留下阻断下一次请求的悬空 tool use。
59. 取消到达模型、Permission 或工具边界后，不再发起新的模型请求；ModelAdapter resolve 后、Permission allow 与工具执行之间、工具 resolve 后都必须再次检查取消，迟到响应不能提交为成功，权限刚通过也不能越过已发生的取消产生工具副作用。若 assistant 已发布多个 tool use，当前和未启动调用都必须补齐 cancelled error result，使会话仍能通过请求配对检查。
60. `maxTurns` 是 Agent Loop 的显式终止边界；达到上限返回 `max-turns`，不递归或无限继续。
61. 组合 Trace 使用 run/request/tool identity、revision、计数、阶段和状态；不记录 prompt、tool input/output、HTTP body、认证头或凭据。用户可见 assistant text 使用独立事件通道；事件 sink 失败只能形成诊断，不能中断 Tool Loop 或留下未配对消息。
62. 内置文件工具先做 lexical 与 realpath workspace 检查并限制读取/输出，`read_file` 拒绝 `.env`/`.env.*` credential 文件并只允许空模板 `.env.example`；搜索固定 workspace 外解析出的可信 `rg` 绝对路径，所有子进程使用不含 Provider credential 的脱敏环境。命令工具使用 `shell:false`、bare executable、显式 grant、超时和输出上限。
63. executable grant 授予该程序任意 argv，是高风险 Permission 边界，不是“安全命令”或 Sandbox。直接子进程被终止也不证明所有后代已经退出；累计 Harness 不声称已实现 argv profile、进程树、文件系统、系统调用或容器隔离。
64. Provider credential 只从进程环境边界解析；credential resolver 与 Provider 路径不得把它自动注入 `ConfigurationSnapshot.effective`、Runtime/RequestContext、ConversationStore、Trace、命令子进程环境或错误文本。用户主动输入凭据，或显式 executable grant 允许的任意 argv，不属于这项保证。
65. Interactive 与 Headless 共享同一个 `AgentRuntime` 语义；输出格式只影响用户事件和最终 summary 投影，不改变会话、模型或工具决策。
66. LifecycleCoordinator 负责共享 shutdown report 与有预算的 trace flush；CLI signal 接线和最终 `process.exitCode` 仍由外层 Surface 持有。
67. OpenAI-compatible Provider 必须验证 assistant role、function call 类型和 `finish_reason`；`length`、`content_filter` 等非成功终止不能带着部分文本伪装成 completed。

## M12 Query 控制与运行通道不变量

68. Durable state、observer event 与 terminal summary 是三个不同协议：`ConversationStore` 拥有跨迭代消息事实，`AgentEventSink` 只观察用户可见过程，`AgentRunSummary` 是 `submit()` 的唯一显式终值。三者不能共享一个可变数组，也不能用 event sink 是否成功决定 Tool Loop 的下一状态。
69. `AgentRuntime` 拥有当前 active run 与模型迭代状态；下一轮请求由已提交的 assistant/tool result 和新的 request/capability snapshot 构造，不依赖 UI/CLI observer 把事件回传。Observer 可以因为被 await 而影响运行速度，但它的异常只能降级为诊断，不能接管业务完成、取消或消息配对。
70. `completed`、`cancelled`、`failed` 与 `max-turns` 是业务 summary；外部调用方放弃等待、CLI 输出失败或未来 stream consumer close 不能自动伪装成其中任一状态。当前 Promise API 没有 consumer-close 通道，调用方取消必须显式触发 `AbortSignal`。
71. M14 已加入独立 `BoundedAgentRunStream`：固定容量、单消费者、consumer close 到 owner abort/cleanup、terminal metadata；它暂不替代稳定的 `Promise<AgentRunSummary> + AgentEventSink`，也未接入完整 Runtime Tool Loop。
72. 禁止用无界 async queue 简单包装 callback sink；没有 buffer owner、关闭协议和资源收敛的流外观不属于 H2 能力。M14 的 bounded stream 只接受单消费者，multi-observer fan-out 继续 defer。

## M13 请求投影不变量

73. Durable conversation、projected request 与 Provider payload 是不同对象。`ConversationStore` 保存完整事实；`RequestProjector` 只能从 immutable snapshot 派生新的 request，不得因 history start、context 注入或 tool preview 修改 Store membership 或嵌套 payload。
74. `RequestProjectionPolicy` 显式拥有 history start、request-only user context 和有限 tool-result preview 参数。Policy 不是 Provider adapter 的隐式行为；非法 history index 或 preview limit 必须在模型调用前失败。
75. History start 只选择当前 request 的可见起点。全量 Store 合法不意味着任意切片合法；投影后必须再次 strict 校验 tool call/result，一旦切到 orphan、missing 或 duplicate 边界就 fail closed。
76. Request-only context 只进入本轮 `ModelRequest`，不追加到 durable history。当前 Harness 在 leading system messages 之后、首个非 system message 之前插入 context，以保持现有 OpenAI-compatible message 形状；这属于 clean-room 映射，不声称复制 Claude Code 的独立 system prompt 通道。
77. 当前 Harness 的 tool-result preview 是 deterministic per-result bound，不是 Claude Code 的 aggregate API-user-group budget。完整 output 留在 Store，ModelRequest 使用 preview；真实外置存储、跨轮 replacement state、resume record 和 Prompt Cache edit 延后到 H3。
78. `RequestProjectionReport` 只记录 source/selected/projected count、history omission、replacement count、context-injected boolean 与 strict status。Trace 不记录 policy context、prompt、完整 output 或 preview content。
79. `RequestProjector` 在 capability snapshot 之外仍拒绝未知 tool schema；message projection、capability projection 和 local handler/permission 是三个独立边界，不能因请求消息合法而跳过能力与执行校验。
80. TypeScript 与 Python 必须同时证明：Provider 看到 request-only context 和 bounded preview，Store 仍持有完整 output，Trace 不含两侧正文；任何一个边界失败都不能宣称 M13 合入完成。

H0 与 H1 的全部不变量继续有效，分别见 `h0-contract.md` 和 `h1-contract.md`。

## 当前明确不承诺

- 已包含非流式 OpenAI-compatible 真实模型请求和顺序 Tool Loop，但不包含 SSE 流式 assistant 聚合或并行工具调度；
- 不提供 pull-based `AgentRunStream`，也不声称 observer await 等同于网络端到端背压；
- 不实现 Claude Code 的非严格 tool pairing 修复；Harness 当前选择 fail closed；
- 不实现 aggregate API-user-group budget、跨轮 replacement state、外置 tool-result storage、resume replacement record 或 Prompt Cache edit；
- 不实现 Transcript DAG、fork、compact 或跨进程恢复；
- 不声称本 clean-room 消息联合等于快照中缺失的完整内部 `Message` 类型。
- 不实现 Hook、Skill、MCP、Plugin、Subagent、Agent Team、完整 Permission 控制面或 Sandbox；
- 不把 granted executable 描述为安全命令或隔离，也不把 metadata trace 描述为完整 OTel。

## 回归命令

```powershell
cd "D:\agent\Claude code最新\mini-agent-harness"
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-h2-regression.ps1

# 集成 Agent 纵切（包含 H2/H1/S0 回归）
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agent-regression.ps1
```
