# M22 远端能力怎样进入一次 Agent 运行：MCP 握手、能力快照与断线恢复

> 主体学习时间：约 4--7 小时。fake transport 实验、故障注入和生产 SDK adapter 挑战另计。

M21 解决的是扩展怎样从磁盘或 marketplace 进入本进程。现在把能力搬到另一个进程：它可能是本机 stdio child，也可能是远端 HTTP service。模型仍然要看见工具 schema，Permission 仍然要治理调用，tool result 仍然要与 tool use 配对；但中间多出 transport、JSON-RPC session、initialize、capability negotiation、远端执行和断线。

如果只把 MCP 理解成“统一调用外部工具的接口”，你会漏掉最危险的地方：连接已经成功，`tools/list` 却可能失败；模型拿到的 JSON Schema 不一定在本地执行层再次完整验证；ESC 能让本地 Promise 结束，却不能证明远端数据库写入回滚；session 过期后重试一次，也可能把一个非幂等副作用执行两遍。

本章追踪一个名为 `demo server` 的 MCP server。它暴露 `read` tool，随后通知工具列表变化，运行中又发生 session expiry：

~~~mermaid
flowchart LR
  CFG["MCP config"] --> TRANSPORT["stdio / HTTP / SSE / WS / SDK transport"]
  TRANSPORT --> INIT["Client.connect / initialize"]
  INIT --> CAPS["server capabilities"]
  CAPS --> LIST["tools/resources/prompts list"]
  LIST --> ADAPT["Claude Code Tool / Command / Resource"]
  ADAPT --> SNAP["当前模型请求能力快照"]
  SNAP --> CALL["Permission -> tools/call"]
  CALL --> RESULT["remote result -> paired tool_result"]
  CAPS --> NOTIFY["list_changed"]
  NOTIFY --> LIST
  CALL --> DROP["abort / timeout / disconnect / session expiry"]
  DROP --> TRANSPORT
~~~

贯穿全章的结论是：

> MCP 把能力描述和执行搬过协议边界，却没有消除本地治理责任；transport 只负责消息能否往返，session 负责双方当前共同理解，request snapshot 负责本轮稳定可见，Permission 和幂等设计才负责副作用边界。

## 先分清四层，否则所有“连接”都会混成一个布尔值

一次 MCP 能力进入 Agent，至少有四层状态：

1. transport：进程管道或网络通道是否建立；
2. protocol session：initialize 是否完成，双方版本与 capabilities 是否协商；
3. capability catalog：tools/resources/prompts 是否成功 list 并被适配；
4. request snapshot：本次模型请求究竟投影了哪些 schema。

`transport open` 不能推出 initialize 完成；`connected` 不能推出三类 list 都成功；AppState 工具列表更新也不能改变已经发给模型的请求。

~~~mermaid
flowchart TD
  T{"transport open?"} -->|"no"| FAILED["failed / pending / needs-auth"]
  T -->|"yes"| I{"initialize complete?"}
  I -->|"no"| HALF["half-initialized：关闭并失败"]
  I -->|"yes"| C["connected + negotiated capabilities"]
  C --> L{"list succeeded?"}
  L -->|"部分失败"| EMPTY["该类能力为空，connection 仍可 connected"]
  L -->|"成功"| CAT["active capability catalog"]
  CAT --> REQ["下一次 request snapshot"]
~~~

当前 `src/services/mcp/types.ts` 没有用一个 `connected: boolean`，而是定义 `connected | failed | needs-auth | pending | disabled` discriminated union。只有 connected 分支携带 SDK Client、server capabilities/info/instructions 和 cleanup。TypeScript 在检查 `client.type === 'connected'` 后，才允许访问 `client.client`；这让非法状态更难表示。

Java 可以用 sealed interface 为五个状态建模，Python 用 tagged dataclass 或 Literal。不要让 failed object 也带一个可能为 null 的 client；那会把每个调用点都变成隐式状态机。

## transport 不是协议本身

Claude Code 快照支持多种 transport 适配：stdio、SSE、Streamable HTTP、WebSocket、SDK/in-process 等。它们解决字节或消息怎样跨边界，不定义 Tool 的业务语义。

- stdio 通常由 client 启动 child process，stdout 传协议，stderr 用于诊断；
- Streamable HTTP 需要 session 与请求/响应，长连接 GET/SSE 和普通 POST 有不同超时语义；
- SDK/in-process 避免真正网络，但仍通过协议 client/server abstraction 交互；
- transport close 要释放 socket、stream 或 child process，不能只把本地状态改成 disconnected。

`client.ts` 的 HTTP wrapper 很值得学习。它为每个非 GET 请求创建新 AbortController 和 timer，而不是在连接时创建一个 60 秒 signal 反复复用。一个已经超时的 AbortSignal 永远保持 aborted，复用会让后续请求立即失败。长生命周期 SSE GET 又不能套普通 60 秒请求 timeout，否则健康连接会被定时杀死。

~~~mermaid
flowchart TD
  REQ["transport request"] --> METHOD{"GET long-lived SSE?"}
  METHOD -->|"yes"| STREAM["不套普通 request timeout"]
  METHOD -->|"no"| CTRL["每次创建 AbortController + timer"]
  CTRL --> LINK["桥接 parent signal"]
  LINK --> FETCH["fetch with fresh signal"]
  FETCH --> CLEAN["clear timer + remove listener"]
~~~

这段设计能迁移到任何长连接 Agent gateway：connection lifetime、individual request deadline 和 user cancellation 是三个时钟，不应共享一个永远增长的 signal。

## initialize 真正建立的是双方共同能力边界

`connectToServer()` 创建 SDK `Client` 后调用 `client.connect(transport)`。initialize 的协议细节由官方 MCP SDK负责；成功后，Claude Code 才调用 `getServerCapabilities()`、`getServerVersion()`、`getInstructions()`。这就是为什么 Harness 不应该自行解析 JSON-RPC：版本协商、request ID、notification 和 cancellation 都应交给成熟 SDK adapter。

当前 client 向 server 声明 `roots` 与 `elicitation`。它注册 `ListRoots` handler，返回原始工作目录的 file URI。连接初始化窗口还先注册一个默认 elicitation handler，任何交互请求都返回 cancel；等 REPL/SDK 有真正 owner 后再覆盖。

~~~mermaid
sequenceDiagram
  participant CC as Claude Code client
  participant SDK as MCP SDK
  participant S as MCP server
  CC->>SDK: new Client(capabilities: roots, elicitation)
  CC->>SDK: set ListRoots handler
  CC->>SDK: set default elicitation=cancel
  CC->>SDK: connect(transport)
  SDK->>S: initialize(client info/capabilities)
  S-->>SDK: server info/capabilities/instructions
  SDK-->>CC: connect resolved
  CC->>SDK: getServerCapabilities/version/instructions
~~~

这里有两个安全点。

第一，roots 不是无害元数据。server 主动请求 roots 时会知道当前 cwd 的 file URI，这是一次显式数据披露。它不等于 server 自动获得该目录文件内容，但会暴露路径和工作区边界，后续 resource/tool 又可能使用它。

第二，当前快照没有声明 sampling，也没有为 `sampling/createMessage` 注册 handler。MCP 规范允许某些 client 提供 sampling，但不能因为协议“支持 sampling”就写成 Claude Code 当前 client 已支持。协议能力与产品实现必须分开。

## connected 之后，目录发现仍可能分别失败

server capabilities 说明“支持 tools/resources/prompts”，真正的目录内容还需要 `tools/list`、`resources/list`、`prompts/list`。Claude Code 的三类 fetcher先检查 capability，再发 request；各自 catch error 并返回空数组。

~~~mermaid
sequenceDiagram
  participant C as connected client
  participant T as tools fetcher
  participant R as resources fetcher
  participant P as prompts fetcher
  participant S as server
  par capability-specific list
    T->>S: tools/list
    R->>S: resources/list
    P->>S: prompts/list
  end
  S--xT: error
  S-->>R: resources
  S-->>P: prompts
  T-->>C: []
  R-->>C: resource adapters
  P-->>C: command adapters
~~~

因此 `client.type === 'connected'` 只证明 protocol session 建立，不证明某类能力可用。这样降级有可用性收益：一个坏掉的 prompts endpoint 不必让 tools 全部消失。但它也让观察变难：空数组可能表示服务器真的没有工具，也可能表示 list 失败。企业实现应把 `supported / loaded / failed / revision` 分开记录，而不是只看 count=0。

H4-3 选择更严格的教学契约：如果 server 宣告 tools 能力但首次 list 失败，candidate session 进入 degraded，不发布半套 tool snapshot。这个选择便于简历项目展示清晰的一致性保证；它比 Claude Code 的局部降级更强，属于 clean-room 迁移。

## 远端 Tool 怎样变成本地 Tool

`fetchToolsForClient()` 收到 `tools/list` 后先递归清理 Unicode，再把每个远端 tool 适配成 Claude Code `Tool`。通常名称由 `buildMcpToolName()` 生成：

```text
mcp__<normalized server>__<normalized tool>
```

例如 `demo server/read` 变成 `mcp__demo_server__read`。这减少与内置 Tool 冲突，也让 Permission rule 能按 server/tool 匹配。SDK no-prefix 模式可以把模型名保留为原名，但 `mcpInfo` 仍保存 serverName/toolName，权限检查使用 fully qualified name，避免一个远端 `Write` 冒充内置 `Write` 的规则身份。

~~~mermaid
flowchart LR
  REMOTE["server=demo server / tool=read"] --> NORM["normalize names"]
  NORM --> MODEL["model name: mcp__demo_server__read"]
  REMOTE --> INFO["mcpInfo: original server/tool"]
  MODEL --> CATALOG["request tool schema"]
  INFO --> PERM["fully-qualified Permission identity"]
  CATALOG --> CALL["remote tools/call name=read"]
~~~

模型身份、权限身份与远端协议名是三个视图。都压进一个 string 后，normalize collision、no-prefix 和审计会变得含糊。M21 的 source identity/model alias 分离在跨进程场景继续成立。

## 最反直觉的边界：模型 JSON Schema 不等于本地完整验证

远端 tool 的 `inputSchema` 被赋给适配后 Tool 的 `inputJSONSchema`，供模型 API 看见。但是共享 `MCPTool` 的本地 Zod `inputSchema` 是 `z.object({}).passthrough()`。M20 的通用执行器调用 `tool.inputSchema.safeParse(input)` 时，只能确认输入是一个 object，并允许任意字段；它没有把任意 JSON Schema 动态编译成同等 Zod validator。

~~~mermaid
flowchart TD
  RS["remote JSON Schema"] --> MODEL["inputJSONSchema -> model request"]
  OUT["model tool input"] --> LOCAL["MCPTool Zod passthrough object"]
  LOCAL --> PERM["Hook + Permission"]
  PERM --> RPC["tools/call(arguments)"]
  RPC --> SERVER["server authoritative validation"]
  MODEL -. "提示模型形状，不等于" .-> LOCAL
~~~

这不是说完全没有验证：MCP SDK 会验证协议 envelope 和 `CallToolResult`，远端 server 应按自己的 tool schema 验证 arguments。但本地不能声称已经完整拦住 required、enum、nested type 和 additionalProperties 错误。

企业 Harness 有三个选择：

1. 保持 passthrough，把远端 server 作为唯一 authoritative validator；
2. 用成熟 JSON Schema validator 做本地 defense-in-depth，再接受版本/方言兼容成本；
3. 在可信 adapter 安装时编译 schema，并把编译失败作为能力加载失败。

不要手写一个只支持 `type` 和 `required` 的半套 validator，然后对外宣称“支持 JSON Schema”。

## annotations 是 hint，不是证明

MCP tool annotations 可以给出 `readOnlyHint`、`destructiveHint`、`openWorldHint`。当前适配直接让它们影响 `isConcurrencySafe`、`isReadOnly`、`isDestructive`、`isOpenWorld`。这对良性 server 很有用：调度器可以并发安全读取，Permission 可以获得风险线索。

但 annotations 来自远端。一个 buggy 或恶意 server 可以错误声明 read-only。正确表述是“远端 hint 参与本地分类”，不能表述成“readOnlyHint 证明不会写”。MCP Tool 的 `checkPermissions()` 仍返回 passthrough，进入 M20 的 Permission chain；组织 deny、用户决策和其他 safety check 不能被 annotation 替代。

~~~mermaid
flowchart TD
  ANN["remote annotations"] --> CLASS["read-only / destructive / open-world classification"]
  CLASS --> SCHED["scheduler hint"]
  CLASS --> PERM["Permission context"]
  POLICY["local policy / user approval"] --> PERM
  PERM --> EXEC{"allowed?"}
  ANN -. "不是真实性证明" .-> POLICY
~~~

生产系统可为受信 registry 中的 server 配置本地 override：`effectiveRisk = max(remoteHint, localPolicy, observedBehavior)`。对未知远端，默认不要因 `readOnlyHint=true` 自动降低关键权限。

## Tool、Resource、Prompt 是三种不同能力

Tool 是模型可发起的远端动作；Resource 是可列举/读取的内容；Prompt 被适配成动态 Command，调用时再执行 `prompts/get`。它们共享连接和能力协商，却不应混成“都是工具”。

Resource 读取前会检查 connection 和 server resources capability，再用 `ensureConnectedClient()` 获取有效连接。Prompt 调用也会 ensure connected，然后把返回消息内容转换为 Claude 可消费形式。远端内容仍是不可信输入，可能包含 prompt injection；“来自 MCP”不是 system instruction 权限。

~~~mermaid
flowchart LR
  MCP["connected MCP server"] --> TOOL["Tool: model-visible executable"]
  MCP --> RES["Resource: list/read content"]
  MCP --> PROMPT["Prompt: dynamic Command"]
  TOOL --> PERM["Tool Permission"]
  RES --> CONTENT["untrusted content boundary"]
  PROMPT --> CONTENT
  CONTENT --> PROJECT["message/request projection"]
~~~

这也是为什么 M21 的 remote MCP Skill 禁止 inline shell：远端提供的 Markdown/Prompt/Resource 内容可以影响模型，但不应自动升级成本地命令执行权。

## `list_changed`：通知不是直接修改正在运行的模型

若 server 在 capabilities 中声明 listChanged，连接管理器注册 tools/prompts/resources notification handlers。收到 `tools/list_changed` 后，它先删除 tools fetch cache，再重新 list，最后 `updateServer({...client, tools:newTools})`。其他两类有各自 cache，resources 变化还可能联动 MCP Skill cache。

~~~mermaid
sequenceDiagram
  participant S as MCP server
  participant H as notification handler
  participant C as list cache
  participant A as AppState/server registry
  participant R1 as 已构造 request R1
  participant R2 as 下一 request R2
  S-->>H: tools/list_changed
  H->>C: delete(serverName)
  H->>S: tools/list
  S-->>H: new tool list
  H->>A: updateServer(new tools)
  R1-->>R1: 旧 schema 不被原地改写
  A-->>R2: 新能力装配
~~~

通知可能与请求并发。已经构造并送出的 model request 是一次值快照，不会因为 AppState 更新而改变。下一轮是否看到新工具，还取决于能力投影何时重新构造。

H4-3 把这个边界做成显式 revision：notification refresh 成功后 revision+1，旧 snapshot 仍可阅读，但不允许它再发起新 call；若 refresh 失败，session 进入 degraded，防止新工作继续使用可能已过期的工具集合。

## 断线时真正要结束的是 pending request

网络 transport 有一个常见坑：SDK 可能连续触发 `onerror`，却不触发 `onclose`。若应用只在自己的 onclose callback 中清 cache，pending `callTool()` Promise 可能永远悬挂。

当前 `client.ts` 的 `closeTransportAndRejectPending()` 调用 `client.close()`。完整链是：client close -> transport close -> SDK internal onclose -> reject pending request handlers -> 应用 onclose 清 connection/list caches。直接调用应用 `onclose?.()` 只会清 cache，不会触发 SDK pending rejection。

~~~mermaid
flowchart TD
  ERR["terminal transport errors / session expired"] --> CLOSE["client.close()"]
  CLOSE --> TC["transport.close()"]
  TC --> SDK["SDK internal _onclose"]
  SDK --> PENDING["reject pending callTool requests"]
  SDK --> APP["application onclose"]
  APP --> CACHE["clear connection + tools/resources/prompts cache"]
  CACHE --> NEXT["next ensureConnected may reconnect"]
~~~

这是一条所有权链：SDK 拥有 request ID 和 pending resolver，只有让 SDK 知道连接关闭，它才能完整拒绝等待者。外层删除一个 Map entry 不是取消协议请求。

## session expiry 为什么会带来重复副作用

HTTP server 可能用 404 + 特定 JSON-RPC error 表示 session 不存在。Claude Code 检测后关闭/清 cache，`ensureConnectedClient()` 创建新 session，MCP tool wrapper 最多重试一次。

这提高了自恢复能力，却不能提供 exactly-once。考虑时间线：

~~~mermaid
sequenceDiagram
  participant C as client
  participant S as server
  C->>S: tools/call create_ticket
  S->>S: 已创建 ticket #42
  S--xC: response 丢失 / session expired
  C->>C: clear cache + reconnect
  C->>S: retry tools/call create_ticket
  S->>S: 又创建 ticket #43
  S-->>C: success
~~~

客户端看到一次 success，业务发生两次。`_meta` 中传递的 `claudecode/toolUseId` 给 server 提供了可用于关联的身份，但当前 client 不强制 server 建去重表。

企业 adapter 应要求 destructive command 接受 idempotency key，server 以 `(tenant, tool, key)` 建 durable dedupe record，保存最终 outcome；若 server 不支持，session expiry 后应返回 `indeterminate`，要求查询状态或人工处理，而不是盲重试。

H4-3 的默认策略正是“不重试”。只有本地 `McpRetryPolicy` 明确批准，才重连一次；重试复用同一个 idempotency key，并检查新 generation 中同名 tool schema 没变。

## AbortSignal 和 timeout 只证明本地控制流

调用远端 Tool 时，源码把 `AbortSignal` 和 timeout 传给 MCP SDK，同时用额外 `Promise.race` 防 SDK 内部 timeout 在断流时失效。它们能结束本地等待、释放资源、让外层生成取消/失败 result。

它们不能证明远端 handler 停止。cancel notification 是合作式信号；网络断开时 server 甚至可能已经收完请求。Promise.race 更只是选择哪个 Promise 的 outcome 先被观察，不会自动撤销输掉的异步工作。

~~~mermaid
flowchart LR
  USER["ESC / parent abort"] --> SIGNAL["AbortSignal"]
  DEADLINE["request/tool timeout"] --> RACE["local Promise rejection"]
  SIGNAL --> SDK["SDK/transport cancellation attempt"]
  RACE --> LOCAL["local stop waiting"]
  SDK --> LOCAL
  REMOTE["remote handler"] -. "可能已发生副作用" .-> LOCAL
  LOCAL --> PAIR["outer Tool loop pairs cancelled/error result"]
~~~

当前低层 `callMCPTool()` 对 AbortError 返回 undefined content，避免 ESC 日志噪声；真正的运行取消和 paired result 仍要看外层 Tool 编排。不要把一个底层 catch 的返回值写成整个 Agent 的取消保证。

## Elicitation 与 roots：server 也会向 client 发请求

MCP 不是单向“client 调 server”。server 可以请求 roots，也可以 elicitation 要求用户输入或打开 URL。于是 client 也需要 request handler、UI/SDK owner、取消和 Hook 治理。

初始化阶段 default elicitation=cancel 是 fail-closed：在真正 UI handler 注册前，server 请求不会永远等待，也不会自动接受。正式 handler 还会先给 Hook 机会，再进入 AppState queue/SDK consumer，等待用户响应。URL elicitation完成后可能 retry tool call，同样需要限制次数和幂等思考。

~~~mermaid
flowchart TD
  SERVER["server elicitation request"] --> READY{"real handler ready?"}
  READY -->|"no / initialization window"| CANCEL["action=cancel"]
  READY -->|"yes"| HOOK["Elicitation Hook"]
  HOOK -->|"resolved"| RESP["accept / decline / cancel"]
  HOOK -->|"unresolved"| OWNER["REPL queue / SDK consumer"]
  OWNER --> RESP
  RESP --> SERVER
~~~

采集用户输入的 schema、敏感字段、URL 域名与 Hook output 都要当外部信任边界。MCP server 有能力请求交互，不等于它有权让用户提交任何 secret。

## H4-3：实现 session，不重造 wire protocol

Mini Agent Harness 新增 `typescript/agent/mcpSession.ts` 与 Python mirror。核心入口是 `McpTransport`：

```ts
interface McpTransport {
  connect(signal: AbortSignal): Promise<McpHandshake>
  listTools(signal: AbortSignal): Promise<readonly McpRemoteTool[]>
  callTool(name, args, options): Promise<McpCallResult>
  close(reason: string): Promise<void>
}
```

这不是自定义 MCP 协议。它是 anti-corruption port：生产 adapter 必须用官方 MCP SDK完成 initialize、JSON-RPC、transport 和 protocol validation，再翻译成 Harness 的 domain objects。课程 fake transport 只模拟 port outcome，用来验证 session owner 的状态、revision、重试和 trace。

~~~mermaid
flowchart LR
  OFFICIAL["official MCP SDK adapter"] --> PORT["McpTransport port"]
  FAKE["deterministic fake transport"] --> PORT
  PORT --> SESSION["McpSession generation + revision"]
  SESSION --> SNAP["immutable capability snapshot"]
  SNAP --> RUNTIME["Agent Runtime / Permission"]
  SESSION --> TRACE["metadata-only trace"]
~~~

`McpSession.connect()` 在 candidate transport 上先 handshake，再按 negotiated tools capability list。全部成功才交换当前 transport、generation 和 revision；失败关闭 candidate，进入 degraded，不发布 snapshot。

`handleNotification('tools/list_changed')` 成功后 revision+1；失败进入 degraded。`call()` 要求 snapshot generation/revision 与 ready session 一致。这个限制比“旧 request 内已经发出的 tool use 如何完成”更严格：当前 Harness 把 call acquire 放在执行前，新通知后旧 snapshot 不再允许新调用；已经进入 transport 的 call 由其 signal/结果路径收敛。

### 为什么 generation 和 revision 都要有

generation 标识连接/session 世代：断线重连会换 transport，即使工具列表一样也是新 generation。revision 标识同一 generation 内目录变化：`list_changed` 可以只改 tool catalog。二者分开后，排障能回答“schema 是通知更新的，还是连接重建的”。

### 为什么 annotations 没进入有效策略

H4-3 snapshot 保留 name、description、schema，但不把 remote annotations 自动转成本地安全决策。生产 adapter 可以记录它们，随后由 trust-aware policy 做 effective classification。课程选择故意保守，避免简历项目把未验证 hint 当安全事实。

## 用九个测试观察真实契约

运行：

```powershell
cd mini-agent-harness
node typescript/agent/mcpSession.test.ts
cd python
python -m unittest -v test_mcp_session.py
```

TypeScript/Python 各九个测试验证同一行为契约：

- connect 成功才发布 qualified immutable snapshot；
- 初始 list 失败不发布半套能力；
- list_changed 发布新 revision，旧 snapshot fail closed；
- refresh 失败进入 degraded；
- disconnect 后旧 generation 不能调用；
- session expiry 默认返回 indeterminate，不盲重试；
-批准 retry 时复用同一 idempotency key；
- abort 传给 adapter，但测试不声称远端回滚；
- trace 不含 arguments、description 或 remote content。

### 破坏实验一：connected 后忽略 list failure

把 connect 中的 list error catch 成空数组并仍发布 ready。观察 session 显示健康、toolCount=0，却无法区分 server 没有工具还是 list 失败。修复可以选择 Claude Code 式局部降级，但必须增加 per-capability load status；当前 H4-3 恢复 degraded。

### 破坏实验二：notification 原地修改旧数组

不要创建新 tuple/frozen array，直接 mutate old snapshot tools。旧 request 的可见能力会在运行中漂移，stale test 应失败。恢复 immutable snapshot 和 revision gate。

### 破坏实验三：所有 session expiry 都 continue

删除 retry policy 与 indeterminate outcome，让 fake 第一次抛 session expired、第二次成功。测试最终绿色，但检查 call count 是 2。给远端实现一个“创建订单”计数器，就会看到双写。恢复默认 no-retry，并只让有 durable idempotency 支持的 policy 批准 replay。

### 破坏实验四：认为 Promise race 会停止 fake handler

让 fake call 在收到 abort 后仍增加 `remoteSideEffects`，然后本地抛 AbortError。你会同时看到本地 cancelled 与远端计数+1。正确修复不是修改教材措辞，而是把 operation status query、compensation 或 server cooperative cancellation加入业务协议。

~~~mermaid
flowchart LR
  HYP["写下要验证的保证"] --> FAULT["list fail / notify race / expiry / abort"]
  FAULT --> OBS["观察 state + generation + revision + call count"]
  OBS --> BOUND["区分 local outcome 与 remote side effect"]
  BOUND --> REPAIR["恢复 fail-closed / idempotency / immutable snapshot"]
~~~

## 迁移到企业 Agent、Spring 与 RAG

生产架构可以分成三层。

连接层使用官方 MCP SDK adapter，管理 stdio child、HTTP/OAuth、deadline、close 与 protocol metrics。Session 层管理 server identity、generation、capability load status、notification、health 和 reconnect policy。Agent 层只消费经过 policy 的 immutable capability snapshot，并把 tool call 送入统一 Permission/trace/result pairing。

~~~mermaid
flowchart TD
  CFG["tenant MCP config"] --> SDK["official SDK transport adapter"]
  SDK --> SESS["Session Supervisor"]
  SESS --> CAT["revisioned capability catalog"]
  CAT --> POLICY["trust + permission + schema policy"]
  POLICY --> AGENT["Agent request snapshot"]
  AGENT --> EXEC["idempotent call envelope"]
  EXEC --> SDK
  SESS --> OBS["health / generation lag / reconnect / list errors"]
~~~

Spring 中，`McpTransportAdapter` 可以是 prototype/connection-scoped component，`McpSessionSupervisor` 是明确 owner，不要把 socket client 当无状态 singleton。多实例部署要用 server identity + config revision，实例独立建立连接并上报 generation；不要跨 JVM 共享一个不存在的“连接对象”。

RAG 场景里，MCP Resource 可能暴露文档，Tool 可能执行检索。仍要区分 content trust 与 execution permission：Resource 返回的文本可能 prompt injection，Retriever tool 的 readOnlyHint 也不证明不会记录查询或访问外网。数据分级、租户隔离和引用过滤应在本地 policy plane。

成本与 SLO 至少观测：initialize latency、list latency/error、ready/degraded server 数、capability revision churn、pending call、timeout/abort、indeterminate outcome、retry/dedupe hit、result size和 secret redaction failure。不要记录完整 headers、arguments 与 resource body到普通 telemetry。

## 资深面试官会怎样追问

### 1. MCP connection 成功后，为什么模型仍可能看不到工具？

先给结论：因为 transport/session 连接与 capability list 是两步。Claude Code 先 `client.connect(transport)` 完成 initialize，再按 server capabilities 调 `tools/list`、`resources/list`、`prompts/list`；这些 fetcher 各自 catch 失败并返回空数组，所以 connection 仍可能是 connected。排障时我会分别记录 handshake、capability advertised、list loaded 和 request projected 四个状态。自己的 Harness 会让首次 tools list 失败进入 degraded，或者至少提供 per-capability error，避免 `toolCount=0` 掩盖故障。

### 2. MCP tool 的 inputSchema 在哪里验证？

先给结论：模型看到远端 JSON Schema，不代表 Claude Code 本地 Zod 层完整执行了它。远端 schema 放在 `inputJSONSchema` 用于模型定义，而共享 MCPTool 的运行时 Zod 是 passthrough object；最终 authoritative validation 仍在 MCP server。生产方案可用成熟 JSON Schema validator做本地 defense-in-depth，但必须处理 schema dialect 和兼容性，不能手写半套后声称完整支持。Permission 也不能替代 schema validation，它回答的是是否授权，不是参数是否有效。

### 3. readOnlyHint 能不能用来自动并发和免确认？

先给结论：它只能是 hint，不能当证明。当前快照确实把远端 `readOnlyHint` 用于 `isConcurrencySafe/isReadOnly` 等分类，但 MCP server 是外部来源，可能错误或恶意声明。MCP Tool 仍走 Permission chain。企业方案会结合 server trust、local override 和历史行为计算 effective risk；未知 server 默认不因 hint 降低权限，尤其是写数据库、发消息和外网调用。

### 4. 为什么调用 `onclose` 不一定能让 pending request 结束？

先给结论：pending request resolver 属于 MCP SDK，应用回调只清自己的状态。Claude Code 在 terminal error 时调用 `client.close()`，让 transport close 进入 SDK internal onclose，SDK 才能 reject 所有 pending request，然后应用 onclose 清 connection/list cache。只直接执行应用 onclose callback，Map 可能干净了，但等待中的 `callTool()` 仍悬挂。这个规律适用于 WebSocket 和 RPC：要关闭 owner，不只是删引用。

### 5. session expiry 后自动重试有什么风险？

先给结论：响应丢失时客户端不知道副作用是否已经发生，重试可能双写。Claude Code 最多 retry 一次，并携带 toolUseId meta，但没有强制 server dedupe，所以不能叫 exactly-once。我的 Harness 默认返回 indeterminate；只有 local policy 确认 tool 支持幂等并有 durable key ledger 时才 replay，同一个 call 使用同一个 idempotency key。对支付、发信、建工单还要提供 status query 或 compensation。

### 6. 用户按 ESC 后，远端 Tool 一定停止吗？

先给结论：不一定。AbortSignal、SDK timeout 和本地 Promise.race 能结束本地等待并触发取消通知，但远端可能已收到请求或已经提交事务。Claude Code 外层仍要生成配对取消结果，避免 Tool Loop 卡死；业务上要把 outcome 标成 cancelled-local 或 indeterminate-remote。生产系统需要 server cooperative cancellation、operation ID/status query 和补偿，不能把 AbortError 当数据库回滚证明。

### 7. `list_changed` 到来时怎样保证正在运行的请求一致？

先给结论：不要原地修改已经构造的 request。Claude Code handler 清对应 cache、refetch并更新 AppState；已发送请求里的 schema 不会变化，后续装配看到新列表。自己的 Harness 会给 catalog revision，通知成功发布 revision+1；旧 snapshot 保持不可变但不允许新 acquire。多实例场景还要记录 server generation和实例 applied revision，接受短暂传播延迟而不是假装全局瞬时一致。

### 8. MCP 与普通 REST tool adapter 的核心区别是什么？

先给结论：MCP 不只是固定 endpoint 调用，它有 initialize/capability negotiation、动态 list、server notification、roots/elicitation 等双向请求和 session lifecycle。REST adapter 可以静态写 schema，而 MCP server 能在运行中改变工具目录，断线还涉及 pending JSON-RPC request和 session恢复。因此要有 Session Supervisor、revisioned catalog和 notification handling。不过 Permission、idempotency、redaction 与业务补偿并不会被 MCP 自动解决，仍属于 Harness。

### 9. 怎样设计一个生产级 MCP gateway？

先给结论：用官方 SDK 管 wire protocol，外层做多租户 session supervisor 和 policy plane。每个 server/config revision 有独立 generation，握手后加载并验证 capability，发布不可变 catalog；请求按租户拿 snapshot，调用携带 idempotency key、deadline和trace ID。gateway限制并发、result size、allowed roots、OAuth scope和egress，普通 telemetry只记 metadata。断线先结束 pending，非幂等 outcome标 indeterminate；list_changed做 revision更新。SLO看 ready率、list错误、generation lag、timeout和dedupe。

### 10. 为什么 client 没声明 sampling 是一个值得讲的事实？

先给结论：因为协议支持什么不等于产品启用了什么。当前 Client capabilities 只有 roots 和 elicitation，没有 sampling/createMessage handler，所以 server不能把 Claude Code 当采样服务使用。面试和设计文档必须区分 MCP spec、SDK能力和当前产品快照；否则会把攻击面、成本 owner 和递归 Agent 调用都描述错。若企业要开放 sampling，应单独设计模型选择、预算、Permission、递归深度和审计。

## 离开本章前的完整检查

不看正文，画出：transport -> initialize -> capabilities -> list -> adapter -> request snapshot -> Permission -> tools/call -> paired result。然后在图上标四个失败点：half initialization、list failure、notification race、session expiry after side effect。

你还应能用自己的话解释：

- connection state、catalog revision、request snapshot分别由谁拥有；
- `inputJSONSchema` 与本地 Zod passthrough为何不是同一验证；
- annotation、Permission、server validation 各回答什么；
- `client.close()` 为什么比应用 onclose callback 多做关键一步；
- AbortSignal 为什么只能证明本地控制流；
- 哪些条件下 retry 才能从 at-least-once 风险收敛；
- H4-3 为什么只做 SDK adapter port 而不手写 JSON-RPC。

下一章会把“一个远端调用”提升为“谁拥有一段长期工作”：Runtime Task、协作 Work-item、后台任务、Cron、Subagent 与 Team 的 owner、lease、mailbox 和取消如何接上本章的 generation、幂等与恢复边界。

## 源码与实验定位

- connection union 与 config：`claude-code-CLI/src/services/mcp/types.ts`。
- transport、Client connect、capabilities、list adapter、close/reconnect、call/retry：`claude-code-CLI/src/services/mcp/client.ts`。
- list_changed 和活动连接状态：`src/services/mcp/useManageMCPConnections.ts`。
- elicitation owner 与 queue：`src/services/mcp/elicitationHandler.ts` 及 print/SDK入口。
- MCP Tool passthrough schema：`src/tools/MCPTool/MCPTool.ts`；本地通用 safeParse：`src/services/tools/toolExecution.ts`。
- qualified name 与 permission identity：`src/services/mcp/mcpStringUtils.ts`。
- Resource list/read：`src/tools/ListMcpResourcesTool/`、`ReadMcpResourceTool/`。
- H4-3：`mini-agent-harness/typescript/agent/mcpSession.ts` 与 `mini-agent-harness/python/mcp_session.py`。

证据标签：Claude Code 路径描述是当前本地快照事实；MCP 的 cancellation/transport概念与快照引用的协议语义交叉核验；H4-3 的首次 list fail-closed、generation/revision、默认 no-retry、idempotency key、schema-stability check和 metadata-only trace 是 clean-room 设计迁移。
