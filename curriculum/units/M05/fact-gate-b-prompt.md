# FACT_B 同会话对照提示词

继续 FACT_A 会话，把独立结论与以下 Codex 摘要、教材边界和实验设计逐项对照。只在明确冲突时定向回读源码，不要扩大到 M05 之外的系统，不要修改任何文件。

## Codex 源码摘要

- `src/entrypoints/cli.tsx` 是最外层 bootstrap entrypoint。version、内部 MCP/daemon/bridge/background/runner 等若干 fast path 会提前返回；普通路径才动态导入 `src/main.tsx` 并调用其 `main()`。
- `main.tsx:main()` 以 `-p/--print`、`--init-only`、`--sdk-url` 或 stdout 非 TTY 判定 non-interactive，并写入 bootstrap state。`--print` 不是唯一条件。
- `CLAUDE_CODE_ENTRYPOINT` 和 `clientType` 是调用来源/遥测标签；`setIsInteractive()` 与后续 `getIsNonInteractiveSession()` 才控制 root action 的运行表面分支。外部已经设置的 SDK entrypoint 会被保留。
- Interactive 分支才创建 Ink root、显示 setup/trust screens，并通过 `launchRepl()` 动态装配 `App + REPL`；`renderAndRun()` render 后等待 root exit，再 graceful shutdown。
- non-interactive 分支创建独立 headless AppState store，动态导入 `runHeadless()` 后 return，不进入 REPL。`getInputPrompt()` 对 text 合并 prompt/stdin，对 stream-json 返回 stdin AsyncIterable。
- `runHeadless()` 使用 `getStructuredIO()`：普通字符串先正规化为序列化 `SDKUserMessage`，AsyncIterable 保持流式；本地使用 `StructuredIO`，有 `sdkUrl` 时使用 `RemoteIO`。
- 同一个 `runHeadlessStreaming()` 事件流被投影为 final text、single/full JSON 或逐条 NDJSON。`StructuredIO.outbound` 是事件与 control request 的单一排队出口，`write()` 每次输出一条 NDJSON。
- 当前快照只证明 CLI 侧的 SDK-facing stream-json/control protocol 和 sdk client labels。`entrypoints/agentSdkTypes.ts` 的 `query()`、session 函数等是抛出 not implemented 的占位导出，不能作为外部 TypeScript/Python SDK 运行调用链证据。
- 教材只在 M05 建立 Surface Adapter 边界；配置优先级、AppState 初始化细节、CapabilitySnapshot、完整退出、Query/Tool Loop 分别留给 M06-M15。

## Clean-room 实验与 H1 候选契约

TypeScript/Python 将实现同一 `RuntimeSurface -> RuntimeCore -> DomainEvent -> output projection` 契约：

1. Interactive 与 Headless 两个 adapter 驱动同一个 scripted Core；Core 不读取 TTY、React 对象或 output format。
2. 同一 command 在 interactive、text、json、stream-json 下产生同一 core event 顺序，只改变输出投影。
3. stream-json 每个事件严格一行，非法输入在 Core 调用前被拒绝。
4. surface close 后拒绝新输入；close 只结束 adapter，不伪造 assistant success。
5. Trace 区分 `input.accepted`、`core.called`、`event.received`、`output.projected` 和 `surface.closed`。

这些实验只验证课程的 RuntimeSurface 设计迁移，不冒充 Claude Code 官方测试，不复制 React、Commander、StructuredIO 全部实现，也不提前实现 M06-M09。

输出必须以三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

只报告事实错误、重要遗漏、证据层次混淆或实验/H1 契约无效。无问题写 `No material issues`。

