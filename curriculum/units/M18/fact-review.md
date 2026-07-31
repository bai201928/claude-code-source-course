# M18 事实闸门与 Codex 裁决

事实会话：`aa2bf510-01ee-4e32-841c-ddb51829d05f`

```text
FACT_A: PASS / 0
FACT_B: PASS / 0
```

## 已确认结论

- eager discovery 顺序为 Managed、User、root-to-CWD Project/Local、可选 additional dirs、AutoMem/TeamMem；additional dir 不加载 Local；
- `processMemoryFile()` 实际是 parent first、includes after；normalized real/original path、最大深度与 processed set 防循环；
- Rules directory 按 OS `readdir` 顺序深度遍历，跨平台顺序不是强保证；conditional path 使用 gitignore `ignore` 语义，而不是 picomatch；
- Project glob 相对 rule 所在 project root，Managed/User 相对 original CWD；越界 target 不匹配；
- Project/Local/Managed external includes 需项目批准，User includes 允许 external；审批检查的 force path 不等于真实 context build；
- CLAUDE.md 经 `getUserContext()` 进入 API 前置 meta user/system-reminder，不属于 default system prompt；custom prompt 仍保留 userContext；
- custom system prompt 替换 default 并跳过 systemContext，append prompt 位于 custom/default 之后；
-普通 system prompt section 缓存到 clear/compact，危险 section 每轮重算；
- nested instruction 由 @mention/read path 触发，经过 allowed-path 与 Managed/User conditional、nested dirs、CWD-level conditional 三阶段；
- `loadedNestedMemoryPaths` 防 LRU eviction 后重复注入，`readFileState` 负责变化检测与 transformed-content edit safety；
- attachment user phase 必须先完成，thread/main groups 并行但输出按声明数组稳定；
- 1 秒 AbortController 只是 cooperative，很多 getter 不观察 signal，不能称强制 timeout；
- getter error 经 `maybe()` 隔离为 `[]`；InstructionsLoaded hook 为 fire-and-forget observer，不拥有注入；
- dynamic attachment 经 internal message/normalization 进入请求，不是 filesystem instruction owner；
- compact cache reset 会让下一次 eager load reason 为 `compact`；subagent 不是主线程完整 userContext 装配的简单复制。

## Codex 边界裁决

教材必须显式指出两处弱保证：Rules 的跨平台枚举顺序、attachment timeout 的 cooperative 性。文件头“includes first”类自然语言注释若与实现冲突，以实现的 parent-first 为准。

H3-3 只迁移 source/scope/trust/revision、稳定排序、去重、request-only dynamic delta 和 content-free report；不复制私有 feature、完整 parser 或所有 attachment getter。
