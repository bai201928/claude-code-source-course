# M04 事实闸门记录

状态：`fact-reviewed`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max。

有效会话 ID：`2c8b52f6-f371-45d4-85e5-d5accde7eb25`

FACT_A 与 FACT_B 均自然退出，未设置 Claude CLI 应用层超时，无权限拒绝。

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 2
```

盲审确认了 ask/QueryEngine/processUserInput/query 的调用、owner、条件和事件副作用。它报告当前快照缺少 `src/query/transitions.ts`，并未发现 QueryEngine 专题测试或作者最小复现。

## Codex 裁决

### M04-F01 缺少 query transitions 类型文件

Decision: `accepted`

Reason: `src/query.ts` type-import `./query/transitions.js`，当前快照确实缺少对应源码。不能声称原 Query 路径已在本地完整 typecheck 或可直接构造运行。

Change: 正文在测试与证据边界处明确标注。可见源码仍支持静态调用/状态结论；运行验证只来自独立 clean-room 实验。

### M04-F02 QueryEngine 专题测试与最小复现

Decision: `accepted`（测试缺失）/ `rebutted`（当前产物没有最小复现）

Reason: 当前快照没有可直接定位的 QueryEngine 专题测试，正文已明确。FACT_A 是盲审，按规则不能读取 M04 作者代码；M04 实际已有 TypeScript/Python TraceableEngine，各 5/5 通过并覆盖本地分支、真实调用、浅视图、传参反证和部分失败。

Change: 不把 clean-room 实验冒充官方测试，也不尝试在缺失类型的快照上搭建伪完整 QueryEngine 测试。保留当前最小、可证伪的 H0 追踪契约。

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

FACT_B 确认：ask 的构造/finally、QueryEngine 字段生命周期、processUserInput 与 shouldQuery、query 的条件调用、event switch 的 owner 副作用、tool 只作为实参、浅数组视图和证据层次均准确。它也确认双语言实验覆盖声明的 H0 契约，且边界没有把它升级为 Claude Code 官方行为证明。

结论：M04 没有待修的实质性事实问题，可以进入教学闸门。
