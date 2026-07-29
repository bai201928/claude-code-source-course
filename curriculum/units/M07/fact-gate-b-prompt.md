# M07 FACT_B 同会话对照提示词

继续刚才的 FACT_A 会话。请把你在阶段 A 独立得到的结论，与下面 Codex 的机制摘要和 clean-room 实验契约逐项对照。不要重新扩散阅读整个源码树；只有发现明确冲突时，才回到相关路径和符号定向核验。

## Codex 机制摘要

### 初始化时序

```text
entrypoints/cli.tsx 动态导入 main
-> import bootstrap/state 时 getInitialState() 并创建模块级 STATE
-> main() 设置运行模式、client type 和设置参数
-> Commander preAction
-> init() 启用配置、应用 trust 前安全环境、注册进程设施
-> 默认 command action
-> setup() 设置 cwd、捕获 hooks snapshot、处理 worktree 等
-> Interactive 或 Headless 构造 AppState
-> 创建 store
-> 请求边界装配 ProcessUserInputContext / snapshot
```

`init()` 不是整个系统所有状态的总构造器；Bootstrap `STATE` 在模块求值时已存在。`setup()` 中 `setCwd()` 必须早于 hooks snapshot。

### Bootstrap owner

`src/bootstrap/state.ts` 的 `const STATE = getInitialState()` 是同一模块实例内共享的可变单例，混合保存进程、启动和 session 范围字段。`switchSession()` 先同步修改 session ID/project dir，再发出 signal。`resetStateForTests()` 仅限测试，通过逐字段覆盖重置同一 `STATE` 对象并清 listener，而不是替换导出对象。

源码的多次警告表达“谨慎增加全局状态”，不能把该单例解释成推荐的统一状态仓库。

### AppState shape 与 store owner

`AppState` 是状态形状，`getDefaultAppState()` 是每次产生新 Map/Set/对象的默认值工厂，`AppStateStore = Store<AppState>` 才是 current root 的 owner。

Interactive 主路径：

```text
main.tsx initialState
-> launchRepl
-> App
-> AppStateProvider
-> useState(() => createStore(initialState, onChangeAppState))
```

Provider 生命周期内 store 创建一次；后续 initialState prop 变化不会自动替换 store。Provider 禁止在同一子树内嵌套。

Headless 主路径：

```text
main.tsx getDefaultAppState + headless 依赖
-> createStore(headlessInitialState, onChangeAppState)
-> runHeadless(() => store.getState(), store.setState, ...)
```

它不经过 React Provider。setup/doctor/MCP/Teleport 等临时 React root 也可各自挂载 Provider。因此准确结论是“Bootstrap STATE 为模块单例；每个 Provider/root 或 Headless runtime 可拥有独立 AppState store”，不是“整个进程只有一个 AppState store”。

AppState 虽含配置、权限、MCP、Plugin、Task、UI 等运行状态，但不拥有所有业务数据；REPL/Headless 消息所有权留给 M10。

### Store 语义

`createStore()`：

```text
prev = state
-> next = updater(prev)
-> Object.is(next, prev) 时不提交、不通知
-> state = next
-> 同步 onChange(new, old)
-> 同步按 Set 顺序调用 subscribers
```

因此原地改嵌套值并返回同一 root 会静默；新 root 会触发通知；observer 先于 subscriber。源码没有 transaction/rollback 或 listener 异常隔离：observer/subscriber 抛错时 state 已提交，后续通知可能未完成。

### React snapshot、fresh read 与 request snapshot

`useAppState(selector)` 通过 `useSyncExternalStore` 订阅 selector，selected value 以 `Object.is` 比较；每次返回新对象会造成额外重渲染。`useSetAppState()` 不订阅。

REPL 的 `getToolUseContext()` 明确用 `store.getState()` 读取构造该 context 时的当前权限、MCP 和工具，避免误用更早的 React render snapshot/闭包。这里不是“整个 turn 所有字段永远实时”：`s.verbose`、构造时的 `tools: computeTools()` 和 `mcpClients` 是该 context 的初始快照；`refreshTools: computeTools` 与注入的 `getAppState: () => store.getState()` 才会在后续调用时重新读取。`QueryEngine.processUserInput()` 的 `initialAppState = getAppState()` 又是当前处理阶段的显式 snapshot，后续仍可通过 getter 访问当前 SessionState。

教材将 render snapshot、fresh read、request snapshot 和 stale closure 分开；不把所有旧引用都叫 bug。

### 外部副作用

`onChangeAppState()` 位于 store observer 位置，早于普通 subscribers。它可通知 CCR/SDK permission metadata、持久化 model/verbose/expanded view、回写 Bootstrap model override、清认证缓存并重新应用环境变量。因此 `setState()` 不是纯内存 reducer；但本单元不展开这些子系统的完整业务逻辑。

## clean-room 实验与 Harness 契约

TypeScript/Python 对称实现：

- `RuntimeContext` 保存进程级不可变依赖和 configuration revision；
- `SessionStateStore` 保存当前 root/revision，更新语义与上面的 store 原语一致；
- `RequestContext` 在创建时冻结 request ID、session revision、configuration revision 和当前值；
- 新 Session revision 不原地改变旧 RequestContext；
- 提供显式 `readFreshSession()`，但不把它伪装成 request snapshot 自动更新；
- 缺失初始化依赖必须在 request 创建前失败；
- 正向实验验证 observer/subscriber 顺序与 snapshot 隔离；
- 失败实验验证同 root 静默和 listener 抛错后 state 已提交/后续 listener 中断；
- 合入 H1-in-progress 后保留 S0、M05、M06 全量回归。

这些类型名和分层属于 Harness 设计迁移，不冒充 Claude Code 当前公开 API。
clean-room 实验不导入 Claude Code 源码，不调用真实 `onChangeAppState()`，不会修改真实认证缓存、用户设置或 `process.env`。它也不复制模块级 `resetStateForTests()`；每个测试创建独立 `SessionStateStore`，所以 Bootstrap 测试重置的进程内并发风险只作为源码设计边界，不是本次 Harness 的未解决竞态。

## 审查要求

只检查事实错误、重要遗漏、证据不足、所有权/生命周期混淆，以及实验不能验证正文结论的问题。普通措辞偏好、对专有源码进行重构的建议、完整消息/权限/MCP/Task/退出机制和不会影响学习/Harness 的边缘问题不构成 Issue。

输出必须以以下三行开始：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后按 Issue 列出源码路径与符号、与 FACT_A 的对照、为什么影响教材或 Harness、应接受的修正或定向验证。没有实质问题时明确写 `No material issues`。
