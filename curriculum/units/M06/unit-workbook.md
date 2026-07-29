# M06 研究工作簿

状态：`release-candidate`

本文件是作者工作区，不是教材正文。Graphify 只用于定位 `settings/`、`managedEnv.ts`、TrustDialog 和远程策略候选入口；下列事实均已回到 `claude-code-CLI/` 直接核验。

## 1. 单元问题、边界与风险

核心问题：当用户配置、项目配置、命令行设置和企业策略同时给出一个值时，Claude Code 怎样得到本次运行真正使用的设置；为什么“最终值来自哪里”和“这个值现在能不能产生副作用”是两件不同的事？

本单元闭合：

- 设置来源、路径、启用集合与低到高优先级；
- 对象、标量和数组的合并语义；
- 企业策略提供者的选择和策略只读边界；
- `--settings`、SDK inline settings 与 `--setting-sources`；
- 解析、校验、缓存、来源视图和配置快照；
- project/local 环境变量与 helper/hook/Bash 等能力的 trust boundary；
- 远程策略到达后快照失效和运行态重发布的最小语义。

不提前吞掉：M07 的 AppState/bootstrap 全量初始化和 owner；M08 的能力快照；M09 的完整生命周期；后续权限、Hook、Plugin、MCP 和企业策略控制平面。

风险：`R2`。同一个 settings 对象同时影响行为和潜在副作用；最危险的误解是把所有层都叫作“后者覆盖前者”，或误以为 headless 不需要信任假设。

## 2. Graphify 候选与直接核验

Graphify 查询命中 `getSettingsWithSources()`、`getSettingsForSource()`、`TRUSTED_SETTING_SOURCES`、`managedEnv.ts`、`TrustDialog.tsx`、`settings/settings.ts`。图谱只说明候选邻接，没有证明所有符号在一条运行调用链上。

直接核验后的主链：

```text
进程参数
-> eagerLoadSettings()
-> setFlagSettingsPath / setAllowedSettingSources
-> init()
-> applySafeConfigEnvironmentVariables()
-> getSettingsForSource / getInitialSettings
-> 解析并按来源合并
-> trust 成立后 applyConfigEnvironmentVariables()
-> AppState 或消费者取得配置快照
```

证据状态：`快照事实`。

## 3. 五个主来源和默认优先级

`src/utils/settings/constants.ts:SETTING_SOURCES` 与默认 bootstrap state 都定义低到高顺序：

```text
userSettings
-> projectSettings
-> localSettings
-> flagSettings
-> policySettings
```

路径和形态：

| 来源 | 主要位置或入口 | 是否可由设置 UI 写入 |
| --- | --- | --- |
| user | Claude config home 下 `settings.json` | 是 |
| project | original cwd 下 `.claude/settings.json` | 是 |
| local | original cwd 下 `.claude/settings.local.json` | 是 |
| flag | `--settings` 文件/内联 JSON，或 SDK inline settings | 否 |
| policy | remote、MDM/HKLM/plist、managed file、HKCU 中胜出的提供者 | 否 |

`EditableSettingSource` 明确排除 `flagSettings` 与 `policySettings`。这里的“只读”是 Claude Code 不把修改写回这些来源，不代表 OS 管理员或外部 SDK 永远不能改变它们。

## 4. `--setting-sources` 的意图是过滤，当前快照却会改变顺序

默认 bootstrap state 已按五来源顺序启用全部来源。`parseSettingSourcesFlag()` 只接受 `user,project,local`；`getEnabledSettingSources()` 把 allowed list 放入保持插入顺序的 `Set`，然后依次追加 policy、flag，且没有按 `SETTING_SOURCES` 重新排序。

因此：

- 默认无该参数：`user -> project -> local -> flag -> policy`；
- `--setting-sources user,project,local`：`user -> project -> local -> policy -> flag`；
- `--setting-sources local,user`：`local -> user -> policy -> flag`；
- `--setting-sources ''`：`policy -> flag`；
- 用户不能用该参数禁用企业策略；
- 参数文案表达“选择来源”，但当前快照的实现还让用户输入顺序改变普通来源覆盖，并让追加在后的 flag 覆盖 policy；
- SDK isolation mode 也必须保留显式 inline/flag 与 policy 的约束。

这是当前快照行为，不是推荐的企业配置语义，也不要求修改只读快照。教材必须把**默认/设计意图**与**显式过滤参数下的实际迭代**分开；Harness 采用显式 canonical order，不能复制一个会让策略层失去最高优先级的偶然 Set 顺序。

## 5. 三种容易混淆的合并规则

### 5.1 主来源链：后来源覆盖前来源

`loadSettingsFromDisk()` 先以 allowlisted plugin settings 为最低层，再循环 enabled sources。`mergeWith` 深合并对象；普通标量由实际迭代中更后的来源覆盖。默认迭代符合 `SETTING_SOURCES`；显式 `--setting-sources` 的例外见上一节。

### 5.2 数组：连接并去重

`settingsMergeCustomizer()` 对两个数组返回 `uniq([...target, ...source])`。数组不是整段替换；去重保留先出现项的相对顺序。

### 5.3 policySettings 内部：首个有效提供者胜出

企业策略不是把所有后端都混在一起：

```text
remote cache
-> MDM / HKLM / plist
-> managed-settings.json + managed-settings.d
-> HKCU
```

首个非空且可用的提供者成为整个 `policySettings`。远程策略若存在但 schema 无效，主加载链记录错误并继续尝试较低提供者。`getSettingsForSourceUncached()` 的简化读取与主加载链的错误收集职责不同。

文件型策略内部又有一层独立合并：base 文件先合并，`managed-settings.d/*.json` 按文件名字母序依次覆盖；这一层仍遵循对象深合并和数组连接去重。

### 5.4 写回某一个来源：数组替换、`undefined` 删除

`updateSettingsForSource()` 不是启动读取链。它更新 user/project/local 某一个文件时使用另一套 customizer：调用者给出的数组整体替换该来源原数组，显式 `undefined` 删除字段。否则 UI 想删除一个数组项时，读取链的“连接去重”会把旧项重新带回来。

因此必须先问动作是什么：**解析多个来源**时数组连接去重；**写回单一来源**时数组替换。flag/policy 即使被错误强转传入，当前实现也返回不写入。

## 6. 主案例：`permissions.defaultMode`

假设使用默认 source order，各层给出：

```text
user:    permissions.defaultMode = default
project: permissions.defaultMode = plan
local:   permissions.allow = [Read]
flag:    permissions.defaultMode = acceptEdits
policy:  permissions.defaultMode = dontAsk
```

结果不是选中某个完整 `permissions` 对象，而是深合并后的对象：

- `defaultMode` 最终是 policy 的 `dontAsk`；若同时显式使用 `--setting-sources`，必须先按第 4 节重新算实际顺序，不能无条件套用此结论；
- local 的 `allow` 数组仍保留，除非更高层通过具体语义改变；
- provenance 应记录到字段路径，而不是只写“整个 settings 来自 policy”；
- 后续 `permissionSetup.ts` 消费的是 effective settings，CLI session flag 仍可能在更靠后的运行时决策里参与选择，因此“文件合并最终值”不等于“所有运行时输入都已结束”。

教材实验只复现配置解析契约，不冒充完整权限系统。

## 7. 解析、校验与快照

`parseSettingsFile()`：

1. `safeResolvePath` 得到可读路径；
2. 读 JSON；
3. 先过滤单条无效 permission rule，避免一条坏规则拖垮整文件；
4. 用 `SettingsSchema` 做整体 Zod 校验；
5. 文件缓存命中和首次返回都 clone settings，避免 `mergeWith` 或调用者污染缓存对象。

除被预先过滤的无效 permission rule 外，任一整体 schema 错误都会让该文件返回 `settings: null`，不会保留同文件中其余“看起来正确”的字段。这是“先验证一个来源，再参加跨来源合并”，而不是逐字段容错合并。

`getInitialSettings()` 返回当前缓存下的 effective snapshot。`getSettingsWithSources()` 会先 reset cache，再同时返回 effective 与非空的 raw per-source settings；它给出来源列表，不直接给每个叶子字段的最终 provenance。教材和 Harness 的字段级 provenance 是从合并过程显式记录出来的设计迁移，不冒充快照现有 API。

文件 watcher 或程序化通知先清缓存，再让 interactive/headless listener 调用 `applySettingsChange()`，重新加载 settings、permissions 和 hooks，并把新 settings 推入 AppState。快照不是进程生命周期内永远不变。

## 8. 信任边界：值存在不等于副作用已经生效

`init()` 在 trust dialog 前调用 `applySafeConfigEnvironmentVariables()`：

```text
global config env
-> user env
-> flag env
-> 计算 remote policy eligibility
-> policy env
-> merged settings 中仅 SAFE_ENV_VARS
```

project/local 不在 `TRUSTED_SETTING_SOURCES`。原因不是它们优先级低，而是项目目录可能由攻击者控制，危险变量可重定向模型请求或影响进程加载。trust 前，project/local 只有 allowlist 中的安全变量能从 fully merged settings 应用。

这个 allowlist 不是“所有路由相关变量都禁止”。当前快照允许 `CLAUDE_CODE_USE_BEDROCK`、`CLAUDE_CODE_USE_VERTEX`、`CLAUDE_CODE_USE_FOUNDRY` 在 trust 前切换到用户自己的云提供者；但 `ANTHROPIC_BASE_URL`、各 provider base URL、proxy、额外 CA、API token 等仍不在 allowlist。前者是受限 provider 选择，后者可能把流量或信任导向攻击者控制的端点，风险不同。

trust 成立后，`applyConfigEnvironmentVariables()` 才把所有来源的 env 应用到 `process.env`。TrustDialog 还单独扫描 project/local 是否包含 hooks、Bash allow rules、api/otel/AWS/GCP helper 命令和非 allowlist 环境变量，让用户知道接受工作区可能启用哪些执行面。

headless/print 不显示 trust dialog；源码明确把 `-p` 目录视为调用者已经信任，并应用 project/local 的危险环境变量。正确表述是“信任由调用者承担”，不是“headless 无需信任”。

## 9. 远程策略与动态重发布边界

`main.tsx` 非阻塞启动 `loadRemoteManagedSettings()`。加载器 cache-first、fetch fail-open，并启动后台轮询；只要策略有内容或变化，就通过 `settingsChangeDetector.notifyChange('policySettings')` 清缓存并通知两类表面。

本单元只要求理解：

```text
旧 ConfigurationSnapshot
-> policy change notification
-> cache invalidation + re-merge
-> AppState/消费者收到新 snapshot
```

旧 snapshot 不应被原地悄悄改写。远程身份、同步缓存、安全检查、轮询治理和失效策略留给企业控制平面单元。

## 10. 实验假设与反证条件

clean-room 实验不导入 Claude Code 源码、不调用真实模型。

假设 A：给定一个显式有序的来源列表，对象递归、数组连接去重、标量由列表后者覆盖。反证：后来源标量未生效，或嵌套对象被整段误删。

假设 B：policy 的 provider selection 与主来源 merge 是两个阶段。反证：两个 policy provider 被意外拼接，或低优先级 provider 覆盖高优先级 provider。

假设 C：每个最终叶子能追到贡献来源，数组能追到各项来源。反证：只能知道整个对象的最后来源，无法解释混合对象。

假设 D：trust 前只应用 trusted source 的任意 env 和 project/local 的 safe env；trust 后才应用全部 enabled env。反证：project `ANTHROPIC_BASE_URL` 在 trust 前进入运行环境。

假设 E：发布新 snapshot 不改变旧 snapshot。反证：热更新后已在运行请求持有的旧对象被原地修改。

假设 F：一个非 permission 的 schema 错误会拒绝整个来源文件；单条无效 permission rule 则被过滤并保留其余合法设置。反证：两种错误被实验错误地当成同一类部分成功。

假设 G：当前快照兼容顺序与 Harness canonical 顺序是两个可观察的策略。反证：`--setting-sources ''` 在两者都得到同一顺序，或 Harness 隐式依赖 JavaScript Set 的追加顺序。

观察点：enabled source order、selected policy provider、effective value、leaf/item provenance、pre-trust env、post-trust env、snapshot revision、rejected writes。

## 11. Harness 候选契约

H1-in-progress 增加：

- `ConfigurationResolver`：从调用者显式提供的有序来源序列产生 immutable-by-convention snapshot；
- `ConfigurationSnapshot`：包含 revision、effective values 和字段级 provenance；
- `PolicyProviderSelector`：first-valid-provider-wins；
- `TrustPhase`：`pre-trust | trusted`，决定环境副作用投影；
- read-only guard：拒绝 Harness 内部写回 flag/policy 来源。

配置只在 surface/core 外围解析，`RuntimeCore` 接收一个已发布 snapshot，不直接读取文件、argv 或 `process.env`。候选决定：`merge`，前提是双语言测试与 S0/H1 回归全通过。

H1 默认使用 canonical `user -> project -> local -> flag -> policy`；另提供纯函数复现当前快照 `allowed Set + policy + flag` 的顺序，只用于兼容研究和回归，不作为企业推荐默认值。

## 12. 当前证据边界

- 源码路径、合并、信任和热更新属于 `快照事实`；
- 双语言 resolver 属于 `运行验证`；
- 字段级 provenance 和快照发布接口属于 `设计迁移`；
- M06 不声称原项目提供字段级 provenance API，也不复现完整权限/策略控制平面；
- Graphify 不作为教材事实、图或面试答案的最终证据。
