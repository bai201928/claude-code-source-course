# M05 事实闸门中性范围

独立核验当前静态源码快照中 Claude Code 可执行入口、Interactive/Print/Headless/SDK-facing 运行表面的选择条件、输入输出协议、状态容器和结束边界。不评价教学风格，不修改文件，不读取 Graphify 或 M05 作者材料。

源码根目录：`D:\agent\Claude code最新\claude-code-CLI`

需要回答：

1. `src/entrypoints/cli.tsx` 哪些路径会在加载完整 `main.tsx` 前返回？未命中 fast path 时怎样进入 `main.tsx:main()`？
2. `main.tsx:main()` 用哪些条件设置 interactive/non-interactive？`--print` 是否是唯一条件？
3. `initializeEntrypoint()`、`CLAUDE_CODE_ENTRYPOINT`、`clientType` 与 `setIsInteractive()/getIsNonInteractiveSession()` 各承担什么职责？来源标签是否等于运行表面选择？
4. Commander root action 在哪里读取 non-interactive 状态并分叉？哪些准备共享，哪些只在 Interactive 或 Headless 分支发生？
5. Interactive 路径怎样创建 Ink root、显示 setup screens、装配 `App + REPL`、等待 UI 退出并进入 graceful shutdown？
6. Headless 路径怎样取得 prompt/stdin、创建 AppState store、调用 `runHeadless()`；为什么它不创建 React/Ink tree？
7. `getInputPrompt()` 与 `getStructuredIO()` 怎样处理 text、piped stdin 和 stream-json AsyncIterable？普通字符串是否也会被正规化为结构化 user message？
8. `runHeadless()` 的 text、json、stream-json 输出分别是什么；`StructuredIO.outbound/write/processLine` 怎样维持 NDJSON 和 control request/response 边界？
9. `--sdk-url` 会修改哪些默认项？快照能确认哪些 SDK-facing 行为，不能从 `entrypoints/agentSdkTypes.ts` 的类型/占位函数推断什么？
10. Interactive 与 Headless 共享哪些核心能力，又在哪些输入、状态 owner、输出、人机交互和退出语义上不同？
11. 当前快照缺少哪些构建、测试或外部 SDK 实现证据；最小 clean-room 实验应观察什么才能验证 RuntimeSurface 适配器契约？

优先阅读：

- `src/entrypoints/cli.tsx`
- `src/main.tsx -> main/run/Commander root action/getInputPrompt`
- `src/bootstrap/state.ts -> setIsInteractive/getIsNonInteractiveSession/setClientType`
- `src/replLauncher.tsx`
- `src/interactiveHelpers.tsx -> renderAndRun`
- `src/cli/print.ts -> runHeadless/runHeadlessStreaming/getStructuredIO`
- `src/cli/structuredIO.ts -> StructuredIO`
- `src/entrypoints/agentSdkTypes.ts`

输出必须以规定 FACT_A 三行开始。只报告影响运行表面事实、代表性实验或 H1 RuntimeSurface 契约的实质问题；普通重构建议、防御性漏洞、未要求展开的专用 fast path 和格式问题不得列为实质 Issue。

