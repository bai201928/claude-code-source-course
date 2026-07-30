# M03 已并入 M01–M04 合并教材

M03 原有的事件循环、Node Stream、Bash 子进程、timeout、AbortSignal、kill、background、cleanup 和 graceful shutdown 内容，已经从“用户按下 Ctrl+C 后到底发生什么”的大众场景出发，重构并糅合到统一教材：

> [Claude Code 源码拆解：一个工业级 Agent 为什么不能只靠 `while (true)`](../M01/final.md)

请重点阅读统一教材中的：

- **第二章：敲下回车后，Agent 内部发生了什么**
- **第五章：`await` 之后还有资源生命周期**
- **第七章：工业级 Agent Harness 的最小骨架**
- **第八章：三个最值得亲手做的实验**
- **第九章：资深 Agent 开发岗高频面试题**

原 M03 的独立长篇不再维护，避免初学者一开始就被 Node 运行时和平台分支淹没。M03 下的 TypeScript/Python 子进程实验仍保留，供理解正文后继续深入。