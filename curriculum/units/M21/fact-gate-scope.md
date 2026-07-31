# M21 事实闸门范围

独立核验当前 Claude Code CLI 快照中 Skill 与 Plugin 从磁盘/marketplace 到模型可见能力的生命周期。

必须回答：

1. SKILL.md 全文何时读入，frontmatter metadata 与正文何时进入模型/执行；
2. managed/user/project/additional/legacy/plugin/bundled/MCP 来源怎样组合，同名按路径还是按 name 去重，winner 如何选择；
3. Plugin manifest 如何声明 commands/skills/agents/hooks/MCP/LSP/userConfig，namespace 使用什么身份；
4. marketplace source policy、manifest/schema/path validation、ref/SHA/versioned cache 能保证什么，是否存在通用签名/内容 integrity verification；
5. settings intent、disk materialization、active components 三层怎样刷新；commands/agents/MCP/LSP/Hooks 是否原子替换；
6. disable/uninstall/reload 对 removed components 与 in-flight 使用的保证；
7. Skill inline shell、allowed-tools、remote MCP skill 与 sensitive userConfig 的信任边界。

源码根：D:\agent\Claude code最新\claude-code-CLI

优先入口：

- src/skills/loadSkillsDir.ts
- src/tools/SkillTool/SkillTool.ts 与 prompt.ts
- src/commands.ts
- src/utils/plugins/pluginLoader.ts
- src/utils/plugins/loadPluginCommands.ts、loadPluginAgents.ts、loadPluginHooks.ts
- src/utils/plugins/schemas.ts、validatePlugin.ts、pluginIdentifier.ts
- src/utils/plugins/marketplaceHelpers.ts、marketplaceManager.ts、pluginPolicy.ts
- src/utils/plugins/refresh.ts、cacheUtils.ts、orphanedPluginFilter.ts

可定向读取测试和组件。不要读取 Graphify、M21 工作簿、Harness、草稿、其他单元或历史聊天。只读，不修改文件。

只报告会改变发现时间、模型可见性、执行信任、命名冲突、刷新一致性、供应链边界或 H4-2 契约的事实。管理 UI、文案和边缘选项不算 Issue。
