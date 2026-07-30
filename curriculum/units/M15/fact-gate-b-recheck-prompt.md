# M15 事实闸门 B 定向复审

继续同一个 M15 事实会话。Codex 接受上轮两个问题并修订如下：

1. 明确限定：Bash sibling-error cascade 和 per-tool `interruptBehavior` 只属于 `StreamingToolExecutor`。response-complete `runTools()` 没有这两项；它用共享 Query abort，Bash error result 后继续后续工具。
2. 明确记录 deprecated alias 差异：response-complete 能进入 `runToolUse()` 的 base-tool alias fallback；streaming `addTool()` 会在此前用 current definitions 查找，unknown 时提前返回 synthetic error。
3. Harness 的统一 executor 是设计迁移，会显式选择一致的 sibling-error、interrupt、alias 和 context-modifier 策略，不声称快照两条路径已经一致。实验会分别证明快照差异，并验证 clean-room 选择。
4. 其余已确认结论保持：真实 block 决定 follow-up，动态 safe 分类，Hook allow 仍受 deny/ask rule 覆盖，所有退出形成 paired result，结果完成后才构造下一轮。

只检查上述修订是否消除了实质事实错误，或是否仍有新的关键冲突。不要扩散到完整 Permission/Sandbox/MCP 专题，不报告措辞和边缘问题。

必须以下列三行开头：

```text
GATE: FACT_B_RECHECK
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

不得修改任何文件。
