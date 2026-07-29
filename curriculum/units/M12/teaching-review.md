# M12 教学闸门记录与 Codex 裁决

状态：`teaching-reviewed`

审查会话：`5bfbc075-d8d2-474d-a717-87f3aa5701a6`

审查方式：新的独立 Claude Code/DeepSeek Max 会话；只读取 `2.md` 的教学标准、已确认的 `benchmark-rules.md`、M12 `draft.md` 和提示词中的必要前置摘要。未读取源码快照、Graphify、事实闸门、实验实现、全局知识或历史审查输出。进程自然退出，无应用层超时。

第一次后台启动因 Windows 对含空格脚本路径的引号处理失败而作废；该进程没有启动 Claude Code，也没有读取材料。修正启动方式后生成本记录中的有效独立会话。

## 闸门结果

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

## 审查确认

- 正文从 assistant `yield` 后 bookkeeping 是否已经执行这一真实问题进入，没有退化成 M02 语法重复或函数目录。
- 三层 pull、`while + State`、assistant/tool result 的 yield 顺序和 producer/durable 双 owner 可以独立复述，图文一致。
- yielded event、Query Terminal、SDK result，以及 normal return、AbortSignal、consumer close、producer throw 的边界清楚。
- 章首总图后，状态机、yield 时序、所有权、terminal、early close、退出分类、resource dispose 和多观察者均有就近局部图。
- TypeScript 6 个测试、Python 5 个测试、两轮 demo 和五次破坏修改都被解释为机制证据，不只是“测试通过”。
- Python async generator 的 terminal side channel 与显式 `inner.aclose()` 说明准确，支持跨语言迁移。
- Harness `merge + defer + reject` 裁决、Java/Spring、LangGraph 和企业 RunCoordinator 都由当前控制协议自然推出。
- 7 道资深 Agent 开发岗问题均结论先行、口语化，并能承接源码、失败和系统设计追问。
- M13 的请求投影、M14 的真实模型流、M15 的工具并发与权限细节均保持延后。

## Codex 裁决

教学闸门没有实质 Issue，不需要修改正文。审查提到的行号漂移和额外练习 pacing 都属于非阻断风险：正文已使用路径与符号作为稳定定位，破坏练习也明确在主体学习时间之外。

结论：M12 可以生成 `release-candidate.md`，不得提前生成 `final.md`。
