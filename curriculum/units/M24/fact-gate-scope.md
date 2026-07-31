# M24 事实闸门范围

独立核验当前 Claude Code CLI 快照中 Transcript 写入/重建、Resume/Fork、interrupted turn 与后台 Agent 恢复的真实语义。源码根：`D:\agent\Claude code最新\claude-code-CLI`。

必须回答：

1. `Project` 何时物化 session file，`recordTranscript/appendEntry/enqueueWrite/flush` 各自等待到哪个边界；进程退出前哪些路径显式 flush；
2. 主 Transcript 与 local agent sidechain 的 UUID dedupe 为什么不同，错误共享 dedupe set 会怎样破坏 parent chain；
3. `parseJSONL/readJSONLFile/loadTranscriptFile` 面对坏行、半写尾行、读失败、大文件 compact boundary 时做什么，哪些错误会被静默降级；
4. JSONL 为何形成 DAG；leaf 如何选择；cycle、dangling parent、parallel assistant/tool_result sibling、compact preserved segment 与 Snip 在读侧怎样处理；
5. unresolved tool use、orphan thinking、whitespace assistant 如何过滤；completed、interrupted prompt、interrupted turn 和 terminal tool_result 如何区分；
6. normal resume 如何复用 session/file，fork 如何隔离 session/worktree 并 seed content replacement；恢复分别接管哪些 metadata、cost、file history、todo、agent、context collapse 状态；
7. Headless auto-resume 怎样删除 synthetic pair 并重新入队；它是否能保证外部工具副作用 exactly-once；
8. `resumeAgentBackground` 从 sidechain/metadata 重建什么，新 live Runtime Task 和 AbortController 如何产生；旧外部副作用状态是否可由 Transcript 确认。

优先入口：

- `src/utils/sessionStorage.ts`
- `src/utils/json.ts`
- `src/utils/conversationRecovery.ts`
- `src/utils/sessionRestore.ts`
- `src/QueryEngine.ts`
- `src/cli/print.ts`
- `src/commands/branch/branch.ts`
- `src/utils/messages.ts`
- `src/utils/toolResultStorage.ts`
- `src/tools/AgentTool/resumeAgent.ts`
- `src/tools/AgentTool/runAgent.ts`
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx`

可定向读取相关 types/tests/callers。不要读取 Graphify、M24 工作簿、Codex 结论、Harness、草稿、其他单元或历史聊天；只读，不修改文件。

只报告会改变 durability、chain reconstruction、tool pairing、interruption、fork isolation、状态 owner、后台恢复或 crash 副作用边界的问题。resume picker UI、文案、完整 metadata 枚举和无教学影响的兼容细节不算 Issue。
