# M18 独立教学闸门任务

你是一名独立教材教学审查者，也是一名熟悉 Agent Harness、Instruction Pipeline、上下文投影、Trust boundary 和企业配置治理的互联网大厂资深面试官。请审查 M18 是否真正帮助 TypeScript/Node 基础较弱、但已有 Java、Spring、Python、Agent 和 RAG 经验的学习者，建立“文件存在不等于模型看见，指令必须经过发现、信任、作用域、装配和请求投影”的源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只读取学习者背景、教学深度、实验、Harness、企业迁移、面试表达和验收标准。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`。
3. `D:\agent\Claude code最新\curriculum\units\M18\draft.md`。
4. 本提示词中的前置摘要、目标和运行上下文。

请实际使用 Read 工具完整读取前三份文件。不要读取源码快照、Graphify、M18 工作簿、事实审查、实验实现、implementation report、Harness 源码、其他教材或历史审查。你不是事实闸门，不重新调查仓库，不修改文件。

## 必要前置摘要

- M10 已讲 durable owner、identity、tool pairing 与 snapshot。
- M11 已走过输入、Query Loop、模型、Tool Loop 与第二次请求。
- M13 已讲 durable/query/API/wire 投影与 strict pairing。
- M16 已讲 Context budget 与多层裁剪。
- M17 已讲 compact transaction、summary、Transcript commit 与恢复可见性。
- M19 才系统讲 Session/Auto Memory；M20 之后才展开 Tool/Permission/Hook/Skill/MCP/Plugin 扩展栈。M18 只在理解 instruction delivery 所需范围内提及这些边界。

## 学习目标

学习者完成后应能：

- 解释为什么磁盘文件、instruction catalog、请求视图和 model-visible message 是不同完成点；
- 区分 default/custom/append system prompt、eager CLAUDE.md userContext、path-triggered nested instruction 和 turn-specific dynamic attachment；
- 走完 Managed、User、Project、Local、additional directory 的发现顺序，并守住 Rules 目录没有跨平台稳定排序的弱保证；
- 解释 `processMemoryFile()` 的 parent-first/include-after、路径去重、变换内容和 external include trust；
- 说明无条件 Rule、conditional Rule、nested trigger 和 allowed working path 如何协作；
- 解释 CLAUDE.md 经 meta user/system-reminder 投影而不是进入 default system prompt，以及 custom prompt 为何仍不自动移除 userContext；
- 区分 `loadedNestedMemoryPaths` 的 delivery ledger 与 `readFileState` 的变化检测/编辑安全职责；
- 走完 attachment 的 user-first、thread/main 并行、稳定输出顺序、normalization 与 API 投影；
- 准确理解一秒 abort 是 cooperative request，不是强制 timeout，`maybe()` 是错误隔离而不是停止底层副作用；
- 解释 InstructionsLoaded hook 是 fire-and-forget observer，不拥有注入或 policy veto；
- 运行双语言实验，验证稳定层次、scope、trust、去重、immutable snapshot、stale revision 和 request-only dynamic delta；
- 准确描述 H3-3 merge/defer/reject，不把 clean-room InstructionCatalog 冒充 Claude Code 私有实现；
- 迁移到 Java/Spring、RAG、企业配置治理和 hermetic execution；
- 对资深 Agent 岗追问给出结论先行、口语化约两分钟回答。

主体学习边界 4 至 7 小时，实验和修改挑战另计。

## 已知运行上下文

```text
FACT_A: PASS / 0
FACT_B: PASS / 0
M18 TypeScript independent: 7/7
M18 Python independent: 7/7
Harness TypeScript Instructions: 7/7
Harness Python Instructions: 7/7
Harness TypeScript strict typecheck: passed
Harness cumulative regressions: passed
```

正文含 16 个 Mermaid block，已经完整批量渲染为 `16/16`。只审查正文是否让学习者理解这些结果证明什么，不读取实现或重跑命令。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约、面试表达或 4 至 7 小时闭环的问题：

- 是否从“文件存在不等于模型看见”的真实误判连续推进，而不是配置文件和函数目录；
- discovery、read/transform、trust、scope、dedupe、assembly、normalization 和 projection 是否形成可复述运行链；
- CLAUDE.md、Rules、system prompt、nested instruction 和 dynamic attachment 是否没有被混成一种 context text；
- Managed/User/Project/Local 顺序与 OS `readdir` 弱保证是否同时讲清，不把注意顺序冒充 policy precedence；
- include 的 parent-first 实现、external trust、normalized path、transform 与 edit safety 是否可跟踪；
- eager/conditional/nested 三条路径、allowed path 与 glob base 是否不混淆；
- userContext 的 meta user/system-reminder 投影、custom/default/append/systemContext 替换关系是否足够清楚；
- system prompt section cache、clear/compact reset 与 Prompt Cache 关系是否没有过度承诺；
- 两个去重状态的 owner 与生命周期是否可独立画出；
- attachment 的调度、稳定顺序、错误隔离、cooperative abort 和 message normalization 是否形成闭环；
- Hook observer 与 InstructionPipeline owner 是否分权明确；
- TypeScript Promise.all、AbortSignal、immutable snapshot、revision 与 Java/Python 对照是否在改变机制处出现；
- 16 张局部图是否靠近认知转折、方向与正文一致、可独立复习；
- 实验是否有预测、反证、破坏和修复；
- H3-3 是否准确区分快照事实、运行验证、设计迁移，并守住 deferred parser/discovery/persistence 边界；
- 企业迁移是否从 provenance、trust、scope、snapshot consistency、deadline 和 policy ownership 自然推出；
- 8 道面试题是否真实、第一句结论明确、口语自然、可在约两分钟内展开到 Claude Code 和工程边界；
- 是否守住 M18 范围，没有提前吞并完整 Memory 或后续扩展栈。

无现实影响的措辞偏好、标题形式、边缘漏洞和不影响学习的小缺失不得列为 Issue。

## 输出要求

必须以下列三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

有实质问题时给出正文定位、学习影响和最小修正方向；不要重写整章，不建议固定栏目、题量或图量。如无实质问题，简述通过理由与非阻断风险。
