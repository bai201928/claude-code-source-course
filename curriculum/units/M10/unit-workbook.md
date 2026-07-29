# M10 单元研究工作簿

状态：`release-candidate`

风险：`R2`

## 1. 单元问题、边界与前置

真实问题：一条消息同时服务 UI、模型上下文、工具反馈、SDK 输出和恢复时，为什么不能只用一个可变 `messages` 数组和一个 `id` 字段。

本单元闭合：

- REPL 与 Headless 的长期消息容器分别由谁拥有；
- 一次 turn 的数组快照保证什么、不保证什么；
- internal envelope、API response、tool call、transcript edge 和 session output 的身份为何必须分开；
- human user、tool result、attachment、progress、system/control message 为什么不能只按 role 判断；
- 进入后续 Query/Tool Loop 前应具备哪些唯一性、配对、持久化和并发不变量。

本单元不展开：

- M11 的完整输入到模型纵切；
- M12 的 `query()` / `queryLoop()` 控制流；
- M13 的完整 Context Pipeline 和 API normalization 算法；
- M15 的工具权限与调度；
- 后期 Transcript、fork、compact 和恢复的完整实现。

前置：M01 的 discriminated union/runtime validation，M02 的异步事件，M04 的 owner/turn view，M05 的 Runtime Surface，M07 的 session/request snapshot，M09 的 `Map`/`Set` 身份语义。

## 2. Graphify 候选与直接核验

Graphify BFS 将 `Messages`、`QueryEngine`、`REPL.tsx`、`query.ts`、`utils/messages.ts`、`sessionStorage.ts` 和 `messageQueueManager.ts` 放在同一候选邻域。该查询返回 1971 个节点且被截断，只能说明阅读方向，不能证明运行调用。

直接源码已经确认主要路径：

```text
Interactive
REPL.tsx local messages/messagesRef
-> eager setMessages wrapper
-> handlePromptSubmit/processUserInput
-> append newMessages
-> onQueryImpl([...current envelopes])

Headless
print.ts mutableMessages
-> ask(initialMessages: same array)
-> new QueryEngine
-> processUserInput
-> engine mutableMessages.push(...input)
-> const messages = [...engine mutableMessages]
```

## 3. 快照证据缺口

`src/types/message.ts` 被大量源码导入，但当前快照没有该文件；`src/entrypoints/sdk/coreTypes.ts` 又导出缺失的 `coreTypes.generated.ts`。因此：

- 不能声称已经读取完整 `Message` 联合或全部 SDK 生成类型；
- 可以依据真实构造函数、switch、type guard、Zod schema 和持久化逻辑确认用到的消息族与字段；
- 教材必须把“观察到的可确认形状”和“完整类型全集”区分开；
- 缺失文件不阻断运行机制教学，但禁止补写想象中的私有类型定义。

`coreSchemas.ts` 仍可确认公开 SDK 输出协议包含 user、assistant、result、system、stream_event、tool_progress 等多个 discriminant，以及 `uuid`、`session_id`、`parent_tool_use_id` 等字段。

## 4. 消息不是一层对象

从使用点可以确认至少四个层次：

| 层次 | 例子 | 主要职责 |
| --- | --- | --- |
| internal envelope | `type`、`uuid`、`timestamp` | 本地数组身份、UI、去重、持久化锚点 |
| provider payload | `message.role/content/id/usage/stop_reason` | 模型协议与流式响应内容 |
| local-only metadata | `toolUseResult`、`sourceToolAssistantUUID`、`isMeta`、`origin` | 执行、显示、恢复和来源判断 |
| external SDK event | `session_id`、`parent_tool_use_id`、result/status subtype | 宿主消费协议，不等于内部 Message |

`createUserMessage()` 和 `createAssistantMessage()` 都生成 envelope `uuid` 与 timestamp；assistant 的 provider payload 另有 `message.id`。`createProgressMessage()` 与 `createAttachmentMessage()` 也生成自己的 envelope UUID，但这不意味着它们拥有与 user/assistant 相同的持久化或 API 语义。

## 5. Interactive owner：ref 是同步事实，React state 是渲染投影

`REPL.tsx` 约 1182 行创建：

```text
messages state
messagesRef = useRef(messages)
```

包装后的 `setMessages(action)` 先对 `messagesRef.current` 求值并同步写回，再把已经求出的 `next` 交给 `rawSetMessages(next)`。这使同一调用栈在 React 下一次 render 前也能读取新数组。

约 2891 行先追加 `newMessages`，随后立即读取 `messagesRef.current` 交给 `onQueryImpl()`。因此：

- 主消息数组不由 AppState 自动拥有；
- React render state 不是当前调用栈的唯一读取入口；
- 多次函数式更新由 ref 上的最新数组串联，而不是等待 React 批处理；
- rewind、compact、clear 会让数组缩短，相关 index/watermark 必须随 owner 更新。

## 6. Headless owner：共享数组只在保持同一引用时共享

`print.ts` 约 1145 行把 `initialMessages` 作为跨 command 的 `const mutableMessages`；每次 command 调 `ask()`。`ask()` 每次创建新的 `QueryEngine`，构造器把传入数组赋给私有字段。

普通 prompt 路径执行：

```text
engine.mutableMessages === print.mutableMessages
-> push input messages
-> const turnMessages = [...engine.mutableMessages]
```

所以普通 append 会同时改变共享 owner 数组，而 `turnMessages` 的成员集合在复制时固定。

需要 FACT_A 核验的边界：`ProcessUserInputContext.setMessages` 使用 `this.mutableMessages = fn(this.mutableMessages)`。如果 slash command 返回新数组，engine 字段会重绑定，而 `print.ts` 的外部 `const mutableMessages` 不会自动改指向；`ask()` finally 只同步 read-file cache，没有调用 `getMessages()` 回写。不能在审查前把“所有 setMessages 都能同步回 print owner”写成事实。

## 7. 浅快照只隔离容器，不隔离元素

`const messages = [...this.mutableMessages]` 保证：后续对 owner 数组执行 `push/splice` 不会自动改变这个数组的长度和成员位置。

它不保证：

- message envelope 被深复制；
- nested `message.content`、usage 或 stop reason 不再变化；
- 后台 writer 不会修改同一个对象。

`services/api/claude.ts` 在每个 `content_block_stop` 创建新的 AssistantMessage 并 yield；后续 `message_delta` 会直接修改 `lastMsg.message.usage` 与 `lastMsg.message.stop_reason`，原因是 transcript 写队列保存了该对象引用并延迟序列化。因而旧数组 view 仍可观察到共享元素的字段变化。

这是 M10 的核心 TypeScript 难点：spread 是 shallow copy；`readonly Message[]` 只约束通过这个引用进行数组写入，不会递归冻结元素，也不会阻止其他别名修改对象。

## 8. 五类身份不能混用

| 身份 | 产生/使用位置 | 语义 |
| --- | --- | --- |
| envelope `uuid` | message creators / streamed block stop | 本地消息实例与 transcript 节点身份 |
| assistant `message.id` | provider response | 同一次 provider assistant response；多个 content block envelope 可共享它 |
| `tool_use.id` / `tool_result.tool_use_id` | assistant block / user-role result block | 工具意图与结果配对键 |
| `sourceToolAssistantUUID` -> serialized `parentUuid` | query tool result / sessionStorage | 把本地 tool result 挂到产生该 tool use 的 assistant envelope |
| `session_id` / `parent_tool_use_id` | SDK event projection | 外部宿主会话与嵌套工具来源，不替代内部 UUID/parent chain |

`sessionStorage.insertMessageChain()` 在写 JSONL 时才补 `parentUuid`。普通消息沿当前 parent cursor 串联；tool-result user message若带 `sourceToolAssistantUUID`，持久化 parent 改为对应 assistant envelope；compact boundary 把物理 `parentUuid` 置空并保留 `logicalParentUuid`。

并行工具让结构更复杂：流式层可能为同一 provider `message.id` 的多个 content block创建不同 envelope UUID；不同 tool result 分别指向各自 assistant envelope。恢复代码承认这会形成 DAG，并用 response ID、parent edge 与 tool result index 补回单 parent walk 会遗漏的 sibling。

## 9. role 不是领域类型

`tool_result` 位于 user role content block 中，但它不是人类输入。`messagePredicates.ts:isHumanTurn()` 至少用 `type === 'user' && !isMeta && toolUseResult === undefined` 排除常见 tool result。`processUserInput` 还能产生 attachment、system 和 progress。

所以统计用户轮次、生成标题、并发队列、UI 渲染和 API 投影不能只检查 `role === user` 或 `type === user`。Harness 应提供领域谓词，不让消费者各自发明近似判断。

## 10. progress、attachment 与 durable transcript 不是同义词

当前直接代码显示：

- QueryEngine 会把 progress 和 attachment push 到内存 owner；
- progress 可被投影为 SDK 事件；attachment 可参与后续本地或模型投影；
- `isLoggableMessage()` 明确过滤 progress；`isTranscriptMessage()` 也把 progress 排除在当前加载联合之外；
- loader 为旧 JSONL 中曾参与 parent chain 的 progress 建立 bridge，避免恢复链截断；
- external transcript 默认还会过滤多数 attachment，少数受用户类型或开关影响。

`recordTranscript()` 邻近注释仍有“progress 写入 JSONL、但不被作为 parent”的旧表述，与 `cleanMessagesForLogging()` 的实际 filter 不一致。教材应以调用链为准，并把该注释冲突交给事实闸门核验。

## 11. 工具配对属于协议不变量

`query.ts` 产生 tool result 时使用：

```text
tool_result.tool_use_id = tool_use.id
sourceToolAssistantUUID = assistant envelope uuid
```

两者服务不同关系：前者满足模型协议，后者服务本地持久化拓扑。

进入真实 API 前，`normalizeMessagesForAPI()` 过滤/归并内部消息，`ensureToolResultPairing()` 再处理缺失、孤儿和重复 tool use/result。strict gate 可直接抛错；非 strict 路径会插入合成错误 result或删除孤儿。完整算法属于 M13，本单元只保留不变量：每个发送给 provider 的 client tool use ID 必须唯一，并与紧邻合法 user tool result 集合匹配；修复后的合成内容不能冒充真实工具执行结果。

## 12. 失败与实验假设

### 实验 A：数组 view

假设：数组 spread 隔离后续 append，但共享 envelope 对象。反证条件：owner append 改变旧 view 长度，或 element mutation 在旧 view 不可见。

### 实验 B：两个 writer

假设：两个 writer 从同一 revision 读取后各自 replace，会出现 lost update；显式 expected revision 能拒绝 stale commit。反证条件：无协调 replace 仍能稳定保留两次更新。

### 实验 C：身份误用

假设：envelope UUID、provider response ID、tool use ID 和 parent edge 不能互换；用 response ID 当 envelope key 会覆盖同 response 的多个 block。反证条件：混用后仍能唯一恢复并配对并行工具。

### 实验 D：配对与 ephemeral 边界

假设：重复/missing/orphan tool result必须在请求前失败或显式修复；progress 不能成为 durable parent。反证条件：错误 pairing 仍满足 validator，或移除 progress 后 durable chain 截断。

## 13. Harness 候选契约

H2-in-progress 新增 `ConversationStore` 与消息协议：

- 单一 store owner 持有 current immutable envelope list 与 monotonic revision；
- `snapshot()` 返回带 source revision 的 immutable request view；
- append/replace 需要 expected revision，stale writer显式失败；
- envelope ID 全局唯一，provider response ID、tool use ID、parent ID 使用不同 branded concepts；
- human input 与 tool result是不同 domain kind，即使 provider role 都是 user；
- durable messages 与 ephemeral progress分离；
- tool result只解析已登记且未完成的 tool use，重复/孤儿/missing result显式失败；
- store publication 深复制/冻结嵌套 payload，避免浅快照别名修改；
- trace 记录 revision、operation、message IDs 和 rejection reason，不记录私有 prompt正文。

待事实闸门确认后再决定 `merge/defer/reject`。

## 14. 事实闸门范围

FACT_A 必须独立核验：owner、浅快照、stream mutation、身份层、role/domain kind、progress/attachment persistence、pairing、并行工具恢复，以及缺失类型文件造成的证据边界。FACT_B 对照本工作簿与实验契约，只处理影响事实、实验或 Harness 的实质问题。
