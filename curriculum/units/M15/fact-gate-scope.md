# M15 事实闸门 A 范围

## 机制

研究 Claude Code CLI 当前源码快照中，一个或多个完整 `tool_use` block 怎样进入 streaming/non-streaming 调度，经过输入验证、PreToolUse、权限、tool call、结果映射、PostToolUse/Failure、取消收敛，成为配对 `tool_result` 并触发下一轮 Query。

## 源码根目录

`D:\agent\Claude code最新\claude-code-CLI`

## 优先路径

- `src/query.ts`：`queryLoop()` 中 tool block 收集、streaming executor、abort drain、tool updates、next state；
- `src/services/tools/StreamingToolExecutor.ts`；
- `src/services/tools/toolOrchestration.ts`；
- `src/services/tools/toolExecution.ts`：`runToolUse()` 与 permission/call/result/failure；
- `src/Tool.ts`：`Tool`、`ToolUseContext`、`isConcurrencySafe`、`interruptBehavior`；
- `src/hooks/useCanUseTool.tsx` 仅用于确认 permission adapter 边界。

## 必答问题

1. Query Loop 如何判断需要工具 follow-up，是否依赖 stop reason？
2. streaming 与 response-complete 调度分别何时启动，怎样分类并发安全与 exclusive 工具？
3. progress、final result 和 context modifier 怎样传播，顺序有何保证？
4. lookup、schema、semantic validation、PreToolUse、permission、call、PostToolUse 的真实顺序是什么？input 可以在哪些节点被替换？
5. unknown、invalid、denied、hook stop、throw、abort 是否都形成配对结果？
6. Bash sibling failure、普通工具失败、user interrupt、stream fallback 的取消语义有何区别？
7. 下一轮 messages 和 ToolUseContext 怎样构造，何时终止而不再请求模型？
8. 哪些关键结论无法从当前快照确认？

只报告影响教材事实、实验或 Harness 契约的问题。不要审查格式、提示词或 Graphify。不得修改任何文件。
