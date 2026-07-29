# M03 事实闸门中性范围

独立核验当前静态源码快照中 Node event loop、Stream、child process、AbortSignal、进程信号和资源清理的决定性语义。不评价教学风格，不修改文件，不读取 Graphify 或 M03 作者材料。

源码根目录：`D:\agent\Claude code最新\claude-code-CLI`

需要回答：

1. BashTool.call、runShellCommand、Shell.exec、wrapSpawn/ShellCommandImpl 的真实调用与数据流是什么？
2. 默认 file mode 与 onStdout pipe mode 怎样处理 stdout/stderr、TaskOutput 和 progress？
3. ShellCommand 的 timeout、abort、kill、background、exit/result 和 cleanup 分别改变什么状态，谁拥有 timer/listener/child 引用？
4. 为什么 spawn 不直接接收 AbortSignal，而由 tree-kill 路径处理？signal reason `'interrupt'` 有何特殊语义？
5. child `exit` 与 `close` 的选择怎样改变包含孙进程/fd 继承时的等待边界？
6. runShellCommand 怎样用 Promise.race 组合 result、progress threshold、poller signal 与后台化？哪些 timer 被 unref？
7. createChildAbortController 与 createCombinedAbortSignal 如何传播 abort、保留或丢失 reason、清除 listener/timer？
8. cleanupRegistry 与 gracefulShutdown 怎样执行清理、设置预算和强制退出？
9. 哪些结论只适用于 POSIX、Windows、Bun 或当前输出模式，教材必须保留什么边界？

优先阅读：`src/tools/BashTool/BashTool.tsx`、`src/utils/Shell.ts`、`src/utils/ShellCommand.ts`、`src/utils/abortController.ts`、`src/utils/combinedAbortSignal.ts`、`src/utils/cleanupRegistry.ts`、`src/utils/gracefulShutdown.ts`。

输出必须以规定 FACT_A 三行开始，只报告影响事实、代表性实验或 H0 契约的实质问题，给出路径、符号和决定性语义。
