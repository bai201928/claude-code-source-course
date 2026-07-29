# M01 研究工作簿

状态：`final`

本文件是作者工作区，不是教材正文。Graphify 只用于候选定位；下面的机制结论已经回到当前 `claude-code-CLI/` 静态快照核验。

## 1. 单元问题、边界与风险

核心问题：面对一个 1902 文件的 Agent 系统，学习者怎样先从 TypeScript 类型读出合法值、组件契约和分支入口，再进入函数体，而不是把类型当作可以跳过的注释？

本单元系统讲清：

- 字面量联合、对象联合、判别字段和控制流收窄；
- 类型谓词、`never` 穷尽检查、`as const`、`satisfies`；
- 泛型怎样把 Tool 输入、输出和进度关联起来；
- 可选、`readonly`、结构类型和 type-only import 的真实边界；
- 编译期类型、运行时 schema、状态转移规则是三种不同约束；
- 声明文件缺失时，怎样从生产者、消费者和校验器交叉重建最小契约。

不在 M01 展开的内容：Promise/AsyncGenerator（M02）、事件循环/取消（M03）、真实消息所有权与生命周期（M10-M11）、Tool 执行与权限（M15/M21-M23）、Task 子系统运行机制（M28 以后）。

风险：`R1`。主要风险不是运行行为复杂，而是把类型能证明的范围夸大成完整运行保证。

## 2. Graphify 候选与直接核验

Graphify 候选把 `TaskStatus`、`Tool`、`Message`、`query.ts`、`utils/messages.ts` 和 `REPL.tsx` 拉到同一邻域。这个结果只说明值得检查，不说明它们共享一个类型或一条调用链。

直接核验后选择四组锚点：

1. `src/Task.ts`：运行任务的 `TaskType`、`TaskStatus`、`TaskStateBase`、`Task` 与 `isTerminalTaskStatus()`。
2. `src/utils/tasks.ts`：协作任务清单的另一组 `TaskStatus`，由 `z.enum()` 生成运行时 schema。
3. `src/Tool.ts`：`Tool<Input, Output, P>`、`ToolResult<Output>`、`Tools`、`ToolDef`、`BuiltTool` 与 `buildTool()`。
4. `src/utils/messages.ts`、`src/components/Message.tsx`：消息构造器、类型守卫、按 `type` 分支的正规化和渲染消费者。

## 3. Task：联合先约束值域，不自动约束状态机

`src/Task.ts` 直接定义：

```text
TaskType = local_bash | local_agent | remote_agent | in_process_teammate |
           local_workflow | monitor_mcp | dream

TaskStatus = pending | running | completed | failed | killed
```

`isTerminalTaskStatus()` 把 `completed/failed/killed` 解释为终态。该函数是运行逻辑，不是联合类型自动推导的迁移规则。

`TaskStateBase` 同时持有 `type: TaskType` 与 `status: TaskStatus`，但它不是按 `type` 分支的判别联合，因此编译器不会阻止任何 type/status 组合，也不会阻止 `completed -> running`。结论：联合只限定单个字段可能取哪些值，合法迁移仍需函数、状态机或测试。

## 4. 同名 TaskStatus：模块路径属于类型身份的一部分

`src/utils/tasks.ts` 还有另一套：

```text
TASK_STATUSES = pending | in_progress | completed
TaskStatusSchema = z.enum(pending, in_progress, completed)
TaskStatus = z.infer<typeof TaskStatusSchema>
```

它表示团队协作任务清单，不是 `Task.ts` 的运行任务生命周期。两者都叫 `TaskStatus`，值域与语义均不同。读取使用点时必须同时记录 import path；Graphify 邻近或名称相同不能合并领域。

`z.enum()` 同时给出运行时验证器，`z.infer` 从它派生编译期类型。这比只写字符串联合多了一层外部输入防线，但仍没有定义允许的状态迁移。

`getTask()` 还有一个不能泛化的兼容分支：只有 `process.env.USER_TYPE === 'ant'` 时，才会在 Zod 解析前把旧状态 `open/resolved/planning/implementing/reviewing/verifying` 映射为当前枚举；其他环境中的旧状态无法通过 schema，并被读取路径返回为 `null`。这是受环境保护的历史迁移，不是 TaskStatus 自带能力。

## 5. Tool：泛型把多个位置绑成一个协议

`src/Tool.ts` 的 `Tool<Input, Output, P>` 不是三个独立注释：

- `Input` 同时决定 `call(args)`、`description(input)`、并发/只读/危险判断、权限检查等输入形状；
- `Output` 进入 `Promise<ToolResult<Output>>`，继续约束工具结果数据；
- `P` 进入 `ToolCallProgress<P>`，约束进度事件。

`Input extends AnyObject` 又把输入限定到 Zod object schema；`z.infer<Input>` 才是执行函数看见的值类型。这里体现“schema 是运行时边界，泛型是内部静态传播”。

`Tools = readonly Tool[]` 只阻止通过这个引用增删数组，不深冻结 Tool 对象，也不会在 JavaScript 运行时自动抛错。`readonly` 是编译期能力边界。

`ToolDef` 通过 `Omit + Partial<Pick<...>>` 允许定义侧省略默认方法，`BuiltTool<D>` 用映射类型表达默认值合并后的完整形状，`buildTool()` 再在运行时执行对象展开。静态类型和运行实现必须成对阅读。

`buildTool()` 最终用 `as BuiltTool<D>` 桥接运行对象与复杂条件类型，因此这里仍是信任点。源码注释称 60 多个工具经过零错误 typecheck，但当前快照不可构建，本单元不能把该注释升级为独立运行验证。

## 6. Message：声明缺失时只做有边界的重建

当前快照包含 1902 个源码文件，但 `src/types/message.ts` 与 `src/types/utils.ts` 实际缺失；很多文件保留了对它们的 type-only import。这意味着不能声称已经阅读了 `Message` 的完整声明，也不能运行原项目类型检查。

可直接确认的生产者和消费者：

- `createAssistantMessage()` 返回 `type: 'assistant'`；
- `createUserMessage()` 返回 `type: 'user'`；
- `createProgressMessage()` 返回 `type: 'progress'`；
- `normalizeMessages()` 处理 `assistant/attachment/progress/system/user`；
- `Message.tsx` 的渲染输入是一个更窄的视图联合，处理 `attachment/assistant/user/system/grouped_tool_use/collapsed_read_search`，进度消息作为单独 lookup 输入。

结论不是“全系统只有这些消息”，而是：当前可见生产者/消费者以 `type` 字面量做判别，同一对象在不同流水线阶段可能使用不同的联合视图。教材必须标注证据边界。

## 7. 收窄、类型守卫和穷尽检查

已核验模式：

- `getLastAssistantMessage()` 的谓词 `(msg): msg is AssistantMessage => msg.type === 'assistant'` 让 `findLast()` 返回更窄类型；
- `normalizeMessages()` 在 `switch (message.type)` 后访问变体专属字段；
- `getPlanPhase4Section()` 的 `default: variant satisfies never` 让未来新增实验 variant 而未补分支时触发编译错误。

`satisfies` 检查表达式兼容目标类型但保留更精确的推断；`as` 则可能直接覆盖编译器判断。源码中必要的 `as` 要连同边界和理由阅读，不能把断言当验证。

## 8. 编译期、运行时、迁移规则三层约束

```text
TypeScript union/generic/readonly
-> 编辑器和 tsc 检查内部代码
-> 类型擦除后不存在

Zod / 手写 parser
-> 检查 JSON、工具输入、文件或网络数据
-> 运行时真实执行

transition function / state machine
-> 检查一个合法值是否能从当前值到达
-> 需要领域规则与测试
```

三者不能相互替代。`unknown` 是外部边界的诚实起点；先验证再收窄。`as TaskStatus` 或 `as Message` 只会让编译器闭嘴，不会改变输入对象。

## 9. 实验假设与反证条件

实验为 clean-room H0 契约，不复制快照实现。

- 假设 A：判别字段能让分支只访问当前变体字段。反证：错误字段组合可通过 `tsc`。
- 假设 B：类型擦除后外部未知输入仍需 parser。反证：错误 user 消息在运行时被接受。
- 假设 C：值域联合不等于状态机。反证：终态能重新进入 running。
- 假设 D：Tool 泛型关联内部调用，但外部 unknown 输入仍需运行校验。反证：错误 city 类型进入 execute。

TypeScript 同时跑 `node --experimental-strip-types` 行为测试与 `tsc --strict --noEmit` 静态测试；Python 跑对称 `unittest`，用 `Literal`、联合、Protocol 与 dataclass 表达同一契约，但承认 Python 默认运行时不执行 type hint。

## 10. Harness 候选契约

- `HarnessMessage`：判别联合，分支穷尽检查；
- `RunState`：判别联合描述状态载荷，独立 transition guard 描述合法边；
- `Tool<Input, Output>`：内部泛型关联；
- `parseMessage()` / `validateInput()`：外部数据运行校验；
- `assertNever()`：新增变体后的编译反馈；
- TypeScript/Python 共用四个行为断言。

初步裁决：`merge` 到 H0。原因是这些契约会被后续消息、Tool、Query、取消和恢复单元累计扩展；当前不接真实模型、持久化或并发。

## 11. 当前证据边界

- `Task.ts`、`utils/tasks.ts`、`Tool.ts` 和可见消息生产者/消费者属于 `快照事实`。
- 缺失 `types/message.ts` 与 `types/utils.ts` 是当前目录可观察事实；不能从 import 名称补写完整声明。
- 双语言代码结果属于 `运行验证`。
- H0 的 `kind` 命名、消息字段、transition table 和 validator 结构属于 `设计迁移`。
- Graphify 没有作为任何教材事实的最终证据。
