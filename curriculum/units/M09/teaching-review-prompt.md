# M09 教学闸门审查任务

你是一名独立的教材教学审查者。请以准备 2026 年中国互联网大厂 Agent 开发岗、具有 Java/Spring/Python/Agent/RAG 经验但 TypeScript/Node 基础较弱的学习者视角，审查 M09 是否真正建立“从单轮取消到逻辑 SessionEnd，再到有预算进程收尾”的源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只用其学习者背景、教学深度、源码理解、实验、Harness、企业迁移和面试表达要求。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`：用户确认的 M11 质量标杆规则。
3. `D:\agent\Claude code最新\curriculum\units\M09\draft.md`。
4. 下面给出的前置摘要、学习目标与代码运行结果。

不要读取 `fact-review.md`、`fact-gate-*`、`unit-workbook.md`、Graphify、源码快照、implementation report、其他教材或历史审查结论。你不是事实闸门，不要重做全仓库调查。不得修改文件。

## 必要前置摘要

- M03 已讲 AbortSignal 是带 reason 的 one-shot 通知，不等于 kill、退出确认或 cleanup 完成；也讲过 Node event loop、子进程和幂等资源域。
- M05 已区分 Interactive、Print、SDK/Headless surface，surface 负责输入/输出与运行方式适配。
- M07 已区分 RuntimeContext、SessionState 与 RequestContext，并建立 state owner、snapshot 与 fresh read 边界。
- M08 已区分能力发现、请求投影与执行注册表，H1 仍是运行壳，不包含完整模型/Tool Loop/持久化。
- M09 应在这些基础上闭合 turn cancellation、logical SessionEnd、process graceful shutdown 与 abrupt termination；不应提前完整展开 Hook matcher、Task、MCP、Transcript 恢复或分布式 Agent Team。

## 学习目标

学习者完成后应能：

- 用自己的话和图解释 turn cancellation、SessionEnd、process graceful shutdown、hard termination 的作用域差异；
- 区分 Interactive 按键取消、外部 OS SIGINT、Print SIGINT 的不同入口与组合动作；
- 从 init 的 handler 安装走到 `gracefulShutdownSync`、first-caller owner 与最终 force exit；
- 解释 terminal/recovery hint、cleanup、SessionEnd、profile/cache、analytics 的真实顺序和价值权衡；
- 准确说明 Set + Promise.all 的调用顺序、并发完成、fail-fast 和“不取消 peer”；
- 说明 2 秒/500ms Promise.race 只停止等待，为什么 loser 可与后续阶段重叠；
- 解释 Transcript flush 的惰性注册与 drain 过程，并避免把注释中的“关键”误写成 registry priority；
- 区分 `/clear`、`/resume`、process exit 的 reason、AppState access 与进程存活差异；
- 运行 TypeScript/Python clean-room，完成正常、失败、timeout、late registration、first-owner 和 overall deadline 实验；
- 把三层 LifecycleCoordinator 接入 H1，并明确 Core 与 Surface/process boundary 的责任；
- 迁移到 Java/Spring、Kubernetes、RAG、LangGraph 和远程 Agent，设计预算、checkpoint、ACK/lease 与可观测 report；
- 用结论先行、口语化约两分钟回答资深 Agent 开发岗相关追问。

主体学习时间为 4 至 7 小时，双语言运行、破坏实验和企业方案另计。

## 已知实验与图示结果

- M09 独立 TypeScript `8/8`、Python `8/8`，TypeScript strict 通过；
- snapshot-shaped registry 实验观察到 slow/fail 均启动，聚合 await 早失败，slow peer 随后仍完成；
- H1-in-progress `12/12`，保留 S0 `15/15` 和 M05-M08 全量回归；
- H1 LifecycleCoordinator tests TypeScript/Python 各 `8/8`；
- 正文 `18/18` Mermaid 图已实际渲染，抽查全局、并发、预算、Transcript、bypass 与 Harness 图均可读；
- 正文包含 8 道资深 Agent 开发岗问题，每题给出结论先行的口语回答。

你需要审查正文是否让学习者知道这些结果证明什么，不要重新执行命令。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约或 4 至 7 小时学习闭环的问题：

- 是否由一次真实“按 Esc、clear、resume、exit”问题持续推进，而不是把退出函数拼成目录；
- 四层生命周期能否独立复述与画出，是否避免用 Ctrl+C 字样混同按键和 OS signal；
- `gracefulShutdownSync`、first owner、阶段顺序与预算是否在改变语义处讲清；
- registry 的 Set/Promise.all/race 语义是否能通过源码片段、时序图和实验形成可反驳理解；
- Transcript flush 的阶段位置、惰性注册和无 priority 边界是否清楚；
- SessionEnd 的逻辑边界、AppState access 与 process exit 是否分开；
- 18 张图是否分布在认知转折处，同时服务首次理解和复习，方向、术语、状态与正文是否一致；
- TypeScript/Python 实验是否有假设、反证、代表性破坏和结论边界，不用“测试通过”替代理解；
- H1 是否自然承接 M03/M05-M08，并明确新增契约、owner、失败语义、兼容边界与 report；
- Java/Spring、Kubernetes、RAG、LangGraph、远程 worker 和 observability 是否由生命周期机制自然推出；
- 面试问题是否像资深面试官追问，回答是否第一句给结论、约两分钟可口述、能承接源码与系统设计追问。

普通措辞偏好、标题形式、不影响学习的小缺失、完整 Hook/Task/MCP/Transcript/Agent Team 展开和理论漏洞不得列为 Issue。

## 输出要求

输出必须以以下三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，每项给出定位、学习影响、为什么实质、最小修正方向。不要重写整章，不要建议新增固定栏目或配额。如无实质问题，给出简短通过理由和剩余非阻断风险。
