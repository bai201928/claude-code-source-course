# M03 教学闸门审查任务

你是一名独立教材教学审查者。请以准备 2026 年中国互联网大厂秋招的学习者视角，审查 M03 是否真正能帮助 TypeScript/Node 基础较弱、但已有 Java、Spring、Python、Agent 和 RAG 经验的人，建立事件循环、Stream、子进程、取消与资源收敛的源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只使用其中学习者背景、教学深度、语言对照、实验、Harness、企业迁移、面试表达和验收标准。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`。
3. `D:\agent\Claude code最新\curriculum\units\M03\draft.md`。
4. 如需核对学习者操作，只读取 `D:\agent\Claude code最新\curriculum\units\M03\code\typescript` 与 `code\python`。

不要读取 `fact-review.md`、`fact-gate-*`、`unit-workbook.md`、Graphify、Claude Code 源码快照、实验日志、其他教材或历史审查结论。你不是事实闸门，不要重做源码调查。不得修改任何文件。

## 必要前置摘要

M01 已经讲过判别联合、类型收窄、编译期类型与运行时状态的区别；M02 已经讲过 Promise、AsyncGenerator、AsyncIterable、`yield*`、手动 `.next()`、early return 与 `finally`。M03 可以复用这些概念，但必须就地解释它们怎样连接 timer、Readable、child process、AbortSignal 和 cleanup。

## 学习目标

学习者完成本单元后，应能：

- 解释 `await` 让出当前 async function 后，microtask、timer、I/O 和 child 事件怎样改变可见状态；
- 沿 BashTool.call、runShellCommand、Shell.exec 和 ShellCommandImpl 跟踪长命令从 spawn、输出、progress 到完成/后台/取消；
- 区分默认 file mode 与 `onStdout` pipe mode，不把所有输出误画成 Readable data event；
- 说明 child、timeout、abort listener、TaskOutput、result resolver 和 background task 的所有权；
- 区分 timeout、abort、kill、background、logical result 与 OS exit confirmation；
- 解释 `exit`/`close`、`Promise.race`/`unref`、parent/combined AbortSignal 和有预算 graceful shutdown 的边界；
- 运行 TypeScript/Python clean-room 实验，验证 requested -> exited -> cleanup，并完成有目的的破坏；
- 把 CancellationScope、ResourceScope、Clock 和 ProcessPort 合入 H0，同时说明它们是设计迁移；
- 迁移到 Java/Spring、Python asyncio、LangGraph 和企业资源治理；
- 用资深 Agent 开发岗位的两分钟口语回答，把 Node 语义讲到 Claude Code 设计、平台边界和生产契约。

主体学习时间为 5.5 至 7 小时，双语言子进程实验、故障注入和扩展挑战另计。

## 已知运行结果

当前环境为 Windows、Node.js 24.14.1、Python 3.11。

TypeScript：5/5 行为测试通过，demo 正常，strict typecheck 通过。Python：5/5 `unittest` 通过，demo 正常。取消实验共同观察到：

```text
cancel.requested -> process.exited -> cleanup.finished
```

TypeScript 的 Windows 观察值为 `exitCode: null, signal: SIGTERM`；Python 为平台 numeric code。正文应只把生命周期顺序作为共享契约。

12 张 Mermaid 图已使用 Mermaid CLI 11.12.0 逐张实际渲染成功。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约或 5.5 至 7 小时学习闭环的问题：

- 是否从一条真实长命令推动叙事，而不是 Node API 清单；
- event loop、microtask、timer、Readable、child event、AbortSignal 和 cleanup 是否在首次改变语义时讲清；
- file/pipe 两种输出路径、owner 转移和 progress/result 竞速是否可跟踪；
- timeout、abort、kill、background、logical completion、exit confirmation 与 resource cleanup 是否始终分层；
- 12 张图是否位于真实认知转折处，每张可独立复习，且图文、方向、状态和失败路径一致；
- 运行命令、测试、demo、typecheck 和六次破坏是否说明各自证明与未证明的范围；
- Python、Java/Spring、LangGraph、H0 和企业 shutdown/资源治理是否由当前机制自然推出；
- 8 道面试题是否像资深 Agent 开发面试官的真实追问，回答是否结论先行、口语自然、约两分钟，并能落到 Claude Code 设计和工程边界；
- 是否达到主体学习深度，又没有提前吞掉 M09 的 CLI 生命周期、M15 的工具并发、M36 的后台任务完整机制或 M39 的安全治理。

普通措辞偏好、标题形式、无现实影响的理论漏洞和小型格式问题不得列为 Issue。

## 输出要求

输出必须以以下三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，每项给出定位、学习影响、为什么实质、最小修正方向。不要重写整章，不要建议固定栏目或数量配额。无实质问题时给出简短通过理由和剩余非阻断风险。
