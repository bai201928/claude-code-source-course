# M21 作者工作簿：Skill、Plugin 与扩展供应链

状态：release-candidate

风险：R2。扩展内容可以进入 prompt、执行 shell、注册 Hook/MCP/LSP，并改变模型可见能力。

## 本单元只回答一个问题

一个磁盘目录或 marketplace entry，怎样经过发现、解析、物化、命名空间、注册与刷新，成为下一次请求可见且可执行的能力？

主线：

~~~text
source intent
-> source policy
-> marketplace/plugin materialization
-> manifest + component parsing
-> namespace/conflict resolution
-> active component registry
-> request-time capability snapshot
-> Skill invocation / Hook / MCP / LSP execution
-> refresh/unload
~~~

## Graphify 候选与直接核验

Graphify 指向 loadSkillsDir.ts、SkillTool.ts、pluginLoader.ts、loadPluginCommands.ts、refresh.ts、schemas.ts、validatePlugin.ts、marketplaceManager.ts、marketplaceHelpers.ts、loadPluginHooks.ts。所有结论均已回到这些源码核验；图谱不作为证据。

## 已确认事实

### Skill 不是“调用时才读文件”

getSkillDirCommands() 在发现阶段读取完整 SKILL.md、解析 frontmatter 与 markdown body，并把正文封存在 Command.getPromptForCommand 闭包中。estimateSkillFrontmatterTokens() 与 SkillTool prompt/listing 主要使用 name/description/whenToUse，正文在调用时才展开进消息；这叫“正文延迟投影/执行”，不是“文件延迟读取”。

本地 Skill 展开时可做参数替换、CLAUDE_SKILL_DIR/SESSION_ID 替换与 prompt shell execution；MCP skill 被视为 remote/untrusted，不执行 markdown 中的 inline shell。

Skill 来源含 managed、user、project、additional、legacy commands、plugin、bundled、MCP/dynamic。/skills 只接受 <name>/SKILL.md；legacy /commands 仍支持单 md 与目录形式。conditional paths skill 先存入 map，匹配文件后激活。

### 重名 winner 有顺序语义

本地 Skill dedupe 只按 realpath 识别同一文件/符号链接，组合顺序 managed -> user -> project -> additional -> legacy。不同文件同 name 都能进入数组。loadAllCommands 的组合顺序为 bundled、builtin-plugin、local skill、workflow、plugin command、plugin skill、builtin command；findCommand() 使用 Array.find，因此第一个匹配 name/display name/alias 的定义胜出。

Plugin command/skill 使用 pluginName:namespace:name，能减少普通跨插件冲突，但 pluginName 不是完整 plugin@marketplace identity；同名 plugin 或同插件内部重复仍可能产生同名定义。当前总装配没有一个统一 conflict ledger。

### Plugin 是交付容器

Plugin manifest 可声明 commands、skills、agents、hooks、MCP、LSP、output styles、userConfig 等。loader 支持 marketplace、flag path、built-in 等来源；manifest/schema 和组件内容分别解析。manifest 的 additional path 使用 relative schema 和 validatePathWithinBase 等边界，来源可被 strictKnownMarketplaces/blockedMarketplaces 在下载前限制，plugin 可被 managed enabledPlugins 强制启停。

versioned cache 使用 marketplace/plugin/version 路径；git source 可带 ref/sha，git-subdir 能记录 commit SHA；cache 解决稳定物化和并存版本，不自动证明内容真实。全插件目录没有通用 package signature/integrity verification；代码里 sha256 命中主要是 MCPB key 与本地路径版本哈希，不能写成插件签名。

### 三层刷新不是一个全局事务

源码自己区分 Layer 1 settings intent、Layer 2 ~/.claude/plugins materialization、Layer 3 AppState active components。refreshActivePlugins() 清缓存，先 full load/warm cache-only，再并行加载 commands/agents，预热 MCP/LSP，setAppState 交换 plugin arrays/agent definitions 并 bump MCP reconnect key，随后 reinitialize LSP，再 clear-and-register Hook。

因此刷新覆盖面较完整，但 commands/agents/MCP trigger/LSP/Hook 不在同一个不可分割 commit 中。Hook load 失败不会回滚之前 AppState swap；in-flight request 已持有的 commands/capability view 也不会被追溯修改。removed Hook 有 prune 逻辑；旧 cache version 延迟标记 orphan 后清理。

## H4-2 迁移决定

Merge：ExtensionRegistry、ExtensionBundle、source identity、namespace、revisioned replace、explicit collision errors、trust/signature policy port、immutable ExtensionSnapshot、unload 后新 snapshot 不再可见、旧 snapshot 保留成员身份但 execution 要按 lease/version 约束。

Defer：真实 Git/NPM 下载、X.509/Sigstore、Hook/MCP/LSP adapter、durable marketplace DB、UI。

Reject：name first-wins、version 等同 signature、manifest valid 等同 trusted、reload 原地修改旧 request、unload 强杀 in-flight handler。

## 事实闸门待核验

1. Skill discovery/full body/metadata projection/invocation shell 的准确时间边界；
2. local/plugin/builtin 重名的实际 Array.find winner；
3. plugin namespace 是否使用 manifest name 而非 full marketplace identity；
4. source policy、manifest/path validation、version/ref/SHA/cache 与 signature 的准确边界；
5. refreshActivePlugins 的先后顺序、Hook 失败与多组件非原子边界；
6. unload 对 in-flight command/tool/Hook 的现实保证；
7. plugin sensitive userConfig 在 skill/agent content 中是否只给 placeholder，在哪些执行组件可解析。
