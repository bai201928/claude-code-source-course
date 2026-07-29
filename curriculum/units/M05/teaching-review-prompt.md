# M05 教学闸门审查任务

你是一名独立的教材教学审查者。请以准备 2026 年中国互联网大厂 Agent 开发岗位的学习者视角，审查 M05 是否真正能帮助 TypeScript/Node/React 基础较弱、但已有 Java、Spring、Python、Agent 和 RAG 经验的人建立“多运行表面与共享 Agent 核心”的源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只使用其中的最高需求、学习者背景、教学深度、课程组织、语言对照、实验、Harness、企业迁移、面试表达和验收标准。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`：用户已经确认的 M11 标杆规则。
3. `D:\agent\Claude code最新\curriculum\units\M05\draft.md`。
4. 本提示词中的学习目标、必要前置与代码运行上下文。

不要读取 `fact-review.md`、`fact-gate-*`、`unit-workbook.md`、`implementation-report.md`、Graphify 输出、源码快照、其他教材或历史审查结论。你不是事实闸门，不要重做全仓库源码调查。不得修改任何文件。

## 必要前置

学习者已通过 M01-M04 掌握：TypeScript 判别联合与运行时校验、AsyncIterable/AsyncGenerator、取消与资源清理、调用/所有权/快照 Trace。M05 可以复用这些概念，但在它们改变当前运行表面语义时仍应就地解释。

## 学习目标

完成 M05 后，学习者应能：

- 从 OS 入口追踪 fast path、`main.tsx` 分类到 Interactive/Headless 分叉；
- 解释 `--print`、non-interactive、`CLAUDE_CODE_ENTRYPOINT` 和 `clientType` 为什么不能混为一谈；
- 对比 Ink root/App/REPL 与 headless store 的状态和生命周期所有权；
- 解释 string 与 AsyncIterable 输入、NDJSON framing、StructuredIO control request/response；
- 说明 text/json/stream-json 如何共享 Core event 又形成不同输出承诺；
- 识别 SDK 类型占位文件与外部 SDK 真实运行实现之间的证据边界；
- 独立运行、观察、破坏和修复 TypeScript/Python RuntimeSurface 实验；
- 解释 H1-in-progress 怎样复用 H0，又为什么尚未承诺跨 prompt 会话所有权；
- 把同一分层迁移到 Java/Spring、RAG/LangGraph 和企业协议治理；
- 用结论先行、口语化约两分钟的方式回答资深 Agent 面试追问。

主体学习时间边界为 4 至 7 小时；双语言实验、故障注入和扩展挑战另计。

## 代码运行上下文

正文指向两套独立 clean-room 实现：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M05\code\typescript"
node runtimeSurface.test.ts
node demo.ts
powershell -NoProfile -ExecutionPolicy Bypass -File .\typecheck.ps1

cd "D:\agent\Claude code最新\curriculum\units\M05\code\python"
python -m unittest -v test_runtime_surface.py
python demo.py
```

已知实际结果为 TypeScript 7/7、Python 7/7，通过 demo 与 TypeScript strict typecheck。累计 H1 回归也实际通过，并保留 S0 15/15。你只需检查正文是否让学习者知道这些观察证明什么，不要读取或执行代码。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约或 4 至 7 小时学习闭环的问题：

- 是否沿真实启动问题连续讲解，而不是把入口文件、参数、协议和表格拼装在一起；
- 必要的 TypeScript/Node/React/异步流前置是否在改变当前语义时讲清；
- fast path、表面选择、状态所有权、输入、输出、控制协议和关闭是否可独立复述；
- 图是否在入口分流、所有权、协议、投影和关闭等认知转折处就近出现，并与正文方向一致；
- 是否错误地把 client type 当表面 owner、把 Headless 当无状态、把 stream-json 当普通格式或把 SDK 占位类型当真实实现；
- 实验是否给出结论、输入、观察点、预期与反证，并支持学习者独立破坏和修复；
- H1 合入、Java/Spring/LangGraph 与企业治理是否从当前机制自然推出，没有提前吞掉后续完整配置、生命周期、Query 或 Tool 专题；
- 资深 Agent 面试题是否有真实追问价值，回答是否结论先行、口语自然，并能在约两分钟内展开到 Claude Code 机制、失败边界与工程设计；
- 教学密度是否足以支撑主体 4 至 7 小时。

普通措辞偏好、标题形式、无现实影响的边缘漏洞、行号漂移和不影响学习的小缺失不得列为 Issue。

## 输出要求

输出必须以以下三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，每项给出：定位、学习影响、为什么它是实质问题、最小修正方向。不要重写整章，不要建议新增固定栏目或配额。如无实质问题，给出简短通过理由和剩余非阻断风险。
