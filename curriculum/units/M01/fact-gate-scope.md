# M01 事实闸门中性范围

## 审查目标

独立研究当前静态源码快照，判断 TypeScript 类型在 Message、Tool 和 Task 三类边界上实际约束了什么、没有约束什么。重点核验教材能否从类型反推合法值和分支，同时避免把编译期约束夸大成运行校验或状态机。

## 源码根目录

```text
D:\agent\Claude code最新\claude-code-CLI
```

该目录来自发布包 source map 的静态分析快照。不要修改任何文件，不要假定它可构建；若类型声明或构建元数据缺失，应把缺失本身写入证据边界。

## 需要回答的问题

1. `src/Task.ts` 中 `TaskType`、`TaskStatus`、`TaskStateBase`、`Task` 与 `isTerminalTaskStatus()` 分别约束什么？它们是否定义完整状态迁移？
2. `src/utils/tasks.ts` 的同名 `TaskStatus` 表示什么领域？它与 `Task.ts` 的值域、运行时校验方式和语义有什么差异？
3. `src/Tool.ts` 中 `Tool<Input, Output, P>` 的三个类型参数怎样贯穿 call、result、progress、schema 与能力判断？
4. `Tools = readonly Tool[]`、可选字段、`ToolDef`、`BuiltTool` 与 `buildTool()` 分别提供何种编译期或运行时保证？
5. 当前快照是否存在 `src/types/message.ts` 与 `src/types/utils.ts`？若缺失，能从哪些消息生产者、类型守卫、switch 消费者确认哪些最小事实，哪些不能确认？
6. 选择真实的 type predicate、判别收窄和 `satisfies never` 使用点，说明它们怎样影响分支安全。
7. type-only import、type assertion、Zod schema、字符串联合和迁移函数的运行时差异是什么？
8. 哪些表述因快照不完整或无法执行原项目 typecheck 而必须保留边界？

## 建议优先阅读

- `src/Task.ts`
- `src/utils/tasks.ts`：`TASK_STATUSES`、`TaskStatusSchema`、`TaskSchema`
- `src/Tool.ts`：`Tool`、`ToolResult`、`Tools`、`ToolDef`、`BuiltTool`、`buildTool`
- `src/utils/messages.ts`：消息构造器、type predicate、`normalizeMessages`、`satisfies never`
- `src/components/Message.tsx`：`Props.message` 与 `switch (message.type)`
- `src/services/tools/toolExecution.ts`：Tool 泛型与结果的使用点

## 输出限制

- 禁止读取 Graphify 输出、M01 作者工作簿、教材草稿或历史结论。
- 不评价教学风格，不修改文件，不尝试补造缺失声明。
- 只报告会影响类型事实、实验设计或 H0 契约的实质问题。
- 每个结论给出路径、符号与决定性代码；区分直接确认、合理推断和无法确认。

