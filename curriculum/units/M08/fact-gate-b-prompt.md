# M08 FACT_B 同会话对照提示词

继续刚才的 FACT_A 会话。请把阶段 A 独立结论与下面 Codex 机制摘要和 clean-room 候选契约逐项对照。不要重新扩散阅读整个源码树；只有发现明确冲突时，才回到相关路径和符号定向核验。

## Codex 机制摘要

### 不是一张永久启动快照

`main.tsx` 在启动 memoized `getCommands/getAgentDefinitionsWithOverrides` 前同步注册 builtin plugins 与 bundled skills，避免 command discovery 缓存空列表。随后 setup、command discovery 和 agent discovery 可以并行；MCP 连接继续异步推进。

启动得到初始发现目录，不是整个 session 永久冻结的能力列表。

### Command、Skill 与 Agent

`loadAllCommands()` 合并 bundled skill、builtin-plugin skill、directory skill、workflow command、plugin command、plugin skill 和 built-in command，但 base list 不统一去重。`findCommand()` 的 direct lookup 是先出现者胜出，遍历全数组的消费者可能仍看见同名条目；dynamic skill 加入和部分 attachment 路径各自去重。`getCommands()` 每次重新判断 availability/`isEnabled()` 并加入 dynamic skill；`getSkillToolCommands()` 只投影允许模型调用的 prompt command metadata，但本身不建立全局唯一 active command。存在、被发现、启用、列给模型和完整 Skill 内容已加载不是同一状态。

Agent definition 按 built-in、plugin、user、project、flag、managed 的后写覆盖得到 active definition。模型 listing 与执行阶段还会分别受 required MCP、permission 与 allowed agent types 约束。

### Runtime tool pool

`getAllBaseTools()` 是环境相关候选；`getTools()` 应用 simple/bare、特殊工具、deny、REPL mode 与 `isEnabled()`；`assembleToolPool()` 过滤 MCP deny、分别排序、按 name 去重并让 built-in 同名优先。

这个 pool 是当前本地运行候选，不等于 API 实际发送 schema。

### Interactive MCP 与刷新

Interactive 不等待所有 MCP server 才渲染或发送首轮。`useManageMCPConnections()` 将 clients/tools/commands/resources 异步写入 AppState。

REPL `getToolUseContext()` 创建时用 fresh store state 计算 `options.tools`，同时注入 `refreshTools: computeTools`。`query.ts` 在 tool results 完成、准备下一次模型递归前调用 refresh。因此一个进行中的模型 API 流使用稳定工具视图；新 MCP 工具可在同一用户 Tool Loop 的下一模型迭代出现。

### Headless 刷新边界

`print.ts:drainCommandQueue` 对每个排队 command 重新读取 AppState 并调用 `buildAllTools()`，所以晚连接 MCP 可在下一次 `ask()` 可见。

`QueryEngineConfig` 接收具体 tools/commands/mcpClients；`submitMessage()` 构造的 context 没有 Interactive `refreshTools` callback。因此单个 `ask()/submitMessage()` 内部 Tool Loop 通常保持传入工具集合，下一排队 command 才重建。若源码存在能在同一 submit 中改变该集合的其他决定性路径，请列为冲突。

### Prompt 与上下文位置

`fetchSystemPromptParts()` 在 custom prompt 未提供时构造 default prompt 与 system context，并始终获取 user context；custom prompt 会同时跳过 default 和 system context，这是当前明确行为。

Interactive 的 `buildEffectiveSystemPrompt()` 优先级是 override、coordinator、main-thread agent、custom、default，再按规则追加 append prompt；Proactive agent prompt 是特殊 append 分支。Headless/SDK `QueryEngine.submitMessage()` 不调用该 builder，而是直接组装 custom/default、可选 memory mechanics 与 append。因此不能把 Interactive 的 coordinator/agent/override 规则外推到 Headless。

`systemPrompt + systemContext` 进入 API system prompt；`userContext`（包括当前快照中的 CLAUDE.md 等）由 `prependUserContext()` 变成 meta user message。动态能力变化还可作为 transcript attachment 进入模型上下文。

### API projection 与缓存

`claude.ts` 按模型、模式、阈值和消息历史决定 Tool Search，筛出 deferred/discovered tools，再把 `filteredTools` 转成 schema，并按该列表 normalization messages。因此 executable/runtime pool 可以大于当前请求实际发送 schema。

`toolToAPISchema()` 缓存 session-stable base schema（name、description、input schema、strict/eager fields），`defer_loading` 和 cache control 是每请求 overlay。带 `inputJSONSchema` 的 cache key 包含序列化 schema，因此 input schema 改变会换 key；同名且 schema key 不变时的 description/base 渲染变化仍保持首次值。`systemPromptSection()` 缓存到 clear/compact，`DANGEROUS_uncachedSystemPromptSection()` 每轮重算。

`deferred_tools_delta`、`agent_listing_delta`、`mcp_instructions_delta`、`skill_discovery` 是 model-visible attachment，不自动证明 handler 注册或 permission allow。

### Plugin 状态

Interactive 启动消费者主要使用 `loadAllPluginsCacheOnly()`，不为启动 clone/fetch。`initializeVersionedPlugins()` 的安装 bookkeeping 在 Headless 等待，在 Interactive 通常 fire-and-forget；背景物化可设置 `needsRefresh`，不代表当前会话所有组件已激活。

`refreshActivePlugins()` 才执行完整激活：清 caches、full load、重载 commands/agents、写 AppState、递增 MCP reconnect key、重载 hooks 和 LSP。

## clean-room 候选契约

TypeScript/Python 对称实现以下五层：

- `CapabilityCatalog`：发现结果、source、revision 和显式同名 priority 解析；这比源码 command 消费者各自解析更严格；
- `CapabilityProjector`：按 mode/policy/provider/model/deferral 产生视图；
- `CapabilitySnapshot`：一个 request/iteration 的不可变 projection；
- `ExecutableRegistry`：本地 handler 注册与 fail-closed dispatch；
- `SystemContextBuilder`：显式 default/replace/append 和 channel placement。

必须验证：

- discovery != visibility != permission != executable；
- catalog revision 2 不修改 revision 1 snapshot；
- refresh 只在显式 boundary 创建新 snapshot；
- deferred tool 可已注册但暂不发送 schema，discover 后才进入；
- model-visible 但未注册的工具 dispatch 必须 fail closed；
- prompt replacement 与 append 不是同一操作；
- source、revision、projection reason 可观察。

这些类型名与分层属于 Harness 设计迁移，不冒充 Claude Code 当前公开 API。实验不导入或修改 Claude Code 源码。

## 审查要求

只检查事实错误、重要遗漏、证据不足、发现/投影/权限/执行混淆，以及实验不能验证正文结论的问题。普通措辞偏好、对专有源码重构的建议、完整权限/MCP/Plugin/Agent/Transcript/退出机制和不会影响学习/Harness 的边缘问题不构成 Issue。

输出必须以以下三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后按 Issue 列出源码路径与符号、与 FACT_A 的对照、为什么影响教材或 Harness、应接受的修正或定向验证。没有实质问题时明确写 `No material issues`。
