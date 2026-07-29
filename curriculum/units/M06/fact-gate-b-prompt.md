# FACT_B 同会话对照提示词

继续刚才的 FACT_A 会话。现在请把你在阶段 A 独立得到的结论，与下面 Codex 的机制摘要、问题裁决和 clean-room 实验契约逐项对照。不要重新扩散阅读整个源码树；只有发现明确冲突时，才回到相关路径和符号定向核验。

## Codex 机制摘要

### 启用、发现与主合并

```text
eagerLoadSettings
-> --settings 解析为 flagSettings path（内联 JSON也落到内容哈希临时文件）
-> --setting-sources 只选择 user/project/local
-> flagSettings + policySettings 始终启用
-> init/applySafeConfigEnvironmentVariables 首次读取
-> plugin allowlisted base
-> user -> project -> local -> flag -> policy
-> effective settings snapshot
```

普通来源按固定低到高顺序深合并；标量由高层覆盖，对象按叶子合并，数组连接并去重。SDK 的 inline settings 也进入 flagSettings，并覆盖同一来源中的 flag file 值。`--setting-sources` 是过滤器，不重排顺序，也不能关闭 policy/flag。

写回单个 editable source 是另一条链：数组替换、显式 `undefined` 删除。flag/policy 不由这个接口写回。

### 策略提供者选择

```text
remote
-> MDM/HKLM/plist
-> managed-settings.json + sorted managed-settings.d
-> HKCU
```

这里只选首个有效 provider，不合并多个 provider。胜出的完整 policySettings 再作为最高优先级主来源参加普通 settings merge。文件型 policy provider 内部先 base、后按名字排序的 drop-ins，仍使用普通深合并/数组连接去重。

### 解析、缓存与来源

文件先解析和 schema validation，再参加合并。单条 invalid permission rule 可预先过滤；其他整体 schema 错误让整个来源文件不参加合并。parse cache 返回 clone，避免 mergeWith 污染缓存对象。

`getInitialSettings()` 是当前 effective snapshot；`getSettingsWithSources()` 强制刷新后返回 effective 与 raw per-source settings，但没有叶子字段 provenance。Harness 的 leaf/item provenance 是设计迁移，不冒充源码 API。

### trust 与环境副作用

```text
trust 前：global -> user -> flag -> remote eligibility -> policy
                         + fully merged 中的 SAFE_ENV_VARS
trust 后：global + fully merged 全部 env
```

project/local trust 前只能贡献 safe allowlist env。当前 allowlist 包含 `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY`，所以有限 provider switch 可提前发生；`ANTHROPIC_BASE_URL`、provider base URL、proxy、额外 CA 和 token 不允许提前发生。host-managed provider 模式还会从所有 settings env 中剥离受宿主管理的变量。

Headless/print 没有产品内 trust dialog/check，会应用 project/local 全部 env；但 CLI help 和源码注释明确把责任转交调用者，只应在已信任目录使用。拟写入教材的准确表达是：“headless 没有交互式 trust gate，调用者必须预先建立目录信任”，而不是“headless 不需要信任”。

### 热更新

远程策略非阻塞、cache-first、fetch fail-open；策略变化通过 settingsChangeDetector 清缓存并通知 interactive/headless，`applySettingsChange()` 重新读取 settings/permissions/hooks 并发布新 AppState。M06 只解释 snapshot invalidation/republication；完整 remote identity、security、polling 和 control plane 留给企业治理单元。

## 对 FACT_A 三项问题的 Codex 裁决

1. **remote cache 校验分歧**：接受它是两个源码读取路径的真实差异，但当前远程写入链在入缓存前已 schema/security validation，M06 clean-room 也不会向真实缓存注入坏数据。正文只紧邻说明 per-source 简化路径与 merged error-collecting path 不完全等价；实验在自己的 provider boundary 拒绝 invalid provider。请判断它是否仍是阻断本章的 material issue。
2. **whole-file Zod rejection**：接受并纳入失败实验，明确区分 invalid permission rule 的局部过滤与其他 schema 错误的整来源拒绝。
3. **SAFE_ENV provider switch**：接受并改写 trust 叙述，明确有限 provider switch 与 attacker-controlled endpoint redirect 的差别。

FACT_A 另称 headless bypass 等于 “no trust required”。Codex 不接受这个教学表述：它准确说明“产品内没有 trust check”，却否定了 help text 明示的调用者信任前置。请按运行事实与使用契约复核这一措辞。

## clean-room 实验契约

TypeScript/Python 对称实现：

- 固定 main source order，支持 enabled ordinary sources；policy/flag 始终启用；
- 先从多个 policy provider 选首个 valid/non-empty provider，再参加主合并；
- 对象递归、数组连接去重、标量后层覆盖；
- 记录 scalar leaf provenance 与 array item provenance；
- schema validator 可拒绝整个来源，并保留错误，不做逐字段悄悄恢复；
- `project` 的 `ANTHROPIC_BASE_URL` 在 pre-trust 被挡住，safe provider switch 可应用；trusted 后两者按 effective snapshot 应用；
- flag/policy write 被拒绝；
- resolve 产生 revisioned snapshot，新发布不原地修改旧 snapshot；
- `RuntimeCore` 只接收 snapshot，不直接读文件、argv 或 `process.env`。

代表性测试：标量/嵌套冲突、数组去重与 item provenance、setting-sources 空集合、policy provider first-valid-wins、invalid entire source、pre/post trust env、read-only write、snapshot replacement 和 S0/H1 回归。

## 审查要求

只检查事实错误、重要遗漏、证据不足、层次混淆，以及实验不能验证正文结论的问题。普通措辞偏好、理论缓存破坏、完整企业控制平面细节和不会影响学习/Harness 的边缘问题不构成 Issue。

输出必须以以下三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后按 Issue 列出源码路径与符号、与 FACT_A 的对照、为什么影响教材或 Harness、应接受的修正或定向验证。没有实质问题时明确写 `No material issues`。
