# FACT_B 来源顺序定向补审

继续同一 FACT 会话。Codex 在实现实验前发现一个会改变 M06 核心结论的源码顺序问题。请只核验下列符号，不扩散阅读。

## 源码片段

`src/utils/settings/constants.ts`：

```ts
export function parseSettingSourcesFlag(flag: string): SettingSource[] {
  if (flag === '') return []
  const names = flag.split(',').map(s => s.trim())
  const result: SettingSource[] = []
  for (const name of names) {
    switch (name) {
      case 'user': result.push('userSettings'); break
      case 'project': result.push('projectSettings'); break
      case 'local': result.push('localSettings'); break
      default: throw new Error(...)
    }
  }
  return result
}

export function getEnabledSettingSources(): SettingSource[] {
  const allowed = getAllowedSettingSources()
  const result = new Set<SettingSource>(allowed)
  result.add('policySettings')
  result.add('flagSettings')
  return Array.from(result)
}
```

默认 bootstrap state 是：

```ts
allowedSettingSources: [
  'userSettings', 'projectSettings', 'localSettings',
  'flagSettings', 'policySettings'
]
```

`loadSettingsFromDisk()` 与 `getSettingsWithSources()` 直接按 `for (const source of getEnabledSettingSources())` 迭代，没有再按 `SETTING_SOURCES` 排序。

## 请确认的行为

1. 默认没有 `--setting-sources` 时，顺序是否为 `user -> project -> local -> flag -> policy`？
2. `--setting-sources user,project,local` 后，allowed list 只有前三项，Set 再依次 add policy、flag，顺序是否成为 `user -> project -> local -> policy -> flag`？
3. `--setting-sources local,user` 是否成为 `local -> user -> policy -> flag`？
4. `--setting-sources ''` 是否成为 `policy -> flag`？
5. 因为后迭代 source 覆盖前 source，这是否意味着显式 flag 场景下 flag settings 可以覆盖 policy 的普通 scalar/object leaf，并且用户给出的 ordinary source 顺序也能改变覆盖结果？
6. 搜索当前快照是否有测试或其他 normalization 阶段推翻以上推导。

## 教材与 Harness 裁决

如果上述推导成立，请区分：

- `SETTING_SOURCES` 和默认状态表达的标准/预期优先级；
- 当前快照在显式 `--setting-sources` 下的实际迭代行为；
- 这是应忠实讲解的有条件事实，还是能够忽略的无关边缘问题。

由于 M06 核心就是“最终值从哪里来”，只有真正影响最终值的差异才是 material。请输出：

```text
GATE: FACT_B_ORDER
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

给出精简源码依据、实际四组顺序、对实验和教材的最小修正。不要讨论利用漏洞，不要建议修改只读源码快照。
