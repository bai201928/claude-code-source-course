# M06 事实闸门中性范围

独立核验当前静态源码快照中 Claude Code 设置来源、启用过滤、合并语义、企业策略提供者选择、解析缓存、环境变量信任边界和远程策略热更新的最小链路。不评价教学风格，不修改文件，不读取 Graphify 或 M06 作者材料。

源码根目录：`D:\agent\Claude code最新\claude-code-CLI`

需要回答：

1. `SETTING_SOURCES` 的固定顺序是什么；默认 allowed sources 从哪里初始化？
2. `--settings` 文件/内联 JSON怎样进入 flag source；SDK inline settings 又怎样与 flag file 合并？
3. `--setting-sources` 接受哪些名字；空列表和子集是否仍包含 flag/policy；它是来源过滤还是优先级重排？
4. user/project/local/flag/policy 的路径或提供者是什么；哪些 source 可以由 Claude Code 的设置写入逻辑修改？
5. plugin settings、五个主来源、嵌套对象、标量与数组各怎样合并？数组是替换还是连接去重？
6. “first source wins” 的准确适用范围是什么；remote、MDM/HKLM/plist、managed file、HKCU 是合并还是择一？无效 remote schema 如何处理？
7. `managed-settings.json` 与 `managed-settings.d/*.json` 内部如何排序和合并？
8. `parseSettingsFile()` 怎样处理路径、JSON、invalid permission rules、Zod validation、缓存和 clone；一个整体 schema 错误是否会让该文件参与合并？
9. `getInitialSettings()`、`getSettingsWithSources()`、per-source cache 与 merged cache 各提供什么；当前源码是否真的提供叶子字段级 provenance？
10. `applySafeConfigEnvironmentVariables()` 在 trust 前允许哪些来源和环境变量；为什么先应用 non-policy trusted env、再判断 remote eligibility、最后应用 policy env？
11. trust dialog 怎样检查 project/local 中的 hooks、Bash、helper commands 和 dangerous env；trust 后由谁应用全部环境变量？
12. headless/print 怎样处理 project/local 环境变量；“绕过 trust dialog”能否表述成“不需要信任”？
13. remote managed settings 怎样非阻塞加载、fail open、通知变更、清缓存并更新 interactive/headless 运行状态？本单元最小应说明到哪里？
14. 以 `permissions.defaultMode` 和一个危险环境变量为例，哪些结论是 settings merge，哪些还要经过运行时选择或 trust gate？
15. clean-room resolver 要观察哪些正常、冲突、策略选择、信任和快照更新行为，才能验证本章而不冒充原项目测试？

优先阅读：

- `src/bootstrap/state.ts` 中 allowed/flag settings state
- `src/main.tsx -> eagerLoadSettings/loadSettingsFromFlag/loadSettingSourcesFromFlag` 及 print trust 分支
- `src/entrypoints/init.ts -> init/initializeTelemetryAfterTrust`
- `src/utils/settings/constants.ts`
- `src/utils/settings/settings.ts`
- `src/utils/settings/settingsCache.ts`
- `src/utils/settings/applySettingsChange.ts`
- `src/utils/settings/changeDetector.ts`
- `src/utils/managedEnv.ts` 与 `managedEnvConstants.ts`
- `src/components/TrustDialog/TrustDialog.tsx` 与 `utils.ts`
- `src/services/remoteManagedSettings/index.ts`
- `src/utils/permissions/permissionSetup.ts` 中 settings defaultMode 消费点

输出必须以规定 FACT_A 三行开始。只报告会影响配置最终值、来源解释、信任边界、代表性实验或 H1 ConfigurationSnapshot 契约的实质问题；普通重构建议、防御性漏洞、完整企业控制平面扩展和格式问题不得列为实质 Issue。

