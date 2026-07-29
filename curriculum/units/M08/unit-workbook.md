# M08 研究工作簿：能力不是一张启动清单，发现目录、请求投影与执行注册表

状态：`release-candidate`

风险：`R2`

本文件是作者工作区，不是教材正文。Graphify 只用于候选定位；下面的运行关系、刷新边界和不变量均已回到当前 `claude-code-CLI/` 源码快照核验。

## 1. 标题与风险修正

设计包原题为“系统上下文、工具集合与扩展发现的启动快照”，风险为 R1。源码显示这两个表述都不够准确：

- 启动会发现一批 command、skill、agent、plugin 和 MCP 配置，但 MCP 连接会异步完成；
- Interactive 在一次 Tool Loop 的模型轮次之间可以刷新工具；
- Headless 在下一次排队命令前会重新装配工具，但一个 `QueryEngine.submitMessage()` 内通常保留传入工具集合；
- 系统提示既有会话级缓存段，也有每轮重算段和 transcript 中的 delta attachment；
- 插件的安装、缓存可见和当前会话激活不是同一个动作。

因此 M08 改为：

> 能力不是一张启动清单：发现目录、请求投影与执行注册表

风险上调为 R2，因为异步连接、缓存、权限、延迟 schema 和安全边界刷新会直接改变模型可见能力与本地实际执行能力的一致性。

## 2. 本单元要解决的问题

“系统有哪些能力”至少有五种不同答案：

```text
磁盘或内存中发现了什么
-> 当前 AppState/运行目录登记了什么
-> 当前请求允许向模型投影什么
-> API 实际发送了哪些 schema、instructions 与 metadata
-> 本地调度时能否找到处理器并通过权限检查
```

本单元要让学习者停止使用一张扁平 `tools[]` 解释所有层，转而回答：

1. 能力从哪些来源发现，谁决定同名覆盖与去重；
2. 发现、启用、模型可见、允许调用和可执行为何不是同义词；
3. 一个请求或模型迭代冻结什么，哪些变化只能在声明的边界生效；
4. system prompt、user context、system context、tool schema 和 attachment 分别进入哪里；
5. 插件安装、MCP 连接和工具搜索怎样改变当前或下一轮视图；
6. 企业 Harness 如何保证模型投影与执行注册表不会静默分叉。

## 3. 前置与边界

前置：

- M01 的对象、联合类型、Map/Set 与引用身份；
- M03 的异步任务、事件循环、取消与资源生命周期；
- M05 的 Interactive/Headless 双入口；
- M06 的配置来源、策略、信任和 revision；
- M07 的 Bootstrap、AppState、request snapshot 与 fresh read。

本单元闭合：

- command、skill、agent、plugin、MCP 和 builtin tool 的发现与装配；
- system prompt 的 replace/append/default 优先级；
- user context、system context 与动态 attachment 的请求位置；
- runtime tool pool、model-visible schema 与 executable registry 的区别；
- Interactive/Headless 的刷新边界；
- clean-room `CapabilityCatalog / CapabilityProjector / CapabilitySnapshot / ExecutableRegistry / SystemContextBuilder`。

不提前展开：

- M09 的完整退出和 cleanup；
- M10 的消息 owner、配对和 transcript；
- M12 的 Query Loop 依赖注入全貌；
- M14/M15 的权限决策全过程；
- 后续 Skill、MCP、Plugin、Agent 单元的内部协议和生命周期细节。

## 4. Graphify 候选与直接核验

Graphify 查询使用图谱已有词汇：

```text
system prompt tools agents mcp plugin skill capability discovery metadata bootstrap instructions
```

图谱命中 `main.tsx`、`REPL.tsx`、`print.ts`、`QueryEngine.ts`、`query.ts`、`tools.ts`、`context.ts`、`constants/prompts.ts`、`commands.ts`、`loadAgentsDir.ts` 以及 MCP/Plugin loader。它只提供候选地图。

直接核验发现：图上邻近的“plugin install”和“当前会话能力可见”并不等价；`refreshActivePlugins()` 才是显式激活边界。类似地，MCP client 连接、模型收到 schema、调度器持有 handler 也不是一个状态。

## 5. 源码地图

| 机制 | 决定性位置 | 本单元使用的语义 |
| --- | --- | --- |
| 启动发现顺序 | `src/main.tsx` 的 `setup()` 前后 | builtin 注册先于 memoized command/agent discovery |
| Command/Skill 合并 | `src/commands.ts:getSkills/loadAllCommands/getCommands/getSkillToolCommands` | 多来源、动态过滤、model-invocable metadata |
| Agent 合并 | `src/tools/AgentTool/loadAgentsDir.ts` | source precedence 与 active definition |
| Agent 可见性 | `src/tools/AgentTool/AgentTool.tsx:prompt/call` | MCP、permission、allowed type 的二次过滤 |
| Base tool 与 MCP tool | `src/tools.ts:getAllBaseTools/getTools/assembleToolPool` | 环境、deny、isEnabled、排序、同名去重 |
| MCP 异步更新 | `src/services/mcp/useManageMCPConnections.ts` | clients/tools/commands/resources 分批写 AppState |
| Interactive 请求边界 | `src/screens/REPL.tsx:getToolUseContext` | fresh store read、初始 tools、`refreshTools` |
| Tool Loop 刷新 | `src/query.ts:queryLoop` | tool result 后、下一次模型调用前刷新 |
| Headless 工具装配 | `src/cli/print.ts:buildAllTools/drainCommandQueue` | 每个排队命令 fresh build |
| Headless 单次查询 | `src/QueryEngine.ts:QueryEngineConfig/submitMessage` | config tools 进入本次 submit，无 refresh callback |
| Prompt 组成 | `src/utils/queryContext.ts`, `src/utils/systemPrompt.ts` | default/custom/agent/coordinator/override/append |
| 上下文位置 | `src/query.ts`, `src/utils/api.ts` | systemContext 追加 system；userContext 前置 meta user |
| API tool 投影 | `src/services/api/claude.ts` | tool search、deferred/discovered、schema 过滤 |
| Schema cache | `src/utils/api.ts:toolToAPISchema`, `src/utils/toolSchemaCache.ts` | session-stable base 与 per-request overlay |
| 动态能力通知 | `src/utils/attachments.ts` 等 | deferred tool、agent、MCP instruction、skill delta |
| Plugin 激活 | `src/utils/plugins/refresh.ts:refreshActivePlugins` | 清 cache、重载组件、写 AppState、触发 MCP reconnect |

## 6. 启动发现不是最终冻结

`main.tsx` 在并行启动 `setup()`、`getCommands(cwd)` 和 `getAgentDefinitionsWithOverrides(cwd)` 前，先同步调用 `initBuiltinPlugins()` 与 `initBundledSkills()`。源码注释说明：若 bundled 注册晚于 `getCommands()`，memoize 可能把空列表缓存下来。

这说明初始化顺序本身就是语义：

```text
注册内存内 builtin/bundled 来源
-> 并行 setup + command discovery + agent discovery
-> 合并 CLI flag agent
-> 创建当前 AppState/运行上下文
-> MCP 连接继续异步推进
```

启动阶段得到的是“已知来源和初始目录”，不是一个永久不变的全能力快照。

证据状态：`快照事实`。

## 7. Command 与 Skill：发现内容和模型可见 metadata

`loadAllCommands()` 的合并顺序为：

```text
bundled skills
-> builtin-plugin skills
-> directory skills
-> workflow commands
-> plugin commands
-> plugin skills
-> built-in commands
```

`getCommands()` 每次调用会重新执行 availability 与 `isEnabled()` 判断，并加入 dynamic skills。昂贵的源加载被 memoize，不代表所有可见性判断也被冻结。

这里还有一个容易漏掉的解析边界：`loadAllCommands()` 只是按上述顺序拼接 base command，没有统一去重；`findCommand()` 用 `find()`，所以直接查找时先出现者胜出，而遍历整个数组的消费者仍可能看到同名条目。只有 dynamic skills 在加入 base list 时显式避开同名 base command，部分 attachment 路径也会自行 `uniqBy`。因此不能凭一张“全局 command 优先级表”推断所有消费者都得到相同结果；必须指出具体消费者的解析策略。clean-room Catalog 会采用显式 priority 和唯一 active definition，这是更严格的设计迁移。

`getSkillToolCommands()` 进一步筛出 prompt 类型、允许模型调用、非 builtin 且具有相应描述来源的条目。Agent 在列表中看到的通常是 name/description/when-to-use 等元数据；完整 Skill 指令在真正调用或发现后才进入上下文。

必须分开：

```text
磁盘中存在 SKILL.md
!= 被 loader 发现
!= 当前 command list 启用
!= model-invocable listing
!= 完整 Skill 内容已进入当前上下文
```

证据状态：`快照事实`。

## 8. Agent 定义：覆盖、可见和可调用仍是三层

`getAgentDefinitionsWithOverrides()` 合并 built-in、plugin 和 user/project/policy Markdown 定义；CLI `--agents` 在 `main.tsx` 后续加入。`getActiveAgentsFromList()` 对同名 agent 采用后写覆盖：

```text
built-in
-> plugin
-> user
-> project
-> flag
-> managed policy
```

但 active definition 仍不等于模型当前能选择它。`AgentTool.prompt()` 还会按 required MCP server 与 permission 过滤，再结合 `allowedAgentTypes` 形成提示；`AgentTool.call()` 在执行时再次解析类型、权限和 MCP 条件。

因此“Agent 出现在目录中”不能推出“模型看见它”，更不能推出“调用一定成功”。

## 9. Runtime tool pool：先有候选，再做策略装配

`getAllBaseTools()` 枚举当前构建和环境可能提供的基础工具。`getTools(permissionContext)` 再应用：

- simple/bare 模式；
- 特殊工具排除；
- blanket deny；
- REPL 模式替换；
- 每个 tool 的同步 `isEnabled()`。

`assembleToolPool()` 把 built-in 与 MCP 工具合并：先分别排序，再按 name 去重，built-in 处在前缀并在同名冲突时获胜。排序不仅为了好看，还用于 prompt-cache 稳定性。

这仍只是当前本地 runtime pool，不等于 API 最终发送的 tool schema 数组。

## 10. MCP：连接结果异步写入 AppState

Interactive 启动不会等待全部 MCP server 后再渲染或发送第一轮。`useManageMCPConnections()` 将 server 更新暂存并按时间窗口批量写入 AppState，维护：

```text
mcp.clients
mcp.tools
mcp.commands
mcp.resources
```

服务端还可以通过 `tools/list_changed`、`prompts/list_changed` 和 `resources/list_changed` 通知刷新。失败或禁用 server 会清除对应能力。

因此首轮可能只看见已连接子集，慢 server 在下一模型迭代或下一用户轮次才出现。这是明确的可用性/TTFT 权衡，不是随机遗漏。

## 11. Interactive：在安全边界刷新，不在流中任意突变

REPL 的 `getToolUseContext()` 在创建 context 时调用 `store.getState()`；`computeTools()` 每次调用又读取最新 store，合并 permission、MCP、initial tools 和 main-thread agent restriction。

它同时提供：

```text
options.tools = computeTools()      // 当前模型迭代的初始集合
options.refreshTools = computeTools // 声明的 fresh-read 能力
getAppState = () => store.getState()
```

`query.ts` 在工具结果已形成、准备递归进入下一模型迭代之前调用 `refreshTools()`，再用新 context 发下一次请求。

所以准确语义是：

```text
一个模型 API 流期间：schema/工具视图稳定
-> tool_use 在该视图下解释和执行
-> tool_result 完成
-> 下一模型迭代前刷新
-> 新 MCP 工具可进入下一次模型调用
```

这叫安全边界刷新，不叫“整个用户轮次永久冻结”，也不叫“异步到达后立刻修改正在进行的 API 流”。

## 12. Headless：下一排队命令刷新，单次 submit 通常稳定

`print.ts` 的 `buildAllTools(appState)` 闭包读取当前 AppState MCP、SDK MCP 和 dynamic MCP；`drainCommandQueue()` 对每个排队 command 重新读取 `getAppState()` 并构造 `allTools`，因此晚连接 server 可在下一次 `ask()` 看见。

`QueryEngineConfig` 接受具体 `tools`、`commands`、`mcpClients`，`submitMessage()` 将其放入 `ProcessUserInputContext`，没有 Interactive 的 `refreshTools` callback。由此，在一个 `ask()/submitMessage()` 内部 Tool Loop 中，传入工具集合通常保持稳定；后续排队 command 重新 `buildAllTools()`。

该 Interactive/Headless 非对称属于 FACT_A 必须独立核验的高风险结论。教材正文只有在 FACT_B 通过后才能使用绝对措辞。

## 13. System prompt 不是一根字符串

Headless `fetchSystemPromptParts()` 同时取得：

- default system prompt，除非 custom prompt 完全替换；
- user context；
- system context，custom prompt 时为空。

Interactive 的 `buildEffectiveSystemPrompt()` 优先级为：

```text
override
-> coordinator
-> main-thread agent
-> custom system prompt
-> default system prompt
+ append system prompt
```

Proactive 模式对 agent prompt 有特殊 append 行为。`appendSystemPrompt` 与 replace 语义不同，不能用一个 `string[]` 顺序偶然表达后就不记录来源。

Headless/SDK 的 `QueryEngine.submitMessage()` 不调用这个 Interactive builder，而是直接装配：

```text
custom 或 default
+ 可选 memory mechanics
+ append system prompt
```

因此 coordinator、main-thread agent、override 和 proactive 的处理不能从 Interactive builder 外推到 Headless。两条运行表面共享若干 prompt parts，却不是完全统一的有效提示装配器。

## 14. CLAUDE.md 和运行环境并不都在 system role

请求构造时：

- `systemPrompt + systemContext` 通过 `appendSystemContext()` 进入 API system prompt；
- `userContext` 通过 `prependUserContext()` 变成前置的 meta user message；
- 动态能力变化可以通过 attachment 转成 transcript 中的 model-visible message。

因此“CLAUDE.md 被拼进 system prompt”在通俗描述上会误导学习者。更准确是：它属于用户上下文，并以 meta user 消息投影；具体字段要以当前快照为准。

## 15. API tool projection：runtime pool 可以大于已发送 schema

`claude.ts` 在每次 API 请求前决定是否启用 Tool Search，识别 deferred tools，并从消息历史提取已发现工具名。若 Tool Search 开启：

- 非 deferred 工具正常进入；
- ToolSearchTool 保留；
- deferred 工具只有已通过 `tool_reference` 发现后才进入 `filteredTools`；
- `normalizeMessagesForAPI()` 也使用过滤后的工具集合；
- `toolToAPISchema()` 生成最终 schema，并按本轮添加 `defer_loading`。

所以：

```text
runtime pool 中有 handler
!= 当前 API 请求已经发送该工具 schema
```

延迟工具可以存在于 executable registry 中，但只在发现后才进入模型当前可用 schema。

## 16. Schema cache：稳定 base 与每请求 overlay

`toolToAPISchema()` 为每个 session 缓存 base schema：

```text
name
description
input_schema
strict
eager_input_streaming
```

`defer_loading` 与 cache control 是每请求 overlay，不写回 base。cache key 对具有显式 JSON schema 的工具包含序列化 schema，否则主要按工具名。

这是 prompt-cache 稳定策略，也产生重要边界：运行期 prompt/flag 漂移不会自动改变已经缓存的 base schema；清理 session cache 才重新渲染。对带 `inputJSONSchema` 的工具，cache key 包含序列化 schema，所以 input schema 真正改变会形成新 key；但同名且 schema key 不变时，description 或其他 base 渲染变化仍会继续命中旧值。不能笼统写成“MCP 重连后任何 schema 变化都被缓存吞掉”。

## 17. System prompt section 也有不同刷新策略

`systemPromptSection()` 首次计算后缓存到 `/clear` 或 `/compact`；`DANGEROUS_uncachedSystemPromptSection()` 每轮重算，并明确承认会破坏 prompt cache。

MCP instructions 根据 feature gate 可采用两种路径：

- 每轮重算的 volatile system-prompt section；
- transcript 持久化的 `mcp_instructions_delta` attachment。

所以“系统提示在启动时完全冻结”同样不成立。

## 18. Delta attachment 不是执行注册

当前快照中动态能力变化可通过以下 attachment 告知模型：

- `deferred_tools_delta`；
- `agent_listing_delta`；
- `mcp_instructions_delta`；
- `skill_discovery`。

这些是 model-visible 消息，不自动等价于本地 handler 已注册、权限已允许或 API tool schema 已发送。教材必须避免把“模型知道某能力”写成“模型一定能调用”。

## 19. Plugin：安装、缓存可见、激活分开

启动消费者主要调用 `loadAllPluginsCacheOnly()`，避免 Interactive 启动为了插件去 clone/fetch。`initializeVersionedPlugins()` 在 Headless 等待 bookkeeping，在 Interactive 通常 fire-and-forget；源码明确说 Interactive 路径的 bookkeeping 不改变当前 session runtime behavior。

背景安装可能把 `plugins.needsRefresh` 设为 true。真正的当前会话激活操作是 `/reload-plugins` 调用 `refreshActivePlugins()`：

```text
clear plugin/component caches
-> full load
-> reload commands and agents
-> preload plugin MCP/LSP declarations
-> write AppState.plugins and agentDefinitions
-> increment mcp.pluginReconnectKey
-> reload hooks
-> reinitialize LSP manager
```

因此“插件已经下载”不等于“当前会话所有组件已启用”。

## 20. 五层能力模型

本单元正文采用以下统一模型：

```text
CapabilityCatalog
  已发现的能力、来源、优先级、catalog revision

CapabilityProjector
  按 mode/policy/provider/model/deferral 生成模型视图

CapabilitySnapshot
  某个 request/iteration 的不可变投影

ExecutableRegistry
  本地实际可解析和调度的 handler

SystemContextBuilder
  按 replace/default/append 和 channel 规则构造上下文
```

它是 clean-room 设计迁移，不声称 Claude Code 使用这些公开类型名。

## 21. Harness 不变量

1. Discovery 不等于 model visibility。
2. Model visibility 不等于 permission allow。
3. Permission allow 不等于 executable 已注册。
4. Request/iteration snapshot 创建后不可变。
5. Catalog revision 发布不原地改变旧 snapshot。
6. Refresh 只发生在声明的 boundary。
7. Deferred capability 可存在于 registry，却没有 eager API schema。
8. 模型选择的工具必须再次在 registry 解析并验证权限；失败时 fail closed。
9. Prompt replacement 与 append 必须是不同字段和不同语义。
10. 每个能力保留 source、catalog revision 和 projection reason，便于诊断。
11. 同名冲突必须确定性解决并可观察。
12. `visibleToolNames` 必须是 `registeredToolNames` 的子集，除非测试显式注入不一致以验证失败路径。

## 22. 代表性实验

初始 catalog revision 1：

```text
Read      source=builtin   executable=true
Deploy    source=plugin    executable=true
```

policy 隐藏 Deploy。创建 request snapshot 1 后，再发布 Search 到 catalog revision 2：

- snapshot 1 仍只见 Read；
- boundary refresh 创建 snapshot 2，见 Read + Search；
- Deploy 仍存在 registry，但对模型不可见；
- deferred Search 可先在 registry 存在、schema 为空，discover 后才投影；
- 注入一个 model-visible 但未注册的 Ghost tool，dispatch 必须 fail closed；
- custom prompt replace 时不保留 default，append 只在有效 base 后追加。

TypeScript/Python 都要输出 revision、visible schemas、registry names、projection reasons 和失败原因。

## 23. 代表性风险

1. **发现即执行**：loader 命中条目就绕过 permission/registry 检查。
2. **可见但不可执行**：schema 已发送，handler 未注册或已被刷新移除。
3. **可执行但过度暴露**：policy 隐藏工具仍进入 API schema。
4. **原地刷新**：新 catalog 改写旧 request snapshot，导致同一请求前后证据不一致。
5. **任意时刻刷新**：正在流式生成时替换 schema，tool_use 无法按同一视图解释。
6. **插件安装即激活**：新组件没有清 cache、重建 agent/command 或触发 MCP reconnect。
7. **prompt replace/append 混淆**：企业安全基线被 custom prompt 意外覆盖或重复。
8. **delta 当注册**：模型收到说明，但执行面没有能力。
9. **同名覆盖不透明**：built-in/plugin/MCP 冲突时运行结果不可解释。
10. **入口 prompt 误归一**：把 Interactive builder 的 agent/coordinator 优先级错误套到 Headless。

## 24. 证据状态

- 启动、command/skill/agent/tool/MCP/plugin/prompt/API projection 属于 `快照事实`；
- TypeScript/Python capability experiment 属于 `运行验证`；
- 五个 clean-room 类型与 revision/boundary 契约属于 `设计迁移`；
- Interactive 与 Headless 刷新差异在 FACT_A/B 闭合前标为 `待闸门确认`；
- Graphify 不作为教材事实、图示或面试回答的最终证据。
