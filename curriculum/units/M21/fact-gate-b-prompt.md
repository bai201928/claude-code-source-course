# M21 FACT_B：同会话对照

继续 FACT_A 会话，只核对下面的 Codex 结论，不重新总结仓库。

## Codex 结论

- getSkillDirCommands 在发现阶段读完整 SKILL.md 并封入 Command 闭包；模型列表/SkillTool prompt 主要投影 frontmatter metadata，调用时才展开正文、参数替换与本地 prompt shell。因此是正文延迟投影，不是磁盘延迟读取。MCP remote skill 禁止正文 inline shell。
- 本地 Skill 只按 canonical realpath 去掉同一文件重复，不按 name 去重；managed、user、project、additional、legacy 按数组组合。总 commands 又按 bundled、builtin-plugin、local、workflow、plugin command、plugin skill、builtin 组合。findCommand 使用第一个匹配，因此不同文件重名是 order-dependent first match。
- Plugin command/skill 名称以 manifest/plugin name 加冒号 namespace，不使用完整 name@marketplace identity；它减少冲突但不证明全局唯一。
- source block/allow policy 可在下载前阻断；manifest/component schemas 与 relative/base path check 约束形状和路径；ref/SHA/versioned cache 提供物化定位。当前 plugin 目录没有通用内容 signature/integrity verification，不能把 cache version 或 manifest valid 当 authenticity。
- refreshActivePlugins 按 full load -> cache-only consumers -> MCP/LSP warm -> AppState swap + reconnect key -> LSP reinit -> Hook clear/register 推进。它是完整刷新编排但不是跨组件事务；Hook load failure 不回滚已交换状态，旧 request snapshot/in-flight execution 不被追溯修改。
- clear cache 对 removed Hook 有异步 prune，完整 reload 才加入新 Hook；orphan cache 延迟清理。不能泛化成 disable/uninstall 立即撤销所有已经开始的代码。
- sensitive userConfig 不应进入普通 skill/agent content；请核验 placeholder/secure storage 与 Hook/MCP/LSP substitution 的边界。

## H4-2 迁移

ExtensionRegistry 使用完整 source identity + namespace、revisioned atomic bundle replace、explicit collision result、trust/signature policy port、immutable snapshot 与 execution lease。它是 clean-room 增强，不是当前快照事实。

只报告会改变上述关键事实、实验或 H4-2 的问题。必须以下列三行开头；接受时明确 PASS / 0。

~~~text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
~~~
