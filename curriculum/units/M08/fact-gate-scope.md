# M08 事实闸门中性范围

## 审查目标

独立重建当前 Claude Code CLI 快照中“能力如何被发现、投影给模型并在本地执行”的最小机制，回答：

1. builtin plugin/skill、directory skill、command、agent、plugin 和 MCP 在启动时按什么顺序被发现；
2. command/skill/agent 的来源合并、同名覆盖、availability 和 model-invocable 过滤如何工作；
3. base tools、MCP tools、permission deny、mode、`isEnabled()` 与同名去重怎样形成 runtime tool pool；
4. Interactive 的 MCP 异步连接是否阻塞首轮，以及工具在一次 Tool Loop 的什么边界刷新；
5. Headless 是按用户 command、按 `ask()` 还是按内部模型迭代刷新工具；
6. default/custom/agent/coordinator/override/append system prompt 的优先级和替换语义；
7. system context、user context、CLAUDE.md、tool schema 与动态 attachment 分别怎样进入 API 请求；
8. Tool Search/deferred/discovered tools 如何使 runtime pool 与实际发送 schema 不同；
9. tool schema 与 system-prompt section 的缓存边界是什么；
10. plugin 安装、cache-only load、needsRefresh 与 `refreshActivePlugins()` 是否代表不同状态；
11. 哪些错误会造成“模型可见能力”和“本地可执行能力”分叉，并应进入 clean-room Harness 契约。

## 源码根目录

```text
D:\agent\Claude code最新\claude-code-CLI
```

只读。禁止修改、格式化或向该目录生成缓存。

## 建议优先阅读

- `src/main.tsx`
  - `initBuiltinPlugins/initBundledSkills`
  - `setup/getCommands/getAgentDefinitionsWithOverrides` 的相对时序
  - MCP prefetch 与 Interactive/Headless 分支
  - `initializeVersionedPlugins`
- `src/commands.ts`
  - `getSkills`
  - `loadAllCommands`
  - `getCommands`
  - `getSkillToolCommands`
- `src/tools/SkillTool/prompt.ts`
- `src/tools/AgentTool/loadAgentsDir.ts`
  - `getActiveAgentsFromList`
  - `getAgentDefinitionsWithOverrides`
  - MCP requirement helpers
- `src/tools/AgentTool/AgentTool.tsx`
  - `prompt`
  - `call`
- `src/tools.ts`
  - `getAllBaseTools`
  - `getTools`
  - `assembleToolPool`
- `src/services/mcp/useManageMCPConnections.ts`
- `src/screens/REPL.tsx:getToolUseContext`
- `src/query.ts` 中下一模型迭代前的工具刷新
- `src/cli/print.ts`
  - `buildAllTools`
  - `drainCommandQueue`
  - `ask()` 参数
- `src/QueryEngine.ts`
  - `QueryEngineConfig`
  - `submitMessage`
  - `ProcessUserInputContext` 装配
- `src/utils/queryContext.ts:fetchSystemPromptParts`
- `src/utils/systemPrompt.ts:buildEffectiveSystemPrompt`
- `src/constants/prompts.ts`
- `src/constants/systemPromptSections.ts`
- `src/context.ts`
- `src/utils/api.ts`
  - `appendSystemContext`
  - `prependUserContext`
  - `toolToAPISchema`
- `src/services/api/claude.ts` 的 Tool Search、filtered tools、schema 与 message normalization
- `src/utils/toolSchemaCache.ts`
- `src/utils/attachments.ts`
- `src/utils/toolSearch.ts`
- `src/utils/mcpInstructionsDelta.ts`
- `src/utils/plugins/pluginLoader.ts:loadAllPluginsCacheOnly`
- `src/utils/plugins/installedPluginsManager.ts:initializeVersionedPlugins`
- `src/utils/plugins/refresh.ts:refreshActivePlugins`
- `src/commands/reload-plugins/reload-plugins.ts`

## 审查边界

- 当前源码快照是内部实现事实的最高证据。
- 不读取 Graphify 输出，不把结构邻接当运行链。
- 不读取 M08 `unit-workbook.md`、实验、草稿、实现或历史审查。
- 不要求展开完整 Permission、MCP wire protocol、Plugin marketplace、Agent execution、消息持久化或生命周期清理。
- 不要求重构 Claude Code 源码。
- 只报告会影响事实正确性、请求投影、刷新边界、实验有效性、初学者心智模型或 Harness fail-closed 契约的问题。

