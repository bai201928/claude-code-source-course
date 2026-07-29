# M05 研究工作簿

状态：`release-candidate`

本文件是作者工作区，不是教材正文。Graphify 只用于定位候选入口；下列标为“快照事实”的结论均已回到 `claude-code-CLI/` 直接核验。

## 1. 单元问题、边界与风险

核心问题：同一个 Claude Code 为什么不能用一条“CLI 启动流程”解释？Interactive、Print、无 TTY Headless 和 SDK-facing stream-json 在哪里被选择，各自拥有什么输入、状态容器、输出协议与结束方式，又在哪里开始复用底层能力？

本单元闭合“运行表面适配器”而不提前吞掉后续专题：

- M06 详细讲参数、环境、设置来源、优先级与信任；
- M07 详细讲 bootstrap state、AppState 和初始化所有权；
- M08 详细讲系统上下文、工具与扩展能力快照；
- M09 详细讲完整启动、取消、退出与清理预算；
- M10-M15 详细讲消息、Query、模型请求和 Tool Loop。

风险：`R1`。运行分支在源码中清晰，但“SDK”“Headless”“Print”和“非交互”很容易被混称；如果把客户端标签当成运行表面选择条件，或把 SDK 类型占位文件当成真实实现，会形成实质事实错误。

## 2. Graphify 候选与直接核验

Graphify 查询命中 `src/entrypoints/cli.tsx`、`main()`、`run()`、`REPL()`、`src/cli/print.ts`、`StructuredIO`、`sdkMessageAdapter.ts` 等候选节点。图谱返回的是结构邻近和候选入口，没有直接证明所有节点处于同一条调用链。

直接核验后的边界：

- 最外层可执行入口是 `src/entrypoints/cli.tsx`。它先处理 version、内部 MCP/daemon/bridge/background 等快速路径；只有未命中快速路径时才动态导入 `src/main.tsx` 并调用其中的 `main()`。
- `main.tsx:main()` 不是只看 `--print`。`-p/--print`、`--init-only`、`--sdk-url` 或 `stdout` 非 TTY 都会把进程标为 non-interactive。
- `CLAUDE_CODE_ENTRYPOINT`/`clientType` 是来源与遥测标签；`setIsInteractive()` 才决定后续 `getIsNonInteractiveSession()` 分支。二者相关但不是同一个概念。
- Interactive 路径创建 Ink root、运行 setup/trust screens，最后由 `launchRepl()` 渲染 `App + REPL`。
- 非交互路径不创建 React/Ink tree。它创建独立 headless AppState store，动态导入 `runHeadless()`，通过 `StructuredIO` 或 `RemoteIO` 消费结构化输入并产生输出。
- `agentSdkTypes.ts` 在该快照中提供公共类型与占位函数；`query()` 等函数会直接抛出 not implemented。它不能证明外部 TypeScript/Python SDK 如何启动子进程。快照可确认的 SDK 运行边界是 CLI 侧识别 `sdk-ts`/`sdk-py` 标签、`--sdk-url` 自动选择 print + stream-json，以及 `StructuredIO` 控制协议。

证据状态：`快照事实`。

## 3. 最外层入口不是一个无条件 main

普通路径：

```text
OS / executable
-> entrypoints/cli.tsx:main()
-> 未命中 fast path
-> startCapturingEarlyInput()
-> dynamic import ../main.js
-> main.tsx:main()
-> run()
-> Commander root action
```

决定性位置：

- `src/entrypoints/cli.tsx`：局部 `main()` 约 33 行；version fast path 约 37 行；若干专用 fast path 约 70-275 行；动态导入 `../main.js` 并调用 `cliMain()` 约 294-299 行；文件末尾 `void main()` 约 302 行。
- `src/main.tsx`：导出的 `main()` 约 585 行；`run()` 约 884 行；Commander root action 约 1006 行。

含义：`claude --version`、部分 daemon/bridge/runner 命令不会创建 REPL，也不会经过普通 root action。M05 不展开每个专用子系统，但必须推翻“所有调用方式都先完整初始化再进入同一 UI”的错误模型。

## 4. 运行表面怎样被选择

`main.tsx:main()` 在完整 Commander 解析前做早期分类：

```ts
const isNonInteractive =
  hasPrintFlag || hasInitOnlyFlag || hasSdkUrl || !process.stdout.isTTY
setIsInteractive(!isNonInteractive)
initializeEntrypoint(isNonInteractive)
```

决定性位置：`src/main.tsx` 约 799-850 行；`src/bootstrap/state.ts -> setIsInteractive/getIsNonInteractiveSession` 约 1057-1067 行。

由此得到四个必须分开的概念：

| 概念 | 作用 | 不能等同 |
| --- | --- | --- |
| `--print` | 用户显式请求非交互输出 | 所有 Headless 的唯一条件 |
| non-interactive session | 后续是否跳过 Ink/REPL 并进入 headless branch | SDK 客户端语言 |
| `CLAUDE_CODE_ENTRYPOINT` | 调用来源标签，可由 SDK/其他宿主预先设置 | 运行表面的直接 owner |
| `clientType` | 统一后的 sdk/cli/remote/vscode 等客户端标签 | input/output format |

`initializeEntrypoint()` 会尊重外部已经设置的 `CLAUDE_CODE_ENTRYPOINT`；否则 non-interactive 默认记为 `sdk-cli`，interactive 记为 `cli`。随后 `clientType` 还会识别 `sdk-ts`、`sdk-py`、GitHub Action、VS Code、remote 等来源。

## 5. Interactive 的输入、状态、输出与结束

主路径：

```text
getIsNonInteractiveSession() == false
-> getRenderContext()
-> createRoot(renderOptions)
-> showSetupScreens(root, ...)
-> 构造 initialState / sessionConfig
-> launchRepl(root, appProps, replProps, renderAndRun)
-> dynamic import App + REPL
-> root.render(<App><REPL /></App>)
-> root.waitUntilExit()
-> gracefulShutdown(0)
```

决定性位置：

- `src/main.tsx`：仅 interactive 创建 Ink root 和显示 setup screens，约 2218-2242 行；普通 fresh session 最终调用 `launchRepl()`，约 3761-3806 行。
- `src/replLauncher.tsx -> launchRepl()`：动态导入 `App` 与 `REPL`，把两者装配为 React tree。
- `src/interactiveHelpers.tsx -> renderAndRun()`：`root.render()`、启动延后预取、等待 `root.waitUntilExit()`，再优雅关闭，约 98-103 行。

所有权边界：

- Ink root 拥有终端渲染生命周期；
- `App`/AppStateProvider 提供运行状态容器；
- `REPL` 拥有交互提交、主消息 UI 和持续会话体验；
- 终端屏幕是交互投影，不是供机器解析的稳定协议 stdout。

M05 只讲表面边界，不重复 M11 的 `messages/messagesRef -> query()` 细节。

## 6. Headless/Print 的输入与状态

root action 从 bootstrap state 读取 `isNonInteractiveSession`。为真时：

```text
prompt / stdin
-> getInputPrompt()
-> createStore(headlessInitialState)
-> dynamic import cli/print.ts
-> runHeadless(inputPrompt, getState, setState, ..., options)
```

决定性位置：

- `src/main.tsx -> getInputPrompt()` 约 857 行：text 输入会把命令行 prompt 与管道文本合并；`stream-json` 直接返回 stdin 的 AsyncIterable。
- `src/main.tsx` 约 2585-2855 行：创建 headless store，连接必要能力，动态导入并启动 `runHeadless()`；该分支随后 return，不再进入 REPL。
- `src/cli/print.ts -> runHeadless()` 约 455 行：没有 React tree，因此直接订阅 settings change，建立 StructuredIO、加载初始消息和运行 headless loop。

`getStructuredIO()` 会把普通 string prompt 正规化成一条序列化 `SDKUserMessage` 再交给 `StructuredIO`；如果输入本来就是 AsyncIterable，则保持流式输入。也就是说，纯文本和 SDK 协议在入口形状上不同，但 headless 内部可以复用同一个结构化 I/O 控制面。

## 7. 同一个 Headless 核心有三种输出投影

`runHeadlessStreaming()` 产生 `StdoutMessage`。`runHeadless()` 再按输出格式投影：

| 输出格式 | 对外行为 | 适合 |
| --- | --- | --- |
| `text` | 只打印最终 result 文本或简化错误 | shell 管道、人读结果 |
| `json` | 默认打印最后一个 result 对象；verbose 时可打印累计消息数组 | 单次结构化结果 |
| `stream-json` | 运行中逐条输出 NDJSON 事件/控制消息；要求 verbose | SDK、长连接宿主、实时消费 |

决定性位置：`src/cli/print.ts` 约 848-955 行。`StructuredIO.write()` 位于 `src/cli/structuredIO.ts` 约 465 行，把一条消息编码为单行 NDJSON；`outbound` 是唯一排队出口，避免 control request 越过已经排队的 stream event。

这说明“Print”不是另一个 Agent 核心，而是 non-interactive runtime 的一种输入/输出投影；同样，`stream-json` 不只是把最终文本换成 JSON，它还承载 user message、system/assistant event、permission control request/response 和 cancel control 等协议消息。

## 8. SDK 证据边界

当前快照能确认：

- `main.tsx` 能识别 `sdk-ts`、`sdk-py`、`sdk-cli` client type；
- `--sdk-url` 会默认启用 print、`stream-json` 输入输出和 verbose；
- `getStructuredIO()` 在本地 stdio 使用 `StructuredIO`，有 sdk URL 时使用 `RemoteIO`；
- `StructuredIO` 逐行解析 `SDKUserMessage`/control message，并通过 pending request map 把权限等控制请求与响应配对；
- stream-json stdout 必须保持 NDJSON 纯净，普通噪声会破坏宿主解析。

当前快照不能确认：

- 外部 TypeScript/Python SDK 包具体如何定位或启动 CLI 二进制；
- 每个 SDK 版本是否总是使用完全相同参数；
- SDK 宿主自身的重试、进程监管或 API 封装实现。

`src/entrypoints/agentSdkTypes.ts` 只是类型导出和占位函数，运行时调用 `query()` 会抛出 `query is not implemented in the SDK`。教材只能用它说明公共契约形状，不能把它画进真实 CLI 调用链。

## 9. 共享与不共享

共享：配置与工具装配的许多准备、AppState 数据形状、消息/Query/Tool 等核心能力、会话与清理基础设施。

不共享：

- 输入事件来源：PromptInput/按键 vs prompt/stdin/NDJSON；
- 状态容器形状：React tree 下的 AppState + REPL local state vs 独立 headless store；
- 输出契约：Ink screen vs final text/JSON/NDJSON；
- 人在环控制：UI dialog vs StructuredIO control request/response；
- 结束信号：root unmount/exit vs result、input close、signal 与进程 exit code。

正确的抽象不是 `if (interactive) query() else query()`，而是：

```text
Surface Adapter
-> 领域输入与 RuntimeContext
-> 共享 Agent 能力
-> 领域事件
-> Surface-specific output projection
```

## 10. 实验假设与反证条件

实验是 clean-room，不调用真实模型，也不冒充 Claude Code 原项目测试。

假设 A：interactive 与 headless adapter 可以驱动同一个 RuntimeCore。反证：Core 必须读取 TTY、输出格式或 React 对象才能运行。

假设 B：输出格式是 adapter 投影，不改变核心事件和终态。反证：同一输入在 text 与 stream-json 下让 Core 产生不同事件序列。

假设 C：stream-json 一条协议消息占一行，解析失败在进入 Core 前被拒绝。反证：非法行到达 Core，或一个事件跨多行导致宿主无法增量解析。

假设 D：interactive close 与 headless input close 都能明确结束表面，但不伪造额外业务结果。反证：关闭 adapter 后 Core 仍接受新输入，或 close 被写成 assistant success。

观察点：`surface.opened`、`input.accepted`、`core.called`、`event.received`、`output.projected`、`surface.closed`，以及 Core 收到的 command 和 adapter 实际输出。

## 11. Harness 候选契约

新增 H1-in-progress 表面层：

- `RuntimeSurface`：把外部输入转成领域 command，把领域 event 投影到具体输出；
- `InteractiveSurface`：接收逐次 prompt，输出 display update，不暴露 NDJSON 控制帧；
- `HeadlessSurface`：接收 text 或 NDJSON，支持 text/json/stream-json 投影；
- `RuntimeCore`：只接收领域 command，返回领域 event，不读取 TTY、React 或 output format；
- `SurfaceTrace`：记录适配器边界，不成为业务状态 owner。

候选决定：`merge`，前提是 TypeScript/Python 对称测试证明适配器不会改变 Core 事件语义，并且 H0 全量回归保持通过。H1 在 M05-M09 逐步完成，本单元不提前加入配置优先级、CapabilitySnapshot 或完整生命周期。

## 12. 当前证据边界

- 快照来自发布包 source map，缺少根构建元数据和原仓库测试；M05 不声称原项目可在本地完整启动或 typecheck。
- 内部入口、分支、StructuredIO 和输出投影属于 `快照事实`。
- 双语言 RuntimeSurface 实验属于 `运行验证`。
- H1 接口与企业适配器分层属于 `设计迁移`。
- Graphify 没有作为任何教材事实、图示或面试回答的最终证据。
