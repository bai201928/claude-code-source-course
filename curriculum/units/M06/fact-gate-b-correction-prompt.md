# FACT_B 定向纠错

继续同一 FACT_A/FACT_B 会话。你的 FACT_B 存在一个直接源码冲突和一个头部矛盾，请只定向复核，不扩散阅读。

## 冲突 1：`--settings` inline JSON

请重新逐行读取当前快照 `D:\agent\Claude code最新\claude-code-CLI\src\main.tsx` 的 `loadSettingsFromFlag()`，约 432-475 行，并在该文件搜索 `setFlagSettingsInline`。

当前文件可见代码是：

```ts
if (looksLikeJson) {
  const parsedJson = safeParseJSON(trimmedSettings)
  if (!parsedJson) { ... }
  settingsPath = generateTempFilePath('claude-settings', '.json', {
    contentHash: trimmedSettings
  })
  writeFileSync_DEPRECATED(settingsPath, trimmedSettings, 'utf8')
} else {
  // resolve file path
}
setFlagSettingsPath(settingsPath)
resetSettingsCache()
```

`setFlagSettingsInline()` 的已知使用点在 `src/cli/print.ts` 的 SDK control path，约 3719 行，不在 `main.tsx:loadSettingsFromFlag()`。

请回答：上一轮所谓“`--settings` 内联 JSON直接存内存且 early return”是否读到了当前快照真实代码？如果没有，请明确撤回该 Issue。还要区分：CLI `--settings '{...}'` 与 SDK control message 写入 inline settings 是两条入口，但都汇入 `flagSettings`。

## 冲突 2：闸门头部

上一轮同时给出 `VERDICT: PASS` 和 `MATERIAL_ISSUES: 2`，但正文中第二项其实是你确认 Codex 正确、FACT_A 措辞错误；第一项若被上面的源码复核推翻，也不再有 material issue。

请输出一份替代上一轮的最终 FACT_B 结果。必须以三行开始，且 verdict、issue 数和正文一致：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

只保留真正影响 M06 事实、实验或 Harness 契约的问题；明确列出撤回项和最终 `No material issues`（若适用）。
