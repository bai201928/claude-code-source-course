# M19 事实闸门中性范围

## 审查目标

独立确认当前快照中 Session Memory、Auto Memory 写入/召回、Session-Memory Compact 与 Auto Dream 的真实运行关系。重点回答：

- Instruction、compact summary、Session Memory、Auto Memory 与 Transcript 是否为不同 owner/scope；
- Session Memory 的注册、触发阈值、文件位置、fork 权限、游标、失败和 compact fallback；
- resumed session 的实际 tail 保留行为；
- Auto Memory 的 enable/path scope、memory mechanics、MEMORY.md 与 topic file 分工；
- 主 Agent 写入与后台 extractMemories 的触发、互斥、coalescing、cursor、soft drain 和失败可见性；
- relevant-memory scan/select/prefetch/read/normalize/dedupe 的真实时序与取消边界；
- Auto Dream 的 gate、session scan、lock、fork、取消、成功和失败回滚；
- 当前快照是否存在独立 candidate/accepted、TTL、revision CAS、redaction enforcement 或事务性多文件 commit。

## 源码根目录

`D:\agent\Claude code最新\claude-code-CLI`

## 建议优先读取

- `src/services/SessionMemory/sessionMemory.ts`
- `src/services/SessionMemory/sessionMemoryUtils.ts`
- `src/services/SessionMemory/prompts.ts`
- `src/services/compact/sessionMemoryCompact.ts`
- `src/services/compact/autoCompact.ts`
- `src/services/extractMemories/extractMemories.ts`
- `src/services/extractMemories/prompts.ts`
- `src/memdir/memdir.ts`
- `src/memdir/paths.ts`
- `src/memdir/memoryScan.ts`
- `src/memdir/findRelevantMemories.ts`
- `src/memdir/memoryTypes.ts`
- `src/utils/attachments.ts`
- `src/utils/messages.ts`
- `src/utils/claudemd.ts`
- `src/query.ts`
- `src/query/stopHooks.ts`
- `src/services/autoDream/autoDream.ts`
- `src/services/autoDream/consolidationLock.ts`
- `src/services/autoDream/consolidationPrompt.ts`
- `src/utils/hooks/postSamplingHooks.ts`
- `src/utils/permissions/filesystem.ts`
- `src/QueryEngine.ts`
- `src/setup.ts`
- `src/cli/print.ts`

优先核对真实调用者、feature/build gate、comments 与 implementation 不一致处、tool_result 是否参与写成功判断、module/closure/file state owner，以及 error/abort/timeout 是否真正停止底层工作。

## 版本与输出边界

- 只审当前本地快照的内部事实，不用新版公开行为改写快照。
- 不读取 Graphify、M19 工作簿、Codex 结论、拟写正文、Harness 或其他单元审查。
- 不修改源码、教材或 Harness。
- 只报告会改变运行机制、状态 owner、失败/恢复、安全或教材核心表述的问题；不扩散到完整 Transcript、Team sync、Agent Memory 或所有 memory prompt 文案。

