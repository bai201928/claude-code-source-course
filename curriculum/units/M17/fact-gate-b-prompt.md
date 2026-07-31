# M17 事实闸门 B：同会话对照

继续当前 FACT_A 会话。现在对照 Codex 的研究结论，只检查错误、重要遗漏、证据不足、版本混淆或推断冒充事实，不重复总结仓库。

## Codex 结论

- `shouldAutoCompact()` 从混合 token estimate 与保留 headroom 的 threshold 决定是否触发，并有 query-source recursion guard 与 feature/config gate。`autoCompactIfNeeded()` 额外拥有 consecutive-failure circuit breaker。
- `autoCompactIfNeeded()` 先尝试 Session Memory compact，再调用 traditional `compactConversation()`；traditional 失败通常返回 `wasCompacted: false`，当前 Query Loop 继续使用原 view并累计失败次数。
- traditional 顺序是 PreCompact -> summary fork/stream -> PTL group retry -> validate summary -> snapshot/clear read-file and nested-memory state -> rebuild attachments -> SessionStart -> boundary/summary -> cache/metadata side effects -> PostCompact -> return result。
- summary fork 与 streaming fallback 共享 compact abort controller；tool use 被拒绝。fork 失败会进入 fallback，fallback 仍可因已 abort signal失败。
- `executeHooksOutsideREPL()` 把普通 command/callback/http hook failure、timeout、cancel 收敛成结果。Pre/PostCompact wrapper 通常不会因单个 hook 失败而抛错；成功 Pre output进入 instructions，失败只形成 display text。外层 matching/config infrastructure 仍可能抛错。
- summary 成功后 `readFileState` 与 `loadedNestedMemoryPaths` 已清，后续 attachment/SessionStart/infrastructure failure 可让 `compactConversation()` 不返回但留下辅助内存状态变化。原 messages 尚未由该函数直接替换，不能描述成全状态回滚。
- `CompactionResult` 只是 prepared replacement payload。`buildPostCompactMessages()` 固定为 boundary -> summary -> keep -> attachments -> hook results；queryLoop yield 后切换本 iteration view并继续当前请求。manual `/compact` 返回相同 base order并附加 slash-command messages，但不继续 query。
- Session Memory compact 使用已有 memory summary，选择并扩展 retained tail，向前保护 tool pair和同 response ID fragments；`preservedSegment(head, anchor, tail)` 用于 resume relink。
- `useLogMessages()` fire-and-forget 调用 `recordTranscript()`；后者 dedup 后把新 boundary/summary 入队。boundary 写 `parentUuid: null`、旧 parent 只在 `logicalParentUuid`，dedup-kept tail 不会错误推进新 parent cursor。
- `insertMessageChain()` 返回通常只表示 append entries 已入 per-file queue；默认 drain 批量 append。`flush()` 等待队列和 tracked writes，graceful shutdown与 QueryEngine 有 flush点，但没有 compact WAL、prepare/commit marker、framing、fsync 或 hard-crash guarantee。
- `applyPreservedSegmentRelinks()` 先验证 tail-to-head，再修改 endpoint和清理旧 usage；missing/malformed segment chain 在 prune 前返回并保留完整 pre-compact Map。stale segment则按绝对最后 boundary 完整 prune。
- traditional no-segment compact 依靠 boundary root截断 reachable chain；大文件 reader还在最后 non-preserved boundary截断 input buffer。
- boundary-only crash window 没有显式 recovery state。小文件可能选择旧 user/assistant leaf，大文件 pre-boundary skip可能没有有效 leaf；在事实闸门确认前不承诺统一 fallback结果。
- 当前快照没有覆盖 summary、in-memory replacement、Transcript append 与 resume-visible chain 的单一原子事务。H3-2 的 expected revision、explicit commit state、summary provenance、repair report和 original-history fallback属于设计迁移，不是 Claude Code 快照事实。

## 拟验证实验

TypeScript/Python clean-room `CompactTransaction` 使用不可变 prepare plan 与 revision-gated commit。故障注入覆盖 summary cancel、prepared-before-commit cancel、stale writer、boundary-only、summary-only、malformed provenance、complete commit recovery和 retained-tail pairing。任何失败必须保持 original history；repair report只含 metadata。

## Harness 候选

合入 runtime-owned CompactCoordinator、expected-revision plan/commit、summary provenance、explicit recovery status、original-history fallback、metadata-only trace和双语言回归。继续 defer真实 Provider summary、tokenizer、完整 JSONL/Session Memory/Prompt Cache/distributed WAL。拒绝原地 clear、boundary-is-commit、无 revision late writer和静默截断恢复。

## 对 FACT_A 的 Codex 裁决与补证

- 接受 FACT_A 对 traditional 顺序、Session Memory 优先、boundary 双字段、多阶段副作用、缺失 gated 文件和 write queue 窗口的核验。
- 对 FACT_A issue 4 作精确修正：`executeHooksOutsideREPL()` 的逐 hook command/callback/http timeout、abort、进程失败和解析失败均在内部 catch 后返回 `succeeded: false`，不会自然抛到 compact。潜在抛出边界是 `getMatchingHooks()`、外层初始化或 `Promise.all` 之外未被逐 hook catch 的基础设施，不应把 timeout/abort/进程崩溃列为会直接终止 compact 的普通情况。
- `reAppendSessionMetadata()` 通过 `appendEntryToFile()` 同步 `appendFileSync`，所以 PostCompact 前该 append 系统调用已完成；但仍没有 `fsync`，不把它称为 hard-crash durable commit。
- `parseJSONL()` 对 malformed 或 crash-truncated 行采取 skip，而不是让整个文件解析失败。这会使 truncated summary line被忽略，不能把它视为有效 summary。
- QueryEngine 在非 bare 路径会 `await recordTranscript(messages)`，但 `recordTranscript()` 内部的普通 message append仍是 `void enqueueWrite()`，所以 await只覆盖清理、去重、入队和可能的 remote persistence，不等于 local append已完成。只有 eager/cowork等条件显式 `flushSessionStorage()`；交互式 `useLogMessages()`则整体 fire-and-forget。
- graceful shutdown优先运行 cleanup/flush，但外层对 cleanup设置约 2 秒等待预算；SIGKILL或超时仍无保证。
- boundary-only 的精确结果继续要求审查：小文件 parser保留旧 entries而 boundary是 system/non-leaf；大文件 `readTranscriptForLoad()`遇到最后 non-preserved boundary会清空 pre-boundary output。如果其后没有有效 user/assistant leaf，二者的恢复表现可能不同。请不要把这项推导直接判成统一保证。

必须以下列三行开头：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

仅报告实质问题，普通边缘问题不阻断。不得修改任何文件。
