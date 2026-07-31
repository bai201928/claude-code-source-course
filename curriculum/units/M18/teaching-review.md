# M18 教学闸门与 Codex 裁决

状态：`teaching-reviewed`

审查会话：`0790953b-2591-485c-abb5-94e16884aacf`

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

## 通过理由

独立 Claude Code/DeepSeek Max 教学审查实际读取了 `2.md`、M11 标杆规则与 M18 正文，并确认：

- 正文从“文件存在不等于模型看见”的真实误判连续推进，形成 discovery、read/transform、trust、scope、dedupe、assembly、normalization 与 projection 的完整链；
- CLAUDE.md、system prompt、conditional/nested rule 和 dynamic attachment 没有被混成一种 context text；
- Managed/User/Project/Local 顺序与 OS `readdir` 的跨平台弱保证同时讲清，注意顺序没有被冒充 policy precedence；
- parent-first include、external trust、normalized path、transform、edit safety、allowed path 和 glob base 均可跟踪；
- userContext 的 meta user/system-reminder 投影，以及 custom/default/append/systemContext 的替换关系清楚；
- `loadedNestedMemoryPaths` 与 `readFileState` 的 owner、生命周期和不同职责可以独立画出；
- attachment 调度、稳定顺序、错误隔离、cooperative abort、normalization 与 API 投影形成闭环；
- InstructionsLoaded Hook 的 observer 职责与 InstructionPipeline 的内容 owner 职责分离明确；
- 16 张局部图靠近认知转折、方向与正文一致，并已 `16/16` 渲染；
- 双语言实验有预测、反证、破坏和修复，H3-3 没有冒充源码实现或已完成的持久化机制；
- Java/Spring、RAG、LangGraph 与企业配置治理由 provenance、trust、scope、revision 和 deadline 自然推出；
- 8 道资深 Agent 岗面试题结论先行、口语自然，可承接源码、失败边界与系统设计追问；
- M18 没有提前吞并 M19 Memory 或 M20 之后的扩展栈。

## Codex 裁决

无实质 Issue，不需要教学复审。

审查者提到 nested worktree 与 npm `ignore` 库可能让缺少对应背景的学习者短暂停顿。相邻正文已经给出当前机制所需语义，且这两点不影响主运行链、实验或 Harness 契约，因此作为非阻断观察保留，不修改正文。
