# M04 面试官问“你怎么证明这条调用链真的走过？”：从代码图、call site 追到状态 owner 与可验证证据

<!-- INTERVIEW_LED_STYLE_V1 -->

这题面试官想考的，其实不是你会不会用 IDE 查引用，也不是看你能不能画一张箭头很多的架构图，而是看你有没有能力把“结构上有关”与“运行时真的发生”分开。

你是停在“QueryEngine import 了 query，所以 submitMessage 会调用 query”这种皮毛上，还是会继续追：真实 call site 在哪？什么 guard 决定本次是否到达？参数只是被传进去，还是对象真的被执行？状态到底改在长期 owner、当前 turn view，还是 usage 计数器？事件先 yield 后 throw，前面的副作用会不会留下？

很可惜，这位林友当时打开 Call Hierarchy，画了一张 `ask -> QueryEngine -> query -> tool` 的图，就自信地说链路已经证明。面试官追问：“本地 slash command 也一定进模型吗？`canUseTool(tool, ...)` 为什么能证明 tool 被调用？”他回答不上来。面试官摇了摇头，让他回去等通知。

今天这篇文章，我们就只追一个能被证伪的问题：一条 prompt 什么时候从 `QueryEngine.submitMessage()` 真正进入 `query()`，在那之前和之后，哪些状态已经改变？沿途会解决这些疑问：

- import、contains、call、callback、mutation，分别能证明到哪一步？
- Graphify 的 EXTRACTED 和 INFERRED 为什么都必须回源码核验？
- `shouldQuery=false` 时，为什么“没调模型”不等于“什么都没发生”？
- 数组浅快照怎样让长期消息 store 和本轮 request view 分离？
- query event 到达后，谁修改 mutableMessages、Transcript、usage 和 SDK 输出？
- 怎样用可计数 fake、TraceEvent 和部分失败测试证明一条边存在或不存在？

看完这一章，你应该从“会搜代码”升级为“会建立证据链”：候选、调用点、条件、数据、owner、失败和可观察结果，缺一个都不能把箭头画成事实。发车！

### 这篇文章写给谁？

这四个单元不再把读者假设成“已经熟悉 TypeScript、Node.js 和 Claude Code 的源码老手”。它同时面向三类人：

- **零基础或基础薄弱的 Agent 学习者**：先从一次真实操作和一个可观察问题出发，再解释术语、类型和源码；
- **正在准备大厂 Agent / Java 后端面试的人**：不仅要知道 Claude Code 怎么写，还要能把它迁移成工业级 Agent Harness 的设计答案；
- **已经能读代码、但容易停在 happy path 的工程师**：重点追状态 owner、异常路径、取消、恢复、运行时验证和可证伪证据。

### 这篇应该怎么学？

不要把正文当成 API 手册从头背到尾。每一节都按同一条主线阅读：

```text
先看用户或面试场景
-> 提出一个能被证伪的问题
-> 找到决定性源码
-> 追数据、状态与资源 owner
-> 补异常路径和边界
-> 用实验推翻错误直觉
-> 最后压成两分钟面试表达
```

文中的 Claude Code 快照事实、clean-room 运行验证和 Mini Agent Harness 设计迁移仍然严格分开；新的叙事方式只负责把路带得更清楚，不会把推断包装成源码事实。

> **原单元主题：** M04 别把连线当调用：从类型、图邻接追到真实状态变化
>
> **内容保留说明：** 下文原有源码事实、代码片段、Mermaid 图、实验结果、破坏练习、H0 迁移、跨语言对照、企业治理、面试答案和源码定位均完整保留；本次修改只重构目标读者、叙事入口、章节标题、过渡方式与总结风格。

> 本单元主体阅读与源码跟踪约 5 至 6.5 小时。双语言 Trace 实验、反证练习和扩展挑战另计约 2.5 至 4 小时。

你在一个代码图里搜到下面几条关系：

```text
QueryEngine.ts imports query
QueryEngine contains submitMessage
submitMessage calls query
submitMessage indirect_call tool
```

它们看起来都像“有一条边”，但能支持的结论完全不同。前三条里只有第三条接近运行时调用；即使第三条为真，也不代表每次 `submitMessage()` 都会进入 Query。第四条甚至可能是假阳性。

大型 Agent 系统最危险的源码误读，通常不是漏看一个函数，而是把“结构上有关”悄悄升级成“运行时一定发生”。一旦第一条边错了，后面的消息流、状态 owner、取消语义和 Harness 设计都会建立在不存在的路径上。

本单元不教你背一个“源码阅读清单”。我们只追一个可以被证伪的问题：

> 当前 SDK/Headless 路径中，一条 prompt 何时从 `QueryEngine.submitMessage()` 真正进入 `query()`，哪些状态已经在此前改变，什么证据能证明这件事？

这条追踪会把 M01 的类型边界、M02 的异步生成器和 M03 的运行时资源接成一种可重复的方法。本文所说的 QueryEngine 路径属于当前 `claude-code-CLI/` 快照；交互式 REPL 有自己的 `onQuery -> query()` 适配路径，不要因为类名叫 QueryEngine 就把所有运行表面塞进它。

## 一、先拆掉第一层错觉：源码里的“连线”根本不是同一种关系

```mermaid
flowchart TD
  Q["问题：submitMessage 是否调用 query?"] --> NAME["名字/搜索命中"]
  NAME --> STRUCT["import / contains / references"]
  STRUCT --> SITE["具体 call site"]
  SITE --> GUARD["到达 call site 的条件"]
  GUARD --> DATA["参数、事件和返回值"]
  DATA --> STATE["owner 与 mutation site"]
  STATE --> FAIL["失败、取消与 finally"]
  FAIL --> OBS["测试/日志/最小复现"]
  OBS --> CLAIM["有边界的运行结论"]
```

越往下，证据能回答的问题越强：

- 名字相同只能提示可能相关；
- import 证明模块绑定可见，不能证明分支执行；
- class contains method 证明成员归属，不能证明方法被实例化或调用；
- call site 证明某条路径可以调用，还要继续找 guard；
- 参数和事件说明数据怎样穿过边界；
- mutation site 才能说明谁真的改变了状态；
- 测试或最小复现把静态解释变成可观察行为。

低层证据不是“错误证据”。`import` 对定位文件非常有价值，只是它不能回答运行问题。严谨不是要求每次都找到最强证据，而是让证据强度与结论强度匹配。

## 二、Graphify 能帮你找路，但为什么不能替你下结论？

本单元的 Graphify 查询出现过两个很有教育意义的结果。用 `import call state tests` 一类高频词搜索时，图扩展出 253 个节点；缩成 `query engine` 后，又因为 `src/ink/layout/engine.ts` 这个同名模块扩展到 1149 个节点。

图没有坏。问题是查询词没有表达清楚你要追的是哪个运行表面。高命中量只说明结构可达，不说明结果更接近答案。

定向查看 `.submitMessage()` 邻域后，得到两个候选：

```text
EXTRACTED  submitMessage -> query()  at QueryEngine.ts:L675
INFERRED   submitMessage -> tool()   at QueryEngine.ts:L253
```

此时正确动作不是把两条边画进教材，而是打开这两个位置。

```mermaid
flowchart LR
  GRAPH["Graphify 候选"] --> E1["EXTRACTED: query()"]
  GRAPH --> E2["INFERRED: tool()"]
  E1 --> S1["回读 QueryEngine.ts:L675"]
  E2 --> S2["回读 QueryEngine.ts:L245-L259"]
  S1 --> TRUE["真实 for-await 调用"]
  S2 --> FALSE["tool 只是实参；实际调用 canUseTool"]
  TRUE --> RUNTIME["继续追条件、数据和状态"]
  FALSE --> HYP["否定候选，不写成运行事实"]
```

这里有两个重要边界：

1. `EXTRACTED` 也必须回源码核验，因为 AST 能识别语法调用，却不知道你关心的输入是否能到达它。
2. `INFERRED` 不是“低置信度事实”，而是待验证假说；源码一旦否定，就应该停止为它寻找故事。

Graphify 在正文中的作用到这里结束。接下来的事实全部来自直接源码和可运行实验。

## 三、第一条硬证据：submitMessage 真的在哪里调用 query？

`src/QueryEngine.ts` 顶部有：

```ts
import { query } from './query.js'
```

这只建立模块绑定。决定性代码位于 `QueryEngine.submitMessage()`：

```ts
for await (const message of query({
  messages,
  systemPrompt,
  userContext,
  systemContext,
  canUseTool: wrappedCanUseTool,
  toolUseContext: processUserInputContext,
  querySource: 'sdk',
  // ...
})) {
  // 根据 message.type 修改状态并向 SDK yield
}
```

这段代码能证明四件不同的事：

1. `query({...})` 在到达这里时被真实调用；
2. 返回值被当作 `AsyncIterable`，由 `for await` 逐条消费；
3. `messages`、系统上下文、权限 callback 和运行上下文作为本轮参数传入；
4. 事件到达后还要进入循环体，调用发生不等于状态已经更新。

它不能单独证明：

- 每条 prompt 都能到达 L675；
- QueryEngine 是交互式 REPL 的必经入口；
- `messages` 与长期会话数组是同一个数组引用；
- 所有 query event 都进入长期消息状态；
- 发生异常时前面的修改会回滚。

一个好的源码结论通常同时写“证明什么”和“尚未证明什么”。这能阻止后续段落在不知不觉中扩大断言。

## 四、call site 明明存在，为什么这次仍然可能一次都不调用？

> **这一节决定你是否真的会读运行路径：** call site 证明“可以调用”，guard 才证明“这个输入会不会调用”；本地命令、权限拒绝和 feature gate 都可能让结构边不发生。

要回答“是否总会调用”，必须向上找到控制这个 call site 的分支。

`submitMessage()` 先调用 `processUserInput()`：

```ts
const {
  messages: messagesFromUserInput,
  shouldQuery,
  allowedTools,
  model: modelFromUserInput,
  resultText,
} = await processUserInput({
  input: prompt,
  messages: this.mutableMessages,
  querySource: 'sdk',
  // ...
})
```

随后它先把输入阶段产生的消息写入 owner：

```ts
this.mutableMessages.push(...messagesFromUserInput)
const messages = [...this.mutableMessages]
```

再往后才判断：

```ts
if (!shouldQuery) {
  // 产生本地命令输出和 result
  return
}
```

所以真实分支是：

```mermaid
flowchart TD
  SUBMIT["submitMessage(prompt)"] --> INPUT["processUserInput"]
  INPUT --> APPEND["owner 追加 messagesFromUserInput"]
  APPEND --> SNAP["messages = [...mutableMessages]"]
  SNAP --> DECIDE{"shouldQuery?"}
  DECIDE -->|"false"| LOCAL["yield 本地命令输出/result"]
  LOCAL --> RETURN["return，不调用 query"]
  DECIDE -->|"true"| QUERY["for await query(params)"]
  QUERY --> EVENTS["按事件类型改状态并 yield"]
```

现在才能给出有边界的结论：

> `submitMessage()` 包含一个真实的 `query()` 调用点，但是否执行由 `processUserInput()` 返回的 `shouldQuery` 决定。本地 slash command 可以完成本轮并返回 SDK result，而一次都不调用 `query()`。

注意顺序：即使不进入 Query，用户输入消息也已经被追加，并可能先写 transcript。把 `shouldQuery=false` 简化成“什么都没发生”同样错误。

## 五、最常见假阳性：把 tool 当参数传入，等于执行 tool 吗？

Graphify 把 `QueryEngine.ts:L253` 标成 `tool()` 的 inferred indirect call。打开源码后看到：

```ts
const wrappedCanUseTool: CanUseToolFn = async (
  tool,
  input,
  toolUseContext,
  assistantMessage,
  toolUseID,
  forceDecision,
) => {
  const result = await canUseTool(
    tool,
    input,
    toolUseContext,
    assistantMessage,
    toolUseID,
    forceDecision,
  )

  if (result.behavior !== 'allow') {
    this.permissionDenials.push({
      tool_name: sdkCompatToolName(tool.name),
      // ...
    })
  }
  return result
}
```

JavaScript/TypeScript 中函数、对象和 class 实例都可以作为普通值传递。这里：

- 被调用的是注入的 `canUseTool(...)`；
- `tool` 是第一个实参；
- 后续读取了 `tool.name`；
- 没有 `tool(...)`，也没有 `tool.run()` 或 `tool.call()`。

```mermaid
sequenceDiagram
  participant Q as submitMessage
  participant W as wrappedCanUseTool
  participant P as injected canUseTool
  participant T as tool value
  Q->>W: later pass callback into query
  W->>P: canUseTool(tool, input, ...)
  P->>T: read metadata / decide permission
  P-->>W: PermissionResult
  W->>W: denial 时追加 permissionDenials
  Note over T: 本片段没有调用 tool 执行逻辑
```

这种误判在 Agent 系统里很常见，因为 Tool、model adapter、hook、permission policy 都经常以 callback 或对象注入。静态图看到“函数调用的参数里出现某个符号”时，可能推断间接关系；你必须区分：

```text
f(x)       -> 调用 f，把 x 作为值传入
x()        -> 调用 x
x.run()    -> 调用 x 的 run 方法
return x   -> 返回 x，不调用
() => x()  -> 创建闭包；只有闭包后来被调用时才调用 x
```

最后一种还要求继续找“谁调用闭包”。只看到闭包定义，不能声称闭包体已经执行。

## 六、从 ask 往下看：谁创建会话 owner，谁只是一次性适配？

确认 `submitMessage -> query` 后，还要回答这条链从哪里进入。当前 SDK/Headless 的 convenience wrapper 是 `ask()`。

`ask()` 接收 tools、commands、MCP clients、state getter/setter、read-file cache、model options、AbortController 等依赖，创建 QueryEngine：

```ts
const engine = new QueryEngine({
  cwd,
  tools,
  commands,
  mcpClients,
  canUseTool,
  getAppState,
  setAppState,
  initialMessages: mutableMessages,
  readFileCache: cloneFileStateCache(getReadFileCache()),
  // ...
})
```

然后：

```ts
try {
  yield* engine.submitMessage(prompt, { uuid: promptUuid, isMeta })
} finally {
  setReadFileCache(engine.getReadFileState())
}
```

这里同时出现 M02 与 M03 的知识：

- `yield*` 把 `submitMessage()` 的 SDK events 委托给外层 `ask()`；
- `finally` 保证正常、异常或消费者关闭时都尝试把 read-file state 交回外部 owner；
- finally 能证明状态 handoff 被执行，不能自动证明 Query 内所有外部资源已停止。

```mermaid
flowchart LR
  CALLER["print/SDK caller"] --> ASK["ask() one-shot adapter"]
  ASK --> NEW["new QueryEngine(dependencies)"]
  NEW --> OWNER["engine owns conversation/runtime state"]
  ASK -->|"yield*"| SUBMIT["submitMessage(prompt)"]
  SUBMIT --> QUERY["conditional query()"]
  SUBMIT --> SDK["SDKMessage stream"]
  ASK -->|"finally"| CACHE["read-file state handoff"]
```

边界必须保留：当前源码注释说 QueryEngine 可供 headless/SDK 使用，并提到未来 REPL 复用；当前交互式 REPL 并不是通过 QueryEngine 才能进入 `query()`。追 caller 时，注释的愿景和当前调用点要分开。

## 七、只找到函数还不够：真正决定后果的是 state owner

> **面试官在这里看架构能力：** owner 决定状态跨不跨 turn、失败后留不留下、并发时谁竞争；函数名只能告诉你动作发生在哪里。

`QueryEngine` 的字段比类名更诚实：

```ts
private config: QueryEngineConfig
private mutableMessages: Message[]
private abortController: AbortController
private permissionDenials: SDKPermissionDenial[]
private totalUsage: NonNullableUsage
private readFileState: FileStateCache
private discoveredSkillNames = new Set<string>()
private loadedNestedMemoryPaths = new Set<string>()
```

constructor 把 `config.initialMessages ?? []` 直接赋给 `this.mutableMessages`，并保存或创建 AbortController。类注释明确这些状态可跨同一 conversation 的多个 turn 保留。

不要把所有变量都叫“state”。至少区分：

| 值 | owner | 生命周期 | 谁修改 |
| --- | --- | --- | --- |
| `this.mutableMessages` | QueryEngine | conversation / 多 turn | submitMessage 的输入和事件分支 |
| `messages` | 当前 submitMessage 调用 | 当前 turn 的数组视图 | 本地 push、transcript 路径 |
| `processUserInputContext` | 当前 submitMessage 调用 | 输入处理与 Query 装配 | submitMessage 重建 |
| `permissionDenials` | QueryEngine | engine 生命周期 | wrappedCanUseTool |
| `totalUsage` | QueryEngine | engine 生命周期 | stream_event 分支 |
| `readFileState` | QueryEngine，结束后 handoff | engine 生命周期 | Tool context；ask finally 导出 |

```mermaid
flowchart TD
  ENGINE["QueryEngine owner"] --> MM["mutableMessages"]
  ENGINE --> ABORT["abortController"]
  ENGINE --> USAGE["totalUsage"]
  ENGINE --> DENY["permissionDenials"]
  ENGINE --> FILE["readFileState"]
  TURN["submitMessage turn"] --> VIEW["messages array view"]
  TURN --> CTX["processUserInputContext"]
  MM -->|"array spread"| VIEW
  CTX -->|"injected callbacks"| QUERY["query()"]
  QUERY -->|"events"| TURN
  TURN -->|"selected mutations"| MM
```

源码追踪到调用点却不找 owner，最终只能说“数据经过了这里”。找到 owner 和 mutation site 后，才能说清失败后留下什么、下一 turn 看见什么、并发时谁会竞争。

## 八、两行数组代码，为什么足以改变整条消息链的解释？

下面两行是 M04 的小型试金石：

```ts
this.mutableMessages.push(...messagesFromUserInput)
const messages = [...this.mutableMessages]
```

数组展开创建了新的数组容器。因此后续：

```text
this.mutableMessages.push(x)
```

不会自动增加 `messages.length`；反过来也一样。但元素对象仍共享引用，如果某个 message 对象被原地修改，两个数组视图可能都观察到变化。

```mermaid
flowchart LR
  STORE["mutableMessages array\nowner store"] --> M1["message object A"]
  STORE --> M2["message object B"]
  SPREAD["messages array\nturn view"] --> M1
  SPREAD --> M2
  STORE -->|"later push"| M3["message object C"]
  NOTE["新数组，不是深拷贝"] -.-> STORE
  NOTE -.-> SPREAD
```

这一点怎样改变运行语义？`query()` 收到的是本轮组装时的数组视图，QueryEngine 仍持有长期 store。循环中有些事件同时 push 到两者，有些只改 owner store，有些只更新 usage。你不能只看变量名 `messages` 猜它们同步。

M11 会完整讲请求投影；M04 只要求掌握追踪动作：看到复制，立刻画引用；看到 push，标明目标数组；看到对象 mutation，再检查元素身份是否共享。

## 九、query 不是返回一个大对象：每个事件到底改了什么？

M02 已讲过 `for await`。在这里，它改变的是状态证据：每个 event 到达后，`switch (message.type)` 执行不同副作用。

当前快照可直接确认：

- `assistant`：更新 stop reason，push 到 `mutableMessages`，再 normalize/yield；
- `progress`：push 到 owner store，必要时也 push 到 turn view 并 fire-and-forget transcript，然后 normalize/yield；
- `user`：push 到 owner store，再 normalize/yield；
- `stream_event`：更新本条消息 usage，`message_stop` 时累计进 `totalUsage`；是否向 SDK yield 取决于 `includePartialMessages`；
- `attachment`：push owner store，可能写 transcript，并处理 structured output、max-turns 等子类型；
- `tombstone`：作为控制信号跳过普通消息写入。

```mermaid
flowchart TD
  EVENT["query event"] --> KIND{"message.type"}
  KIND -->|"assistant/user"| STORE["push mutableMessages"]
  STORE --> NORMALIZE["normalize -> SDK yield"]
  KIND -->|"progress"| PERSIST["store + optional transcript"]
  PERSIST --> NORMALIZE
  KIND -->|"stream_event"| USAGE["update/accumulate usage"]
  USAGE --> PARTIAL{"includePartialMessages?"}
  PARTIAL -->|"yes"| YIELD["yield SDK stream_event"]
  PARTIAL -->|"no"| NEXT["consume next event"]
  KIND -->|"attachment"| ATTACH["store + subtype effects"]
  KIND -->|"tombstone"| SKIP["control only / skip"]
```

所以“`submitMessage` 调用了 query”只是调用链的一半。完整解释至少还要说：事件怎样被消费，哪个分支修改哪个 owner，哪些状态只在本地累计，哪些值继续对外 yield。

## 十、流中途炸了，前面写入的状态会自动回滚吗？

假设 query 先 yield 一条 assistant message，QueryEngine 已经把它 push 到 `mutableMessages`，随后下一次迭代抛异常。JavaScript 没有自动事务语义；此前的数组 push、transcript enqueue 或 usage 更新不会因为 generator throw 自动回滚。

```mermaid
sequenceDiagram
  participant Q as query stream
  participant E as submitMessage
  participant S as mutableMessages
  participant C as SDK caller
  Q-->>E: assistant(partial)
  E->>S: push partial message
  E-->>C: yield normalized message
  Q--xE: throw error
  E--xC: iterator rejects
  Note over S: 已写状态仍然存在，除非显式补偿
```

这不是说当前 QueryEngine 一定在所有异常下保留同样状态，而是一个追踪规则：每个副作用发生后，继续寻找它的 rollback、compensation 或 recovery；若没有，就不能假定异常原子性。

企业 Agent 中尤其要区分：

- 内存消息已追加；
- transcript 已持久化或只进入写队列；
- 工具外部副作用已经发生；
- SDK caller 已收到部分流事件；
- 当前 iterator 最终 reject。

“请求失败”不是一个能覆盖这些层次的布尔值。

## 十一、依赖注入之后，静态调用图为什么天然不完整？

`QueryEngineConfig` 注入 `canUseTool`、`getAppState`、`setAppState`、cache getter/setter、Elicitation handler 等函数。静态源码可以看到字段被调用，却未必知道运行时具体绑定哪个实现。

```mermaid
flowchart LR
  COMPOSE["ask()/composition root"] -->|"inject CanUseToolFn"| ENGINE["QueryEngine"]
  ENGINE --> WRAP["wrappedCanUseTool closure"]
  WRAP -->|"runtime callback"| POLICY["concrete permission policy"]
  POLICY --> RESULT["allow / deny / ask"]
  RESULT --> WRAP
  WRAP -->|"deny side effect"| DENIALS["permissionDenials owner state"]
```

追踪这种边要做三次定位：

1. 调用位置：字段或闭包在哪里被执行；
2. 类型协议：参数和返回值怎样约束实现；
3. composition root：当前运行模式把哪个具体实现传进来。

如果第三步在当前单元不重要，可以停在“调用注入的 CanUseToolFn，具体实现由 caller 决定”，但不能凭字段名虚构具体类。成熟的源码阅读允许有边界地停止。

## 十二、没有官方专题测试时，怎样保持结论可信？

理想情况下，你会从原仓库测试确认：本地分支不调用 Query、事件分支更新哪些字段、异常后留下什么。当前快照没有提供可直接定位的 QueryEngine 专题测试文件，因此不能声称“官方测试已覆盖”。此外，`src/query.ts` 还 type-import `./query/transitions.js`，但当前快照缺少对应 `src/query/transitions.ts`；这意味着不能把原项目 Query 路径说成已能在本地完整 typecheck 或直接构造运行。静态调用与状态结论仍可从可见源码核验，运行层则必须明确使用独立 clean-room 复现。

这时有三种诚实选择：

- 只保留静态源码能证明的条件结论；
- 找更邻近的测试、fixture、mock 或注释，但不扩大它们的证明范围；
- 写一个不复制私有实现的最小复现，把语言/协议假设变成可观察事件。

本单元采用第三种，同时明确它验证的是追踪方法和 H0 设计，不是给 Claude Code 快照补官方测试。

## 十三、别说“我看懂了”：用 TraceLog 把解释变成可反驳事件

> **真正可靠的源码结论要允许被推翻。** 让 fake 统计调用次数，让 Trace 记录 owner mutation，让部分失败暴露提交点，比再画一张大图更有说服力。

代码位置：

```text
curriculum/units/M04/code/typescript/
curriculum/units/M04/code/python/
```

TypeScript：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M04\code\typescript"
node traceHarness.test.ts
node demo.ts
powershell -File typecheck.ps1
```

Python：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M04\code\python"
python -m unittest -v test_trace_harness.py
python demo.py
```

当前结果：TypeScript 5/5、Python 5/5，两个 demo 正常，TypeScript strict typecheck 通过。

实验里的 `TraceableEngine` 不复制 QueryEngine。它只保留这次方法训练所需的最小结构：

```ts
const processed = await processInput(prompt, history)
ownerMessages.push(...processed.messages)
const requestView = [...ownerMessages]

if (!processed.shouldQuery) return

for await (const message of queryStream(requestView)) {
  ownerMessages.push(message)
  yield message
}
```

每次关键动作由 TraceLog 记录成判别事件：

```text
call.entered
state.mutated
view.snapshotted
event.yielded
branch.skipped
call.failed
```

这继承了 M01 的联合类型，又把 M02 的事件流和 M03 的生命周期观察接进同一测试骨架。

### 主路径：调用、事件和 mutation 必须同时出现

主路径预期：

```text
call processInput
-> owner messages size=1
-> request view size=1
-> call queryStream
-> yield assistant
-> owner messages size=2
```

仅断言最终有两条消息是不够的，因为你不知道 Query 是否被调用、视图何时创建。仅断言 Query 被调用也不够，因为你不知道 owner 是否吸收了事件。Trace 把几个相互独立的结论分开。

### 本地分支：证明“没有调用”

`processInput.shouldQuery=false` 时，测试同时检查：

- query counter 为 0；
- Trace 中没有 `submitMessage -> queryStream`；
- 末事件是 `branch.skipped`，reason 明确。

负结论比正结论更难证明。源码中没搜到调用不代表运行中没调用；这里能证明，是因为依赖被换成可计数 fake，且测试完整执行了目标分支。

### 请求视图：观察两个容器的长度分离

queryStream 保留收到的 request view。它 yield assistant 后，engine owner 变成两条消息，而保留视图仍是一条。这验证数组容器分离，不验证元素深不可变。

### 传参反证：tool.run 计数保持 0

permission callback 收到 ToolProbe，只读取 `name`。若“出现为调用参数”真的等于执行工具，`runCalls` 应大于 0；实际两种语言都保持 0。这直接推翻错误图边。

### 部分失败：先写状态，再抛错

queryStream 先 yield `partial`，再 throw。caller 最终看到异常，但 engine state 保留 user 与 partial assistant，Trace 最后是 `call.failed`。这证明没有自动事务回滚。

## 十四、亲手制造六次失败，看看哪条解释最先站不住

1. 删除 `shouldQuery` guard，观察本地命令也调用 Query；说明 import 不变但运行边改变。
2. 把 `requestView = [...messages]` 改成直接引用，观察后续 owner push 怎样改变视图长度。
3. 在 permission wrapper 中误写 `tool.run()`，让反证测试失败；比较传参和执行的副作用差异。
4. 删除 `state.mutated` trace，只保留 call trace；尝试回答失败后留下什么，体会证据缺口。
5. query yield 后、owner push 前抛错，比较部分状态与对外事件顺序。
6. 让两个注入的 QueryStream 实现产生同样最终消息但不同事件顺序，验证最终快照不能替代过程协议。

每次先写预测，再改代码。你的目标不是“制造红灯”，而是说明哪条源码解释会被这个红灯推翻。

## 十五、把这次分析收敛成一套可复用的源码追踪循环

现在把本章过程收敛成一个循环，而不是死清单：

```mermaid
flowchart TD
  QUESTION["写下可证伪的运行问题"] --> CANDIDATE["用 rg/Graphify 找候选"]
  CANDIDATE --> RELATION["标注 import/contains/call/callback/state"]
  RELATION --> SOURCE["打开决定性调用点"]
  SOURCE --> UP["向上找 caller 与 guard"]
  SOURCE --> DOWN["向下找事件与返回"]
  UP --> OWNER["标 owner 与 mutation"]
  DOWN --> OWNER
  OWNER --> FAIL["追失败/取消/finally"]
  FAIL --> OBSERVE["测试、日志或最小复现"]
  OBSERVE --> VERDICT{"证据足够?"}
  VERDICT -->|"否"| NARROW["缩小表述/补证"]
  NARROW --> SOURCE
  VERDICT -->|"是"| EXPLAIN["写出结论和边界"]
```

起点必须是问题，不是文件名。例如：

- 好问题：“本地 slash command 是否仍进入模型 Query？”
- 弱问题：“解释 QueryEngine.ts。”

前者自然要求找到 guard、调用点和可观察反例；后者很容易变成 1200 行源码的函数目录。

停止条件也很重要。若你的结论只需要说明“调用注入的权限协议”，找到 callback 类型和调用点就可能足够；若要解释某个企业策略为何拒绝，才需要继续追 composition root。无界追踪不是深度，是失去问题边界。

## 十六、把可观察证据与跨语言测试合进 Mini Agent Harness

M01 给了类型与状态契约，M02 给了异步事件端口，M03 给了取消/资源收敛。M04 增加的不是另一套 Agent 功能，而是让这些契约可被持续验证的骨架。

```mermaid
flowchart TD
  CONTRACTS["M01 typed contracts"] --> H0["H0 behavior harness"]
  STREAM["M02 async events"] --> H0
  CANCEL["M03 cancel/resource events"] --> H0
  TRACE["M04 TraceEvent + TraceLog"] --> H0
  H0 --> TS["TypeScript behavior suite"]
  H0 --> PY["Python behavior suite"]
  H0 --> INV["shared invariants"]
  INV --> OWNER["owner/mutation"]
  INV --> ORDER["event ordering"]
  INV --> NEG["negative call assertions"]
  INV --> FAILURE["partial failure boundary"]
```

合入契约：

- 事件必须有稳定 type；跨语言比较语义，不比较类名或裸平台值；
- 运行调用必须来自实际 trace 或具体 call site，静态 import 不记作 runtime event；
- mutation event 必须标 owner 与 field；
- 负路径用可计数 fake 或明确 branch event 证明；
- 失败测试同时检查对外结果与已提交状态；
- Trace 是测试与观测接口，不是无限日志；不得记录 prompt、密钥或敏感 Tool 输入全文。

状态所有者：每个运行实例拥有自己的 TraceLog；业务组件仍拥有业务状态，TraceLog 只观察，不反向修改。兼容影响：后续新增事件变体时，TypeScript/Python 测试映射都要更新；生产 telemetry adapter 可以转换事件，但不能改变领域顺序。

失败语义：Trace 写入失败不能阻断核心 Agent 运行；测试模式可以 fail-fast，生产模式应有采样、限流和脱敏。H0 当前使用内存数组，后续 M40 再接完整观测治理。

## 十七、换成 Java/Spring：Bean 依赖图为什么也不是运行调用图？

Spring 容器能告诉你 Bean A 依赖 Bean B，但不能证明一次请求执行了 B 的哪个方法。`@Autowired PermissionPolicy` 类似 QueryEngineConfig 的 callback 注入：composition root 建立依赖，业务方法在具体分支调用协议。

Java 追踪时也分三层：

```text
类依赖/Bean wiring
-> 方法调用与条件
-> transaction/event/async 边界后的状态提交
```

代理让问题更复杂：`@Transactional`、`@Async`、AOP interceptor 会在源代码直接调用之外插入运行行为。此时调用点仍是起点，但最终边界要结合代理配置、事务测试和 trace/span。不要因为 IDE Call Hierarchy 没显示代理就说它不存在，也不要因为 Bean 图连通就说每次都调用。

本章 H0 TraceEvent 可映射成 Java sealed interface；测试用 fake `ProcessInput`/`QueryPort` 记录 invocation，状态修改用领域事件或 test probe 观察。重要的是保持同一不变量，而不是把 TypeScript 私有字段逐行翻成 Java class。

## 十八、换成 Python：动态绑定为什么更需要 composition root 与 fake？

Python 把 async callable 直接传入对象非常自然，但静态工具更难确定具体实现。Protocol/type hint 可以说明期望形状，运行 trace 和 fake 才能证明某次绑定。

本章 Python 实现使用：

- async callable 表示 `process_input`；
- async iterator 表示 `query_stream`；
- dataclass TraceEvent 表示可观察事件；
- `IsolatedAsyncioTestCase` 验证调用、分支和部分失败。

它没有模仿 TypeScript private field 或 union 穷尽检查。两种语言共享的是“什么必须被观察”，而不是“怎样写相同语法”。

## 十九、LangGraph 画了节点边，就能代表所有内部副作用吗？

LangGraph 的 edge 表示控制可以从节点 A 转到节点 B；conditional edge 仍要看 state/router 才知道本次走哪条。节点 B 内部又可能调用模型、Tool、数据库或子进程，这些不会自动出现在上层图边里。

因此调试 LangGraph Agent 也要分层：

- graph transition：哪个 router 选择哪个节点；
- node invocation：节点函数是否真正进入；
- internal dependency call：模型/Tool/存储谁被调用；
- state reducer：哪个字段被怎样合并；
- external effect：真实副作用是否确认。

Claude Code 的 `shouldQuery` 与 LangGraph conditional edge 很相似：结构上存在目标不代表本次会走。不同点是 QueryEngine 用普通 TypeScript 分支和 async generator 实现，不应反过来说它“就是一个 LangGraph”。

## 二十、企业级代码智能：静态图、运行 Trace、契约测试怎么分层治理？

企业代码智能系统常把 AST、依赖图、distributed trace、日志和测试覆盖率塞进一个 UI。好的系统不会把它们压成一种“关系”。

```mermaid
flowchart LR
  STATIC["静态层\nimport/contains/references"] --> HYP["候选影响范围"]
  TEST["契约测试\n输入/分支/不变量"] --> BEHAVIOR["可重复行为"]
  TRACE["运行 trace\n实际调用/状态/时序"] --> OBS["生产观察"]
  HYP --> REVIEW["源码人工核验"]
  BEHAVIOR --> REVIEW
  OBS --> REVIEW
  REVIEW --> DECISION["架构与变更决策"]
```

建议把数据模型分开：

- `StaticEdge(kind, source, target, location, confidence)`；
- `RuntimeSpan(runId, caller, callee, start, end, status)`；
- `StateMutation(runId, owner, field, version, reason)`；
- `ContractResult(scenario, invariant, pass/fail)`。

不要让静态关系冒充生产调用率，也不要让一次 trace 冒充所有分支。隐私上，TraceEvent 只保留结构化类型、owner、资源 ID 和脱敏摘要；prompt、Tool 输入、文件内容和凭据按最小化原则处理。成本上，通过采样和关键边强制记录平衡可观测性与延迟。

代码审查时，可以要求每个高风险 Agent 改动回答三件事：新增了哪条静态依赖，改变了哪个运行分支，哪个契约测试或 trace 能观察到。这样 Graphify/IDE 帮你找候选，测试帮你固定行为，生产 trace 帮你发现环境差异，各司其职。

## 二十一、面试官继续深挖：怎样把“查引用”答成可验证架构？

下面 8 道题覆盖面试官会从源码追踪直接延伸出的调用、依赖注入、状态、异步失败和企业观测问题。参考回答都先给结论，再展开 Claude Code 的决定性例子和生产边界。

### 问题 1：看到 A 文件 import 了 B，能不能说 A 在运行时调用了 B？

**参考口语回答（约 2 分钟）：**

> 先说结论：不能，import 只证明模块绑定或类型可见，运行调用还要找到 call site 和能到达它的条件。Claude Code 的 QueryEngine.ts 确实 import 了 query，但 submitMessage 先跑 processUserInput；如果 shouldQuery 是 false，本地 slash command 会产出 result 并 return，一次都不调用 query。只有到 L675 的 `for await (const message of query(...))`，我才能确认真实调用和异步消费。工程上我会把 import、contains、calls、callback 和 mutation 分开记录，再用分支测试或 trace 证明特定输入走了哪条边，避免把依赖图当调用图。

### 问题 2：你拿到一个几千文件的 Agent 仓库，会怎样快速找到一条真实运行链？

**参考口语回答（约 2 分钟）：**

> 先说结论：我先写一个可证伪的运行问题，再从外部入口、决定性 call site、状态 owner 和可观察结果做纵向切片，不会按目录通读。以 QueryEngine 为例，我问的是“本地命令是否仍进入模型 Query”，先用 Graphify 或 rg 找 submitMessage 和 query 候选，然后回源码找 processUserInput 返回的 shouldQuery guard，再向上追 ask 的构造和依赖注入，向下追 for-await 事件怎样 push mutableMessages。最后用可计数 fake 证明 false 分支 queryCalls 为 0。这样图工具负责缩小搜索，源码负责事实，实验负责证伪，三层不会混。

### 问题 3：依赖注入为什么会让静态调用图不完整？你怎样处理？

**参考口语回答（约 2 分钟）：**

> 先说结论：静态代码通常只能看到“调用一个协议字段”，具体实现由 composition root 在运行时绑定，所以要把调用位置、接口契约和装配位置分开追。Claude Code 的 wrappedCanUseTool 调用注入的 canUseTool，并把 tool 作为参数；仅看参数名甚至会误推成 tool 被执行。我要先确认 `canUseTool(...)` 的直接调用，再看 CanUseToolFn 的输入输出，只有问题需要解释具体策略时才继续追 ask 或更上层传入哪个实现。生产上再用 span 标注实现 ID 和决策结果，但不记录敏感输入。这样既承认动态绑定，也不靠猜测补调用边。

### 问题 4：源码追踪里为什么状态 owner 比函数列表更重要？

**参考口语回答（约 2 分钟）：**

> 先说结论：函数列表只能说明代码经过哪里，owner 才决定失败后数据留在哪里、下一轮谁能看见以及并发时谁会冲突。QueryEngine 持有跨 turn 的 mutableMessages、usage、permissionDenials 和 readFileState；submitMessage 还创建当前 turn 的 messages 数组视图。query event 到来后，有的 push 长期 store，有的更新 usage，有的只控制是否向 SDK yield。若只说“消息经过 query”，我解释不了异常后的部分状态或恢复。企业 Harness 我会要求 mutation event 带 owner、field、runId 和 version，跨 owner 写入必须经过显式协议。

### 问题 5：静态源码已经很清楚了，为什么还要最小复现？

**参考口语回答（约 2 分钟）：**

> 先说结论：最小复现不是替代源码，而是把容易误判的语言和协议假设变成可观察反证。比如数组 spread 创建新容器、for-await 部分 yield 后 throw 不回滚、对象作为参数不等于调用，这些都能从规范推导，但一个小测试能明确观察 requestView 长度、tool.run 计数和失败后的 owner state。M04 的 TraceableEngine 不冒充 Claude Code 实现，只验证同一追踪契约。若原仓库测试缺失，我会缩小快照结论，并把 clean-room 结果标为运行验证，绝不说它补齐了官方证据。

### 问题 6：Agent 流式调用中途失败，怎样判断哪些状态需要补偿？

**参考口语回答（约 2 分钟）：**

> 先说结论：按副作用提交点逐个判断，不能把 iterator reject 当事务回滚。Claude Code 的 submitMessage 会边消费 query event 边 push mutableMessages、记录 transcript 或累计 usage；如果已经处理 assistant 后下一次迭代失败，之前的状态可能保留，SDK caller 也可能已收到部分输出。我的设计会把 event accepted、state committed、external effect confirmed 和 stream failed 分成事件，对可逆状态补偿，对 Tool 外部副作用用幂等键或 saga，对 transcript 保持可恢复顺序。测试既看最终 error，也看失败前的事件和 owner state。

### 问题 7：代码图和 distributed trace 应该怎样结合，才不会互相误导？

**参考口语回答（约 2 分钟）：**

> 先说结论：代码图回答“可能有什么结构关系”，runtime trace 回答“这次实际走了什么”，契约测试回答“给定场景必须满足什么”，三者要保留来源和语义，不能合并成一条无类型的边。Graphify 可以提示 submitMessage 邻居，但 inferred tool call 回源码后被否定；一次生产 trace 又只能代表一个输入。企业系统里我会分别存 StaticEdge、RuntimeSpan、StateMutation 和 ContractResult，用源码位置与稳定符号关联。变更评估先看静态影响，再跑契约测试，最后观察灰度 trace 与 SLI，任何一层都不能单独宣布全局真相。

### 问题 8：你会怎样为自己的 Agent Harness 设计可观测性，而不把日志做成新负担？

**参考口语回答（约 2 分钟）：**

> 先说结论：先从少量稳定领域事件和不变量开始，Trace 只观察、不拥有业务状态，也不能阻断主流程。H0 我会记录 call.entered、state.mutated、view.snapshotted、event.yielded、branch.skipped、call.failed，并强制 mutation 带 owner；取消再复用 M03 的 requested、exit confirmed、cleanup。测试模式全量记录并 fail-fast，生产模式采样、限流、脱敏，Trace 写失败降级而不是让 Agent 失败。像 Claude Code 的消息和 usage 分支，我关心类型、顺序和资源 ID，不会把 prompt、Tool 输入或密钥全文放进 telemetry。

真正有区分度的回答不是“我会用 IDE 查引用”，而是你能说明哪种边支持哪种结论、何时需要继续追、怎样用失败输入推翻自己的解释。

## 二十二、关掉答案：你能不能独立完成一次纵向证据闭环？

先关掉本文，写下一个问题：“一条本地 slash command 是否调用模型 Query？”画出 `ask -> QueryEngine -> processUserInput -> shouldQuery -> query/local result`，在每条箭头上标 `constructs`、`calls`、`returns flag`、`branches` 或 `yields`，不要都写“经过”。

再打开 Graphify 或 IDE，只把结果记成候选。验证 `.submitMessage -> query()` 的真实 call site；验证 `.submitMessage -> tool()` 为什么是假阳性。用自己的话解释 `canUseTool(tool, ...)` 与 `tool()` 的差别。

随后为 `mutableMessages`、turn-local `messages`、permissionDenials、usage 和 readFileState 标 owner、生命周期和 mutation site。用两个数组盒子画出浅快照，明确容器分离与元素共享。

运行双语言 5 个测试。把 `shouldQuery=false` guard 删除一次，把 permission wrapper 改成执行 tool.run 一次，再让 query 在 partial event 后失败。每次写出哪条解释被红灯推翻，不要只记录“测试失败”。

最后选你自己的 Spring/LangGraph/RAG 项目做同样切片：一个 Bean/节点边、一个真实方法调用、一个状态 reducer、一个外部副作用和一个失败恢复。能把这五者分开，你才真正具备进入 M05 以后复杂运行表面的源码追踪能力。

## 写在最后：源码追踪背后的四个设计哲学

一、**静态边首先是假说，不是运行事实。** import、contains 和 references 用来缩小搜索面；call site、guard 与 trace 才能逐步增强结论。

二、**条件决定路径，owner 决定后果。** 是否调用要看 guard，调用以后留下什么要看 mutation site 与生命周期 owner。

三、**参数传递、回调调用和真实副作用必须分开。** `f(x)`、`x()`、`x.run()` 与 `() => x()` 是四种不同关系，任何图工具都可能在这里产生假阳性。

四、**证据必须分层治理。** 静态图说明可能影响，契约测试说明给定场景的不变量，运行 trace 说明这一次真实发生；没有任何一层可以单独代表全局真相。

面试现场用一句话收束：**我不从箭头猜调用，而是从 call site、guard、owner、mutation、失败路径和可观察反证建立证据链。**

## 附录：源码定位地图

行号只作当前快照辅助，优先按符号搜索：

- `src/QueryEngine.ts` -> `QueryEngine` fields/constructor -> 跨 turn 状态 owner -> 约 176-207 行。
- 同文件 -> `submitMessage()` -> `wrappedCanUseTool` -> 调用注入 callback、传入 tool、记录 denial -> 约 209、243-270 行。
- 同文件 -> `processUserInput()` 调用 -> 追加 owner messages、创建 turn view、写入 transcript -> 约 410-463 行。
- 同文件 -> `if (!shouldQuery)` -> 本地输出/result 并 return -> 约 556-639 行。
- 同文件 -> `for await (const message of query(...))` -> 真实 Query 调用与参数装配 -> 约 675 行。
- 同文件 -> event switch -> mutableMessages、transcript、usage 与 SDK yield -> 约 753-850 行起。
- 同文件 -> `ask()` -> 创建 QueryEngine、`yield* submitMessage`、finally handoff read-file state -> 约 1186-1294 行。
- `src/query.ts` -> `query()` / `queryLoop()` -> AsyncGenerator 委托边界 -> 约 219-250 行。
- `src/utils/processUserInput/processUserInput.ts` -> `processUserInput()` -> 输入适配结果与 shouldQuery 来源。

证据说明：上述调用、条件、owner 与 mutation 是当前快照事实；Graphify 查询只用于候选定位并包含一次被源码否定的 inferred edge；双语言 TraceableEngine 是 clean-room 运行验证；H0 TraceEvent、TraceLog、测试骨架和企业观测模型是设计迁移。当前快照未发现可直接定位的 QueryEngine 专题测试，并缺少 `src/query/transitions.ts`，因此没有把 clean-room 测试写成官方实现证明，也没有声称原 Query 路径已在本地通过 typecheck。
