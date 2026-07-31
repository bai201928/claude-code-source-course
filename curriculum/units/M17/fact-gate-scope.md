# M17 事实闸门范围

## 审查目标

请独立核验当前 Claude Code CLI 源码快照中，当轻量 Context projection 仍超限时，auto/manual/session-memory compact 怎样生成 summary、建立 boundary、替换当前视图并通过 append-only Transcript 支持 resume。重点回答：

1. auto compact 的阈值、递归保护、Session Memory 优先级、失败熔断和 Query Loop continuation；
2. traditional `compactConversation()` 从 PreCompact、summary fork/fallback、PTL retry、state clear、attachment、SessionStart、boundary/summary 到 PostCompact/result 的准确顺序；
3. 普通 Pre/PostCompact hook 失败、block、timeout、cancel 是否会让 compaction 抛错或回滚；
4. summary 成功后，附件、SessionStart 或 PostCompact 基础设施失败/取消能留下哪些辅助状态变化；
5. `CompactionResult` 返回、`buildPostCompactMessages()`、query view replacement、manual command replacement 分别是谁执行；
6. Session Memory compact 如何选择 retained tail、保护 tool pairing/thinking fragments，并用 `preservedSegment` 描述 relink；
7. `useLogMessages()`、`recordTranscript()`、`insertMessageChain()`、per-file write queue 与 flush 如何协作；enqueue、append、flush 和 crash durable 是否是不同保证；
8. compact boundary 的 `parentUuid`/`logicalParentUuid`、dedup-kept messages 和 resume chain 如何工作；
9. `applyPreservedSegmentRelinks()` 对完整、stale、malformed 和缺 UUID metadata 分别如何处理；
10. boundary-only、summary-only、截断 JSONL 行、完整 boundary+summary 在小文件/大文件加载路径中能确认什么，不能确认什么；
11. 当前快照实现与 revision-gated CompactTransaction、summary provenance、repair report、original-history fallback 等 clean-room 迁移设计的边界。

只报告会影响教材事实、实验设计或 Harness 契约的实质问题。

## 源码根目录

`D:\agent\Claude code最新\claude-code-CLI`

## 优先路径与符号

- `src/query.ts`：autocompact result、yield、当前 iteration replacement 与 continuation；
- `src/services/compact/autoCompact.ts`：threshold、tracking、Session Memory 优先与 traditional fallback；
- `src/services/compact/compact.ts`：`compactConversation()`、`streamCompactSummary()`、PTL retry、`buildPostCompactMessages()`、`annotateBoundaryWithPreservedSegment()`；
- `src/services/compact/sessionMemoryCompact.ts`：retained tail、pairing invariant、result build；
- `src/services/compact/postCompactCleanup.ts`：成功后清理边界；
- `src/commands/compact/compact.ts` 与 `src/utils/processUserInput/processSlashCommand.tsx`：manual `/compact`；
- `src/utils/hooks.ts`：`executeHooksOutsideREPL()`、Pre/PostCompact wrappers；
- `src/hooks/useLogMessages.ts`：compaction 后记录触发与 parent ref；
- `src/utils/sessionStorage.ts`：`recordTranscript()`、`insertMessageChain()`、queue/drain/flush、`loadTranscriptFile()`、preserved relink、conversation chain；
- `src/utils/sessionStoragePortable.ts`：大文件 boundary scan 与 truncated JSONL handling；
- `src/utils/gracefulShutdown.ts`、`cleanupRegistry.ts`、`QueryEngine.ts`：flush 时机与上限。

## 版本与缺失边界

当前快照缺少 `src/services/compact/reactiveCompact.ts`、`src/services/contextCollapse/index.ts` 等 feature-gated 实现。只能确认现存 import、调用接口、上下游分支和注释，不得补造算法、默认 gate 或 durability。

内部实现以本地快照为最高证据。不要用 Graphify、其他教材、公开新版文档或推断改写快照事实。

## 写入限制

不要修改源码、教材、实验或 Mini Agent Harness。不要读取 M17 `unit-workbook.md`、其他 M17 文件、Graphify 输出或历史审查结论。

