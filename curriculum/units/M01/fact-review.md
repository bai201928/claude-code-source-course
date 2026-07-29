# M01 事实闸门记录

状态：`fact-reviewed`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max，主审实际模型记录为 `deepseek-v4-pro[1m]`。

有效会话 ID：`90ae8d5f-3468-4958-b330-35213bf9ce78`

说明：首次会话因从 `review-workspace` 启动而产生 7 次读取权限拒绝，没有形成有效 FACT_A 结论，已保留为 `fact-a-invalid-permissions.json`，不进入事实证据。有效会话从项目根目录重新启动，无权限拒绝，进程均自然退出且未设置 CLI 应用层超时。

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 5
```

独立盲审确认五个必须显式处理的边界：

1. `src/Task.ts` 与 `src/utils/tasks.ts` 各自定义不兼容的 `Task`/`TaskStatus`，必须用路径和领域区分。
2. `isTerminalTaskStatus()` 只是终态谓词，不编码或阻止迁移。
3. 快照缺少 `src/types/message.ts`、`src/types/utils.ts`、`src/types/tools.ts`，不能声称完整 Message、DeepImmutable 或进度联合形状。
4. `utils/tasks.ts:getTask()` 的旧状态迁移只在 `USER_TYPE === 'ant'` 时执行，其他环境的旧值不能通过当前 schema。
5. `buildTool()` 通过 `as BuiltTool<D>` 桥接运行对象与条件类型，是需要信任和核验的断言点；快照不可构建，不能把源码注释中的全工具 typecheck 当作本次验证。

## Codex 裁决

### M01-F01 两个 Task 领域同名

Decision: `accepted`

Reason: 同名且共享部分状态值，非常容易形成错误统一模型。

Change: 正文和工作簿始终使用 `Task.ts` 运行任务与 `utils/tasks.ts` 协作任务清单两个限定名称，并用图展示模块边界。

### M01-F02 终态谓词不是状态机

Decision: `accepted`

Reason: 这直接影响 H0 为何还需要 transition guard。

Change: 明确区分值域、终态分类和合法迁移三层，实验单独验证终态不可重启。

### M01-F03 缺失声明限制 Message 结论

Decision: `accepted`

Reason: 最高需求要求源码级事实诚实，不能用 import 名称或消费者分支补造完整声明。

Change: 只写可见生产者、类型守卫和消费者能确认的最小事实，完整变体和 DeepImmutable 递归语义标为无法确认。

### M01-F04 ant 条件迁移

Decision: `accepted`

Reason: 若提到旧状态兼容而省略环境守卫，会把局部迁移误教成通用机制。

Change: 将其作为 schema 前兼容分支的边界案例，并明确非 ant 环境行为；不把它扩展为课程 Harness 设计。

### M01-F05 buildTool 类型断言信任点

Decision: `accepted`

Reason: `as` 不提供运行验证，这正是本单元核心区分。

Change: 正文同时展示类型层 `BuiltTool<D>`、运行层对象展开和结尾断言，不声称当前快照通过了原项目 typecheck。

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同会话对照确认：

- 五个 FACT_A 问题全部被修订摘要与实验边界吸收；
- H0 的判别联合、transition table、Tool 泛型和 runtime parser 是合理 clean-room 迁移，没有冒充快照实现；
- TypeScript `tsc --strict --noEmit` 与双语言运行测试能分别验证静态和运行主张；
- 未发现事实错误、关键遗漏、领域混淆或不可验证的实验结论。

结论：进入教材编写和教学审查阶段。
