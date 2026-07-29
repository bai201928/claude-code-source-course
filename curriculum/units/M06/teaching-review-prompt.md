# M06 教学闸门审查任务

你是一名独立的教材教学审查者。请以准备 2026 年中国互联网大厂 Agent 开发岗、具有 Java/Spring/Python/Agent/RAG 经验但 TypeScript/Node 基础较弱的学习者视角，审查 M06 是否真正建立“最终设置值、来源顺序、信任与运行快照”的源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只用其学习者背景、教学深度、源码理解、实验、Harness、企业迁移和面试表达要求。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`：用户确认的 M11 质量标杆规则。
3. `D:\agent\Claude code最新\curriculum\units\M06\draft.md`。
4. 下面给出的学习目标与代码运行结果。

不要读取 `fact-review.md`、`fact-gate-*`、`unit-workbook.md`、Graphify、源码快照、implementation report、其他教材或历史审查结论。你不是事实闸门，不要重做全仓库调查。不得修改文件。

## 学习目标

学习者完成后应能：

- 区分 source document、enabled source order、effective settings 与 runtime decision；
- 追踪 CLI/SDK settings 输入怎样进入 user/project/local/flag/policy/plugin 层；
- 解释标量、对象、数组的读取 merge，以及单来源写回的不同语义；
- 区分 policy provider first-source-wins、managed drop-in merge 与主来源 merge；
- 准确复述默认来源顺序，以及当前快照显式 `--setting-sources` 改变实际迭代顺序的版本边界；
- 解释解析、Zod、invalid permission rule、整来源拒绝、clone 和三层 cache；
- 区分 effective env、pre-trust env、trusted env 与 Headless implicit trust；
- 说明远程策略变化怎样使缓存失效并重新发布运行状态；
- 运行、观察、破坏和修复 TypeScript/Python clean-room resolver；
- 把 configuration revision、provenance 和 trust projection 合入自己的 Harness，并迁移到 Java/Spring、RAG 和 LangGraph；
- 用结论先行、口语化约两分钟回答资深 Agent 岗相关追问。

主体学习时间为 4 至 7 小时，双语言实验、破坏和企业练习另计。M06 不应提前吞掉 M07 的完整 AppState/bootstrap、后续权限专题或 M39 企业控制平面。

## 已知实验与图示结果

- M06 TypeScript 9/9、Python 9/9，TypeScript strict 通过；
- H1-in-progress 6/6，保留 S0 15/15，原 RuntimeSurface TypeScript 8/8、Python 7/7；
- 正文 12/12 Mermaid 图已实际渲染成功；
- 正文包含 10 道资深 Agent 开发岗问题，每题给出结论先行的口语回答。

你需要审查正文是否让学习者知道这些结果证明什么，不要重新执行命令。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约或 4 至 7 小时学习闭环的问题：

- 是否由一个真实配置冲突连续推进，而不是来源表、函数名、漏洞和面试题拼装；
- 默认/意图与当前快照 explicit source order 例外是否既讲清又不过度放大；
- 每次引入 TypeScript/Node 概念时，是否紧邻解释它改变的配置语义；
- 12 张图是否在认知转折处帮助首次理解与复习，方向、术语、状态和正文是否一致；
- policy selection、main merge、write merge、runtime decision 是否能被独立区分；
- trust 前后、Interactive/Headless、safe provider switch/endpoint redirect 是否形成可操作安全模型；
- 实验是否有结论、输入、观察点、反证和破坏，不用“测试通过”代替理解；
- H1 canonical/compatibility 双模式是否有合理边界，不把源码偶然行为复制为企业默认；
- Java/Spring、RAG、LangGraph、动态刷新和 provenance 是否从当前机制自然推出；
- 面试问题是否像资深面试官追问，回答是否第一句给结论、约两分钟可口述、能承接源码与系统设计追问。

普通措辞偏好、标题形式、不影响学习的小缺失、完整企业控制平面扩展和理论漏洞不得列为 Issue。

## 输出要求

输出必须以以下三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，每项给出定位、学习影响、为什么实质、最小修正方向。不要重写整章，不要建议新增固定栏目或配额。如无实质问题，给出简短通过理由和剩余非阻断风险。
