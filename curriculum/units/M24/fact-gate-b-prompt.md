# M24 FACT_B：同会话对照

继续 FACT_A 会话，只核对下面的 Codex 结论，不重新总结仓库。

## Codex 结论

- `Project` 惰性物化 session file；metadata/hook 等可先缓冲，第一条 user/assistant 才创建文件。`appendEntry()` 的多数路径以 `void enqueueWrite()` 入内存队列，所以 `await recordTranscript()` 可以早于物理 append 返回。`flush()` 等待 drain/append 完成，但代码没有把普通文件 append 扩大为 fsync、跨机器复制或外部事务。
- QueryEngine 在模型前先请求记录用户消息；eager/cowork 与若干 terminal/cleanup 路径显式 flush。默认路径仍有 enqueue 后未 drain 的 crash window。cleanup 先 flush，再同步把 metadata 重写到尾部以维持 resume picker 的 tail-read 可见性。
- 主 Transcript 对 message UUID 去重；local agent sidechain 为了保存 fork-inherited UUID 的完整上下文，局部写故意绕过主文件 dedupe set。sidechain UUID 不能加入主文件 set，否则后续主链会跳过真实写入并产生 dangling parent。
- `parseJSONL()` 按行解析并跳过任意 malformed line，半写尾行不会阻断完整前缀；但中间坏行可能删除 parent 节点并导致 chain 截断。`loadTranscriptFile()` 的外层 read/parse 失败会返回空结构，因此 availability 优先不等于恢复完整性可证明。
- Transcript message 由 UUID/parentUuid 构成 DAG。`loadTranscriptFile()` 计算 user/assistant leaf，`buildConversationChain()` 从最新 leaf 逆向走单 parent；cycle 返回 partial chain，dangling parent 自然截断。读侧再按 provider message ID 与 tool-result assistant parent 补回 parallel assistant/tool_result siblings。compact preserved segment 和 Snip 也需要读侧 relink/removal。
- `filterUnresolvedToolUses()` 删除“其全部 tool_use ID 都没有任何 tool_result”的整条 assistant message；它不额外判断该 message 是否有 text。若同一 assistant message 同时包含 resolved 与 unresolved tool_use，当前函数会保留整条消息。之后还过滤 orphan thinking 与 whitespace-only assistant。
- 尾部有效 assistant 通常视为 completed；普通 user 是 interrupted prompt；非终止 tool_result 或 attachment 可形成 interrupted turn；terminal tool result 有特殊排除。mid-turn 会追加 meta continuation，并在尾部 user 后插 assistant sentinel 保持 API-valid。
- Headless auto-resume 在环境开关启用时删除 interrupted user/sentinel，再向当前进程队列入队一次。它不提供跨多次崩溃的 durable prompt exactly-once，更不证明外部 tool effect exactly-once。
- Normal resume 复用 leaf/session ID，adopt 旧 Transcript，并分别恢复 metadata、cost、file history、attribution、todo、agent/model、context-collapse、replacement state 与存在的 worktree。worktree 用 `process.chdir()` 作实际存在性检查，缺失时回退并记录 exited。
- Fork 保留 fresh session ID和新文件，不接管原 worktree；branch path 会重写 sessionId/parent chain、保留 forkedFrom，并以 fork session ID seed content-replacement records。共享历史不等于共享未决执行 owner。
- `resumeAgentBackground()` 从 sidechain messages、replacement records、agent metadata 与可选 worktree 重新组装输入，然后注册新的 live Runtime Task/AbortController attempt。旧进程是否已经完成外部副作用不能仅由缺失 tool_result 的 Transcript 确认。

## H6 clean-room 契约

Harness 实现 persistence-neutral `TranscriptStore`、JSONL partial-tail/malformed report、`RecoveryReducer`、`ResumeCoordinator`、effect/background journal 和 scheduler takeover：

- record ID 幂等，message ID conflict 显式报告；
- cycle/dangling/parallel sibling/unresolved pairing 恢复不宣称完整；
- effect journal 以 `prepared -> attempted -> committed` 分类：prepared 可由 dispatcher 决定是否启动，attempted-without-commit 为 indeterminate，committed 不重放；
- 非 terminal background attempt 作为 orphaned 交给 supervisor，不复活旧 controller；
- normal resume 复用 session；fork mint 新 session/message/record ID，只保留 source mapping，不复制未决 effect/background ownership；
- `DurableScheduler` pending trigger 以同一 trigger ID 交付，只有显式 commit 才删除/推进；这仍要求下游 idempotency/outbox；
- RecoveryReport 只含 ID、status、revision 与 count，不含 prompt/tool/result payload。

只报告会改变上述快照事实、实验或 H6 契约的实质问题。特别核对 FACT_A 摘要中“无 text 才过滤”和“prompt-level exactly-once”是否为过度表述。必须以下列三行开头；接受时明确 PASS / 0。

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```
