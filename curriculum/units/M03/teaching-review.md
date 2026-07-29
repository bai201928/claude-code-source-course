# M03 教学闸门记录

状态：`teaching-reviewed`

审查会话：`e61d1d22-acaa-4c40-b58b-c3f0d49b0153`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max。进程自然退出，无应用层超时，无权限拒绝。

## 闸门结果

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

原始输出在读取说明后给出固定三行；以上是审查者原样结论，不是 Codex 改写。

## 通过理由

审查确认：

- 正文由一条真实长命令推动，事件循环、Stream、子进程、AbortSignal 与清理组成连续运行链，不是 Node API 清单；
- BashTool.call、runShellCommand、Shell.exec、ShellCommandImpl 的调用、输出、进度、取消和所有权可以被学习者跟踪；
- timeout、abort、kill、background、logical completion、OS exit confirmation 与 cleanup 始终分层；
- 12 张局部图均位于认知转折处，每张回答一个主问题，图文、方向、状态和失败路径一致；
- TypeScript 5/5、Python 5/5、demo、strict typecheck 与六次破坏说明了证明范围和反证条件；
- Java/Spring、Python asyncio、LangGraph、H0 和企业资源治理均由当前机制自然推出；
- 8 道面试题具有资深 Agent 开发岗位的真实追问价值，回答结论先行、口语自然，并落到 Claude Code 决定性设计与平台边界；
- 内容达到 5.5 至 7 小时主体深度，没有提前吞掉后续 CLI 生命周期、工具并发、后台任务或安全治理专题。

## 非阻断观察与 Codex 裁决

章首图的模型节点只用于交代 Bash tool_use 的来源；正文从 BashTool.call 开始，不会误导本章范围。`.then()` 与 cwd 可见性段落密度高，但局部时序图和运行实验已经提供足够支撑。ProcessPort 目前是 H0 契约，M04 将补齐累计 Harness 测试骨架。Python 使用 asyncio.Event 而非模拟 AbortSignal，符合“同一行为契约、各自生态实现”。这些都不影响事实、理解、实验或 H0 契约，不消耗复审轮次。

结论：M03 可同步为阶段发布前候选稿。
