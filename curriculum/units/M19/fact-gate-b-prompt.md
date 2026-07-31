# M19 事实闸门 B：同会话对照

继续当前 M19 FACT_A 会话，只检查下面的 Codex 裁决和拟写入边界，不重新总结仓库，不读取 Graphify、工作簿、Harness、正文草稿或其他单元。

## Codex 机制摘要

- Session Memory 是 `{projectDir}/{sessionId}/session-memory/summary.md`；由非 remote、auto-compact 开启时注册的 post-sampling hook 在 `repl_main_thread` 运行。阈值同时受 context-token growth、tool-call count 和自然对话边界影响；fork agent 只允许 Edit 精确文件。
- `trySessionMemoryCompaction()` 在 auto compact 先于 traditional compact；等待 extraction 有 15 秒上限和 60 秒 stale 判断；文件缺失、template、UUID 不在当前 history、post-compact threshold 或异常都回退。resumed session 的实际保留范围是从尾部反向扩展到 min/max 与 tool/API invariant，不能照注释写成“保留全部消息”。
- Auto Memory 按 canonical git root 跨 session 存放 `MEMORY.md` 索引和带 frontmatter 的 topic files。当前快照没有 candidate/accepted、TTL、revision CAS、加密、PII scanner、redaction enforcement 或多文件事务。
- `extractMemories` 在 stop 后 fire-and-forget，受 feature/Auto Memory/remote/bare gate、turn throttle、main-agent-only 和 maxTurns=5 限制；latest pending context 覆盖旧 pending，finally 执行 trailing run；headless print flush 后 soft drain。
- relevant-memory 召回扫描最多 200 个 newest headers，用 side query 选最多 5 个，prefetch 与主模型/工具并行；collect 点只消费已 settled 结果，未完成则下一 iteration 重试，dispose 时 abort；attachment 通过 meta user/system-reminder 投影并按 prior surfaced/readFileState 去重，compact 后旧 attachment 消失即可再次召回。
- Auto Dream 受 time/session/scan throttle/PID-mtime lock 约束，fork 只写 memory root，失败回滚 lock，成功没有跨文件事务。

## 已接受的 FACT_A Issue

`hasMemoryWritesSince()` 只检查 assistant `tool_use` 的 Write/Edit path，不配对 `tool_result`。主 Agent 写入失败仍会抑制后台提取并推进 cursor，因此只能称“写入意图互斥”，不能称写入成功、exactly-once 或失败安全。请核对这一 Issue 是否确实影响教材事实边界，并指出任何必要的限定。

## 拟写入教材的关键表述

1. 不把 Instruction、compact summary、Session Memory、Auto Memory 和 Transcript 合并为 context text；先按 owner/scope/lifecycle 分层，再画一次事实如何跨层流动。
2. 当前快照的 Auto Memory 是直接文件写入系统；candidate/accepted、TTL、revision 和 redaction workflow 只作为 Harness 迁移设计。
3. Session Memory 的 summary 文件是 compact 的输入材料，不等价于 Transcript，也不拥有跨 session 的长期记忆。
4. “主 Agent 写过文件就不再跑后台提取”是基于 tool_use 意图的 best-effort 互斥；失败写入窗口是代表性实验和工程迁移边界。
5. prompt 中的 what-not-to-save、freshness verify 和 team sensitive-data guidance 是模型行为指导，不等于强制治理。

## 输出要求

只报告影响快照事实、教材关键表述、实验有效性或 Harness 契约的问题；无现实影响的问题不要列出。必须以下列三行开头：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如果接受上述边界，明确写 `PASS / 0` 并说明 Issue 已被限定；若仍有问题，给出最小修正和源码理由。
