# S0 源码阅读基础发布说明

状态：`final`

发布日期：`2026-07-28`

S0 原子发布 M01-M04，并形成累计 Mini Agent Harness `H0`。

## 发布单元

| 单元 | 正文规模 | 局部图 | 面试题 | 教学闸门 |
| --- | ---: | ---: | ---: | --- |
| M01 类型不是注释 | 742 行 | 9 | 6 | PASS / 0 |
| M02 值不是一次回来的 | 685 行 | 13 | 7 | PASS / 0 |
| M03 `await` 之后还有运行时 | 650 行 | 12 | 8 | PASS / 0 |
| M04 别把连线当调用 | 785 行 | 13 | 8 | PASS / 0 |

四个单元都完成独立 FACT_A、同会话 FACT_B、Codex 裁决、双语言实验、Mermaid 实际渲染和独立教学闸门。M02 FACT_B 的 REVISE 只用于纠正 FACT_A 自身错误结论；当前教材结论已闭合。

## 阶段一致性

- 依赖顺序为类型/状态 -> 异步事件 -> Node 资源/取消 -> 可验证源码追踪，没有在使用前遗漏关键 TypeScript 前置。
- M02 的 generator finally 不等于资源停止，M03 继续闭合 AbortSignal、process exit 与 cleanup；两章无冲突。
- M04 的 QueryEngine 样本明确属于 SDK/Headless；交互式 REPL 仍直接在 `query()` 汇合，没有改写 M11 标杆路径。
- `mutableMessages` owner、turn-local array view、partial failure 和 transcript/usage 副作用的表述一致。
- Graphify 在四章中只作为候选定位，不是教材事实、图示或面试答案的最终证据。
- 快照缺失的 Message/utility/tool/query transition 类型文件均已标注，没有冒充原项目完整 typecheck。
- 图中调用、状态、取消和失败箭头与正文/实验一致；47 张图均已实际渲染。

## 回归结果

`mini-agent-harness/tests/run-s0-regression.ps1`：`15/15 checks passed`。

行为测试：

- M01：TypeScript 4/4，Python 4/4；
- M02：TypeScript 6/6，Python 5/5；
- M03：TypeScript 5/5，Python 5/5；
- M04：TypeScript 5/5，Python 5/5；
- H0：TypeScript 7/7，Python 7/7。

M01-M04 与 H0 的 TypeScript strict typecheck 全部通过。当前 Windows 环境不使用 WSL；未执行 Hash、重哈希、漂移检查或自动 Git 提交。

## H0 里程碑

H0 将四章能力合成一个可运行的契约骨架：消息 parser、RunState transition、AsyncIterable Query port、CancellationScope、ResourceScope、TraceEvent/TraceLog 与双语言同不变量测试。Graphify 边、Claude Code 私有符号和平台裸退出码没有进入通用契约。

下一阶段为 S1/M05：从 CLI 入口与运行表面开始，把 H0 扩展为 H1 运行配置与生命周期壳。
