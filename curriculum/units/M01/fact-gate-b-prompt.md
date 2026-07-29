# FACT_B 同会话对照提示词

继续刚才的 FACT_A 会话。现在请把阶段 A 的独立结论与下面 Codex 摘要和实验设计逐项对照。只在发现明确冲突时定向回读源码。

## Codex 机制摘要

### Task

`src/Task.ts` 的 `TaskStatus = pending | running | completed | failed | killed` 约束单个字段值；`isTerminalTaskStatus()` 解释三个终态。`TaskStateBase` 不是按 task type 分支的判别联合，因此不定义 type/status 合法组合，也不阻止 `completed -> running`。

`src/utils/tasks.ts` 的协作任务清单另有 `TaskStatus = pending | in_progress | completed`，来自 `z.enum()`。同名不表示同一领域；import path、值域和运行 schema 都不同。schema 验证值形状，仍不定义迁移。

补充边界：`getTask()` 只在 `process.env.USER_TYPE === 'ant'` 时把旧状态映射到新枚举；其他环境的旧值无法通过当前 schema 并返回 `null`。这不是通用迁移规则，也不是本单元要推广的设计。

### Tool

`Tool<Input, Output, P>` 让 schema 推导的 Input 贯穿 call、description、并发/只读/危险/权限等方法，让 Output 进入 `ToolResult<Output>`，让 P 进入 progress callback。`Tools = readonly Tool[]` 是浅层编译期只读。

`ToolDef` 让默认方法在定义侧可选，`BuiltTool<D>` 描述默认填充后的静态形状，`buildTool()` 用运行时对象展开真正填值；二者需成对成立。

补充边界：`buildTool()` 最后以 `as BuiltTool<D>` 桥接运行对象与条件映射类型。它是需要核验实现与类型保持一致的信任点；当前快照不能构建，教材不会把注释所称的全工具 typecheck 当作本次独立验证。

### Message 与快照边界

当前目录实际缺少 `src/types/message.ts` 和 `src/types/utils.ts`，因此 Codex 不声称看到了完整 Message 声明或 DeepImmutable 定义。可见源码直接确认：消息构造器产生 user/assistant/progress，`normalizeMessages()` 按 assistant/attachment/progress/system/user 分支；`Message.tsx` 使用更窄渲染联合。结论限定为可见生产者与消费者，不推断全系统只有这些变体。

### 类型语义

type-only import、字符串联合、泛型、readonly、type predicate 和 `satisfies never` 只在编译期生效；Zod 或手写 parser 才在运行时检查 unknown；transition guard 才定义状态边。`as` 不是验证。

## 实验设计

TypeScript/Python clean-room H0：

- 判别联合 `HarnessMessage` 与穷尽分支；
- `RunState` 联合加独立 transition table；
- `Tool<Input, Output>` / Python Generic Protocol；
- `parseMessage()` 和 `validateInput()` 检查外部 unknown；
- 四个对称行为测试验证收窄、错误 JSON 拒绝、终态不能重启和工具输入运行校验；
- TypeScript 额外用 `tsc --strict --noEmit` 与 `@ts-expect-error` 验证错误变体和错误泛型输入确实被编译器拒绝。

## 审查要求

只检查事实错误、重要遗漏、证据不足、模块/领域混淆、编译期与运行时混淆、快照边界混淆，以及实验无法验证结论的问题。普通措辞和无现实影响的边缘问题不构成 Issue。

输出必须以以下三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后按 Issue 给出源码路径与符号、与 FACT_A 的对照、影响和最小修正。没有实质问题时明确写 `No material issues`。
