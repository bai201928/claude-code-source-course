# M19 作者工作簿：Session Memory、Auto Memory 与跨会话召回

状态：`researched`

本文件是作者工作区，不是教材正文。Graphify 只提供候选入口；以下结论必须以 `claude-code-CLI/` 当前源码快照、事实闸门和独立实验为准。

## 单元问题与边界

真实问题不是“怎样把一段摘要拼进 prompt”，而是：同一句“用户偏好 X”可能同时出现在当前消息、compact summary、Session Memory、Auto Memory topic file 或 Transcript 中。这些对象的 owner、scope、更新时机、恢复能力和可信度完全不同。

M19 必须分开四类状态：

```text
Instruction：环境/政策输入，M18 已讲
Compact summary：替换 Query 历史的压缩结果，M17 已讲
Session Memory：当前 session 的滚动 summary.md，可供 SM compact 使用
Auto Memory：按项目持久化的 topic files + MEMORY.md，可跨会话召回
Transcript：append-only 运行记录，M24 再完整讲恢复
```

风险为 R2：涉及后台 fork、直接文件写、跨会话 scope、并发 coalescing、取消、soft drain、相关性 side query、stale memory 和 compact/recovery。设计包中的 `candidate/accepted`、TTL、revision 和 redaction workflow 不是已确认源码事实，必须先审查当前快照是否真实存在。

## Graphify 候选结果

图谱词表扩展：`session memory compact summary extract restore context transcript candidate auto load persist`。

有价值候选：

- `src/services/SessionMemory/sessionMemory.ts -> extractSessionMemory`；
- `src/services/compact/sessionMemoryCompact.ts -> trySessionMemoryCompaction`；
- `src/services/extractMemories/extractMemories.ts`；
- `src/memdir/memdir.ts`、`paths.ts`、`findRelevantMemories.ts`、`memoryScan.ts`；
- `src/utils/attachments.ts -> startRelevantMemoryPrefetch`；
- `src/services/autoDream/`；
- `src/query/stopHooks.ts`、`src/query.ts`、`src/QueryEngine.ts`。

图谱同时返回大量共享导入邻接，不能据此声明运行调用。以下链均来自直接源码核验。

## Session Memory 直接源码链

启动与 owner：

- `setup.ts -> initSessionMemory()` 仅在非 bare setup 注册 post-sampling hook；remote mode 跳过，auto compact 关闭时不注册；feature gate 在 hook 实际运行时懒检查。
- `sessionMemoryUtils.ts` 的 module state 拥有 config、`lastSummarizedMessageId`、`extractionStartedAt`、`tokensAtLastExtraction` 和 initialized flag。
- 文件 owner 是 `{projectDir}/{sessionId}/session-memory/summary.md`，mode 0700/0600；因此是 project 内的 session-scoped side file，不是跨 session Auto Memory。

触发与更新：

- 仅 `querySource === 'repl_main_thread'`；阈值使用当前 context token count、相对上次 extraction 的 token growth、tool call count 和最后 assistant turn 是否仍有 tool call。
- `shouldExtractMemory()` 在决定触发时先推进 closure 内 `lastMemoryMessageUuid`；真正成功后才记录 token count 和 `lastSummarizedMessageId`。
- `extractSessionMemory` 由 `sequential()` 串行化，创建隔离 setup context，读取/初始化 summary.md，使用 `runForkedAgent(querySource='session_memory')`，只允许 Edit 精确的 memory path。
- 自动 extraction 没有 `try/finally`；异常由 post-sampling registry 捕获，`extractionStartedAt` 可能保留到 `waitForSessionMemoryExtraction()` 识别为一分钟 stale。手动 `/summary` 路径有 finally。
- `lastSummarizedMessageId` 只有最后 assistant turn 无 tool call 时才推进，避免把 tool_use 与 result 之间当作已总结边界。

与 compact 的协作：

- `autoCompactIfNeeded()` 先尝试 `trySessionMemoryCompaction()`，失败/null 才 traditional compact；手动 compact 也有对应调用点。
- SM compact 等待 extraction，最多 15 秒；一分钟以上视为 stale 并继续。读取不到文件、文件仍是 template、summarized UUID 不在当前 messages、post-compact 超 threshold 或内部异常都回退 traditional。
- summary.md 被截到每 section/总预算后包装为 compact summary；保留 tail 还要满足 min tokens、min text messages、max cap、tool pair、同 API message.id thinking block 与 last compact boundary floor。
- resumed session 没有 in-memory `lastSummarizedMessageId` 时，从尾部反向扩展到最低保留量/上限；源码注释称 “keep all messages” 与实现不一致，必须由事实闸门裁决。
- SM compact 成功后 old summarized UUID 被清空；下一轮 extraction 重新建立边界。

## Auto Memory 持久化链

scope 与 prompt：

- `isAutoMemoryEnabled()` 默认开启，但 env、bare、无 persistent storage 的 remote 和 settings 可关闭。
- 默认目录是 canonical git root 映射后的 `~/.claude/projects/<slug>/memory/`；worktree 共享 canonical git root。可信 settings source 才能 override，project settings 被排除；Cowork env override 有单独安全语义。
- default system prompt 的 `memory` section 注入 memory mechanics。Custom system prompt 只有显式 Cowork path override 时补入 mechanics。
- topic file 使用 frontmatter `name/description/type`；`MEMORY.md` 是上限 200 行/约 25KB 的索引，不是 topic content。
- 传统模式下 `MEMORY.md` 作为 AutoMem 经 `getUserContext()` 注入；relevance gate 开启时 `filterInjectedMemoryFiles()` 移除 AutoMem/TeamMem index，改走 topic relevance attachment。

写入：

- 主 Agent 从 memory mechanics prompt 获得直接 Write/Edit 能力；当前快照没有独立 candidate/accepted store。
- `extractMemories` 在完整 query loop stop 后 fire-and-forget 运行受限 fork。它只处理 main agent，受 build/runtime gate、Auto Memory、remote/bare 和 turn throttle 控制。
- 若主 Agent 的 assistant tool_use 已指向 Auto Memory path，后台 fork 跳过并推进 cursor。该检测不读取 tool_result 成功状态，需事实闸门判断应如何表述弱保证。
- fork 先扫描最多 200 个 newest topic headers，再直接更新 topic/index；只允许 read tools、read-only Bash、Auto Memory 目录内 Write/Edit，`skipTranscript: true`、`maxTurns: 5`。
- cursor 只在 fork 没抛错后推进；写入路径和用户可见 Saved message 从 assistant tool_use 提取，也没有与 tool_result 成功状态配对。
- 同时到来的 stop context 不并发执行：只保留 latest pending context，当前 run finally 中递归执行一个 trailing run。headless/print 在响应 flush 后 soft drain，默认 60 秒；interactive 不阻塞主回复。

## Auto Memory 召回链

- `scanMemoryFiles()` 递归读取 `.md` frontmatter，排除 MEMORY.md，按 mtime newest-first，最多 200 个。
- `findRelevantMemories()` 使用 side query 和 JSON schema从 filename/description 中选择，验证返回 filename；实际 caller 最多取 5 个。
- `queryLoop()` 每个 user turn 入口启动一次 relevance prefetch；只接受至少两个词的真实 user prompt，并受 session-total bytes 限制。
- prefetch 与模型流/工具执行并行。post-tools collect 点只在 promise 已 settled 时消费；未完成则零等待，下一次 loop iteration 再试。若 turn 在它完成前结束，则 dispose abort，当前轮没有注入。
- selected topic 被限行/限 bytes 读取，生成带 mtime/freshness 的 `relevant_memories` attachment，再 normalization 为 meta user/system-reminder message。
- prior attachment、`readFileState` 和 `collectSurfacedMemories()` 共同去重；mark 必须发生在 filter 之后，避免 prefetch 自己把自己过滤掉。compact 移除旧 attachments 后允许重新 surfacing。

## Auto Dream consolidation

- 每轮 stop 后异步尝试；非 KAIROS、非 remote、Auto Memory enabled 且 autoDream gate open。
- 顺序是 time gate -> 10 分钟 scan throttle -> touched session count -> PID/mtime lock。
- fork 可读 transcript 与 memory，只能在 memory root 写；`skipTranscript: true`，通过 DreamTask 暴露进度和取消。
- lock 文件 mtime 同时代表 lastConsolidatedAt；acquire 时先更新时间，成功不再次 stamp；失败回滚到 prior mtime，crash 由 dead PID/stale reclaim。
- consolidation 直接修订/删除 topic 与 index，没有 candidate approval、事务性多文件 commit 或 revision CAS。

## 当前证据边界与待审

- `快照事实候选`：以上入口、scope、触发、tool boundary、召回 prefetch、coalescing 与 compact fallback。
- `弱保证候选`：Session extraction error 后 stale marker、SM wait soft timeout、headless drain soft timeout、relevance prefetch zero-wait、memory write success 只由 tool_use path 推断、topic/index 非原子。
- `源码缺口候选`：无显式 candidate/accepted、TTL、revision CAS、加密、PII scanner、统一 redaction、跨文件事务或强 crash durability。
- prompt 中有 what-not-to-save、team sensitive-data warning、freshness/verify guidance；这属于 model behavior guidance，不等于 enforcement。
- M24 才展开 Transcript 链重建；M19 只讲 Auto Dream 读取 transcript 和 Memory/Transcript 证据等级差异。

## 独立实验与 H3 候选

独立双语言 `MemoryLifecycle` 计划验证：

1. observed candidate 不能未经 accept 进入 recall；
2. scope 隔离 project/session；
3. duplicate candidate 合并并保留 provenance；
4. stale expected revision 拒绝；
5. retention expiry 不进入 projection；
6. compact 只改变 session summary，不覆盖 accepted long-term memory；
7. recall view 有稳定 budget/order；
8. metadata report 不含 memory content。

Harness H3-4 候选：独立 `MemoryStore` 和 `MemoryProjector`，使用 `candidate -> accepted | rejected -> superseded | expired` 生命周期、scope/provenance/revision/retention、显式 accept、content-free Trace，并与 InstructionCatalog、ConversationStore、CompactCoordinator 分权。

Merge 候选：candidate lifecycle、explicit scope、provenance、revision-gated accept/update、retention、bounded recall、compact orthogonality、双语言行为镜像。

Defer：磁盘/数据库持久化、加密、PII/DLP、embedding/vector recall、distributed writer、team sync、Auto Dream、Transcript reducer。

Reject：模型观察直接进入 accepted memory、把 compact summary 当 long-term memory、把 Transcript 当 curated memory、无 scope 全局 Map、last-write-wins、Trace 记录正文、TTL 删除唯一审计记录。

