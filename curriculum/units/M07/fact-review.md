# M07 事实闸门记录

状态：`fact-reviewed`

事实会话：`39759856-57c1-4b64-98d1-6911ec60696f`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max；主审模型包含 `deepseek-v4-pro[1m]`，进程均自然退出，无应用层超时、无权限拒绝。

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 6
```

盲审独立确认了初始化时序、Bootstrap/AppState 两套容器、Interactive/Headless/临时 Provider 的实例边界、store 同步通知、请求内 snapshot/fresh read 混合以及 `onChangeAppState` 副作用。

Codex 裁决：

- Bootstrap 与 AppState 分离：`accepted`，工作簿已明确两套 owner，且不把 Bootstrap 写成推荐统一仓库；
- 一个进程可有多个 AppState store：`accepted`，正文必须区分 Provider/root 与 Headless runtime；
- 同 root 原地修改静默：`accepted`，进入双语言失败实验；
- `getToolUseContext` 内初始 tools/MCP snapshot 与 lazy fresh read 混合：`accepted`，FACT_B 前已补精确表述；
- AppState 修改可触发磁盘、认证缓存、环境和外部 metadata：`accepted`，但 clean-room 不调用真实副作用；
- `resetStateForTests()` 并发污染：作为源码设计边界记录，`rebutted` 其对当前 Harness 的阻断性；clean-room 每个测试创建独立 store，不复制模块级 reset。

## FACT_B

同一会话对照后结果：

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

审查者逐项确认：

- Bootstrap `STATE` 在模块求值时创建，早于 `init()` 与 AppState store；
- `setup()` 中 `setCwd()` 早于 hooks snapshot；
- Interactive Provider、Headless store 与临时 Provider 不是同一实例；
- `Object.is`、observer/subscriber 顺序、异常传播和取消订阅结论准确；
- REPL 的 context 构造时快照、`refreshTools/getAppState` fresh read 和 QueryEngine `initialAppState` snapshot 区分准确；
- 外部副作用清单与实验隔离边界准确；
- `RuntimeContext / SessionStateStore / RequestContext` 明确是设计迁移。

## 结论

M07 事实范围已闭合。正文不得声称“进程只有一个 AppState store”，不得把 `store.getState()` 笼统写成“整个请求永远实时”，也不得把 AppState updater 叙述成无副作用的纯 reducer。

