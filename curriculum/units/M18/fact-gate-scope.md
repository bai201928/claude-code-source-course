# M18 事实闸门范围

请独立核验当前 Claude Code CLI 源码快照中，CLAUDE.md、`.claude/rules`、default/custom/append system prompt、nested rules 和动态 attachments 怎样进入一次模型请求。

重点回答：

1. Managed/User/Project/Local 指令的发现顺序、setting source、root-to-CWD 与 additional-dir 边界；
2. `processMemoryFile()` 的 parent/include 实际输出顺序、symlink/cycle/depth/dedupe、内容变换与 external include trust；
3. unconditional/conditional rules 的目录遍历、frontmatter glob、relative base、target scope 与顺序保证；
4. `getUserContext()`、`fetchSystemPromptParts()`、QueryEngine assembly 中 CLAUDE.md/default/custom/append/systemContext 的真实位置；
5. system prompt section memoization、uncached section、`/clear`/`/compact` reset 与 cache prefix；
6. nested trigger 如何由 @mention/read path 产生，allowed path、三阶段 directory traversal、loaded set/read cache 去重；
7. transformed content 为何保存 raw bytes 与 `isPartialView`，它怎样影响后续 Edit/Write safety；
8. `getAttachments()` 的 user-first dependency、thread/main grouping、timeout、error isolation 和 deterministic output order；
9. Attachment -> internal message -> `normalizeAttachmentForAPI()` 的投影，为什么它不等同于 durable instruction owner；
10. InstructionsLoaded hook 的时点、reason、fire-and-forget 与失败边界；
11. bare/disable、custom prompt、subagent 与 compact reload 的差异；
12. 哪些 feature implementation 缺失或只能确认接口，不能补造。

只报告影响教材事实、实验或 H3-3 契约的实质问题。

## 源码根目录

`D:\agent\Claude code最新\claude-code-CLI`

## 优先路径

- `src/utils/claudemd.ts`
- `src/context.ts`
- `src/utils/queryContext.ts`
- `src/constants/prompts.ts`
- `src/constants/systemPromptSections.ts`
- `src/QueryEngine.ts`
- `src/query.ts`
- `src/utils/attachments.ts`
- `src/utils/messages.ts`
- `src/utils/hooks.ts`
- settings/trust/read/edit 边界的直接调用点

不要读取 M18 工作簿、Graphify、其他教材或历史审查。不要修改文件。
