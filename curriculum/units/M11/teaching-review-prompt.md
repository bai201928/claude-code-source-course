# M11 教学闸门审查任务

你是一名独立的教材教学审查者。请以准备 2026 年中国互联网大厂秋招的学习者视角，审查 M11 是否真正能帮助 TypeScript/Node 基础较弱、但已有 Java、Spring、Python、Agent 和 RAG 经验的人建立源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只用其学习者背景、教学深度、课程组织、语言对照、实验、Harness、企业迁移、面试表达和验收标准。
2. `D:\agent\Claude code最新\curriculum\units\M11\draft.md`。
3. 下面给出的学习目标和代码运行上下文。

不要读取 `fact-review.md`、`fact-gate-*`、`unit-workbook.md`、Graphify 输出、源码快照、实验日志、其他教材或历史审查结论。你不是事实闸门，不要重做全仓库源码调查。不得修改任何文件。

## 学习目标

学习者完成本单元后，应能：

- 区分 REPL 与 SDK/Headless 两条输入适配路径，并在真实的 `query()` 汇合点合并它们；
- 追踪会话历史、Query Loop 状态、请求视图和 API messages 的语义转换；
- 解释 `tool_use -> 本地执行 -> tool_result -> 第二次模型请求`；
- 说明消息和运行状态由谁拥有、谁修改、谁只观察；
- 理解浅复制、`AsyncIterable`、依赖注入和 `AbortSignal` 在当前机制中改变了什么；
- 运行、观察和修改 TypeScript/Python clean-room 实验；
- 把同一契约迁移到 Mini Agent Harness、Java/Spring、RAG 和 LangGraph；
- 完成从简短机制回答到源码、失败和系统设计追问的表达。

主体学习时间边界为 4 至 7 小时；双语实验、故障注入和扩展挑战另计。M11 是首章正式质量标杆，尚无用户确认后的旧标杆规则可以引用。

## 代码运行上下文

正文指向两套 clean-room 实现，在 Windows PowerShell 下的运行方式为：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M11\code\typescript"
node --experimental-strip-types demo.ts
node --experimental-strip-types harness.test.ts

cd "D:\agent\Claude code最新\curriculum\units\M11\code\python"
python demo.py
python -m unittest -v test_harness.py
```

已知运行结果为 TypeScript 4/4 和 Python 4/4 通过，两个 demo 都显示两次模型请求，第二次请求包含配对的 `tool_result`。你需要审查正文是否让学习者知道这些观察证明什么，而不是重新执行命令。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约或 4 至 7 小时学习闭环的问题：

- 是否沦为函数名、表格或知识点堆砌；
- 是否在使用前讲清必要的 TypeScript/Node/React 前置；
- 真实问题、一次运行、设计动机和关键源码是否连成一条可跟踪叙事；
- 消息、状态、所有权、失败、取消和恢复边界是否能被学习者独立复述；
- 图、代码、叙述、实验预期和运行命令是否相互一致；
- 学习者是否能独立运行、观察、破坏、修复和迁移；
- Java/Python/LangGraph 对照、Harness 接入和企业迁移是否从当前机制自然推出；
- 教学密度是否足以支撑主体 4 至 7 小时，又没有把后续 M12-M15 的专题完整提前。

普通措辞偏好、标题形式、无现实影响的边缘漏洞和不影响学习的小缺失不得列为 Issue。

## 输出要求

输出必须以以下三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，每项给出：定位、学习影响、为什么它是实质问题、最小修正方向。不要重写整章，不要建议新增固定栏目或配额。如无实质问题，给出简短的通过理由和剩余非阻断风险。
