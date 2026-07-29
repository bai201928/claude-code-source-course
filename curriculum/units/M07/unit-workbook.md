# M07 研究工作簿：Bootstrap 与 AppState，谁创建系统、谁拥有运行状态

状态：`researched`

风险：`R2`

本文件是作者工作区，不是教材正文。Graphify 只用于候选定位，以下机制结论均已回到当前 `claude-code-CLI/` 源码快照核验。

## 1. 本单元要解决的问题

一个成熟 Agent CLI 启动后，会同时出现配置、会话、UI、工具、请求和进程统计等状态。若把它们统称为“全局状态”，学习者会立刻失去三个关键判断：

1. 谁创建这个状态，它活多久；
2. 谁可以修改，修改后谁会立刻观察到；
3. 一次请求拿到的是实时值，还是有意冻结的快照。

M07 沿一次启动和一次请求建立四层模型：

```text
模块加载期 Bootstrap STATE
-> init/setup 装配进程设施
-> Interactive 或 Headless 创建自己的 AppState store
-> 每轮请求创建显式 RequestContext / snapshot
```

学习者应能解释：模块单例为何不等于整个程序只有一个状态容器；React 组件为何既使用 selector 快照，又在请求边界调用 `store.getState()`；不可变 root 引用为何直接决定通知语义。

## 2. 前置与边界

前置：

- M01 的对象、联合类型和引用身份；
- M03 的事件循环、取消和资源生命周期；
- M05 的 Interactive/Headless 运行表面；
- M06 的配置快照、动态重发布和 trust 阶段。

本单元闭合：

- 模块加载时构造的 Bootstrap `STATE`；
- `main()`、Commander `preAction`、`init()`、`setup()` 与 store 创建的相对时序；
- AppState 形状、store 实例和 owner 的区别；
- Interactive/Headless/临时 Provider 的 store 创建方式；
- `createStore()` 的同步更新、观察和订阅语义；
- React selector 快照、闭包捕获、实时 `getState()` 与请求快照；
- clean-room 的 `RuntimeContext / SessionStateStore / RequestContext` 分层。

不提前展开：

- M08 的完整工具、系统提示、插件与扩展启动快照；
- M09 的退出、取消、清理预算和完整生命周期；
- M10 的消息数组、消息配对与 transcript 所有权；
- M28 的 Runtime Task registry 和任务状态机。

## 3. Graphify 候选与核验边界

Graphify 广度查询命中 `src/bootstrap/state.ts`、`AppStateStore`、`AppStateProvider()`、`Store`、`main.tsx`、`init()`、`setup()`、`REPL()`、`QueryEngine.ts` 和 `print.ts`。

图谱只说明这些符号结构上邻近，且查询包含 `imports/contains` 等关系，不能证明它们处于一条运行调用链。教材采用的时序和所有权结论全部来自下面的直接源码核验。

## 4. 源码地图

| 机制 | 决定性位置 | 需要确认的语义 |
| --- | --- | --- |
| 进程 Bootstrap | `src/bootstrap/state.ts:getInitialState`, `STATE` | 模块求值时创建一个共享可变对象 |
| CLI 入口 | `src/entrypoints/cli.tsx:main` | 动态导入 `main.js`，导入链触发模块初始化 |
| 基础初始化 | `src/main.tsx:main`, Commander `preAction`, `src/entrypoints/init.ts:init` | 运行模式/参数先进入 Bootstrap，配置与全局设施后初始化 |
| 工作目录装配 | `src/setup.ts:setup` | `setCwd` 必须早于 hooks snapshot 和依赖 cwd 的组件 |
| AppState 形状 | `src/state/AppStateStore.ts:AppState`, `getDefaultAppState` | 类型和默认值工厂不是 store owner |
| Store 原语 | `src/state/store.ts:createStore` | root 引用、同步 observer/subscriber 与取消订阅 |
| Interactive owner | `src/components/App.tsx:App`, `src/state/AppState.tsx:AppStateProvider` | Provider 挂载期创建一次 store，React 订阅 slice |
| Headless owner | `src/main.tsx` headless branch | main 直接创建 store，并注入 getter/setter 给 `runHeadless` |
| 运行请求边界 | `src/screens/REPL.tsx:getToolUseContext`, `src/QueryEngine.ts:processUserInput` | 实时读取与显式快照同时存在 |
| 外部副作用 | `src/state/onChangeAppState.ts:onChangeAppState` | 一次状态更新可能写配置、通知外部系统和刷新运行环境 |

## 5. 已核验的初始化时序

当前快照的最小主链：

```text
entrypoints/cli.tsx
-> 动态 import main.js
-> import bootstrap/state.js
-> getInitialState()
-> const STATE = ...
-> main() 解析早期运行模式并 setIsInteractive/setClientType 等
-> Commander preAction
-> init()
-> action handler
-> setup()
-> 构造 Interactive 或 Headless initial AppState
-> 创建 AppState store
-> 请求边界构造 ProcessUserInputContext / Request snapshot
```

关键顺序约束：

- Bootstrap `STATE` 在显式 `init()` 之前已经存在；`init()` 不是“创建所有状态”的总构造器。
- `init()` 先启用配置和应用 trust 前安全环境，再注册 graceful shutdown、网络/telemetry 等进程设施。
- `setup()` 中源码注释要求 `setCwd()` 先于依赖 cwd 的 hooks snapshot；重排会改变被加载的项目配置。
- Interactive 和 Headless 都在依赖准备后构造 AppState，但创建方式与消费方式不同。

证据状态：`快照事实`。

## 6. Bootstrap STATE：一个模块对象，不是架构许可

`src/bootstrap/state.ts` 在类型声明前明确写着 `DO NOT ADD MORE STATE HERE`，在工厂前后再次警告谨慎修改。`getInitialState()` 读取当前 cwd、生成 session ID，并创建 Map/Set/数组等字段；`const STATE = getInitialState()` 在模块求值时执行一次。

因此：

- 同一模块实例内，所有 getter/setter 共享同一个 `STATE` 对象；
- 状态跨度混合：进程计量、启动配置、当前 session、缓存、hooks、skills、team 等都在此层出现；
- 它提供无依赖的 Bootstrap 访问点，但也形成隐藏依赖、测试隔离和生命周期混杂风险；
- “已有全局单例”不能推导出“新状态也应该继续加进去”。源码警告恰好表达相反方向。

`switchSession()` 同步更新 `sessionId` 和 `sessionProjectDir`，再触发 `sessionSwitched.emit(sessionId)`；监听者通过注册反向依赖，避免 Bootstrap leaf 直接导入高层模块。

`resetStateForTests()` 只允许 `NODE_ENV=test`。它不是把导出的 `STATE` 替换成新对象，而是把新的默认字段逐个覆盖回原对象，再清理额外计数器和 session listeners。因此持有 `STATE` 间接访问路径的代码仍指向同一个模块对象。

证据状态：`快照事实`。

## 7. AppState 类型、默认值和 store 必须分开

`AppState` 是一个大的状态形状；`getDefaultAppState()` 每次调用都会产生新的对象以及新的 Map/Set/数组；`AppStateStore` 才是 `Store<AppState>`。

应明确区分：

```text
AppState type       = 允许存在什么字段
AppState value      = 某一时刻的 root snapshot
AppStateStore       = 保存 current root、接受 updater、通知 observer/listener 的 owner
AppStateProvider    = Interactive React tree 中创建并提供 store 的装配组件
```

AppState 中包含配置、权限、MCP、Plugin、Task、UI、恢复等大量运行状态，但它并不因此拥有所有业务数据。REPL 的主消息数组仍在 REPL 本地 state/ref；Headless 消息由 `print.ts`/`QueryEngine` 路径拥有。该边界留给 M10 细讲，本单元只用于阻止“AppState 就是整个会话”的误解。

## 8. `createStore` 的决定性语义

`src/state/store.ts:createStore()` 的更新顺序固定为：

```text
prev = state
-> next = updater(prev)
-> Object.is(next, prev) 为真：立即返回
-> state = next
-> onChange({newState, oldState})
-> 按 Set 插入顺序同步调用 listeners
```

由此直接推出：

- 原地修改嵌套字段并返回相同 root，会让更新对 observer 和 subscribers 完全静默；
- 返回新 root 即使字段值等价，也会触发 observer 和全部 listeners；
- `onChange` 先于普通订阅者；
- 通知是同步的，listener 不是后台任务；
- 当前实现没有隔离 listener 异常，某 listener 抛错会中断后续遍历并把异常返回给 `setState` 调用者；
- `subscribe()` 返回删除同一 listener 的取消订阅函数。

这不是 Redux reducer，也没有批处理、回滚或 transaction 语义。教材实验要让学习者亲手制造“对象内容变了但没人收到通知”的失败。

## 9. 谁创建 AppState store

### 9.1 主 Interactive App

```text
main.tsx 构造 initialState
-> launchRepl(root, appProps, replProps)
-> <App initialState=...>
-> <AppStateProvider initialState=... onChangeAppState=...>
-> useState(() => createStore(...))
-> <REPL /> 和后代通过 context 使用同一 store
```

`useState` 的 lazy initializer 使 store 在该 Provider 生命周期只创建一次。后续 `initialState` prop 改变不会自动替换现有 store。Provider 禁止在同一 React 子树中嵌套，防止后代意外读到另一个 owner。

### 9.2 Headless / SDK

```text
main.tsx getDefaultAppState()
-> 合入 MCP、权限、effort 等运行依赖
-> createStore(headlessInitialState, onChangeAppState)
-> runHeadless(() => store.getState(), store.setState, ...)
```

Headless 没有 React tree，不经过 `AppStateProvider`，而是把 `getState/setState` 作为依赖注入给非 React 代码。`print.ts` 自己订阅 settings change，并调用共享的状态更新逻辑。

### 9.3 临时 React roots

setup token、doctor、MCP dialog、Teleport、InvalidConfig 等路径也会各自挂载 `AppStateProvider`。它们可能调用 `getDefaultAppState()` 创建短生命周期的独立 store。

准确结论：

- Bootstrap `STATE` 是模块级共享单例；
- 每一个 Provider/root 拥有自己的 AppState store；
- 主 Interactive App 通常拥有一个长期 store；
- 一个 Headless runtime 直接拥有一个长期 store；
- 临时 dialog 可以拥有短生命周期 store。

不能写成“一个进程只有一个 AppState store”。

## 10. 订阅视图、实时读取与请求快照

`useAppState(selector)` 使用 `useSyncExternalStore`：每次 store 通知时重新计算 selector 结果，并通过 `Object.is` 判断 selected value 是否改变。selector 每次创建新对象会造成不必要的重渲染；选择已有子对象或单字段才能利用引用稳定性。

`useSetAppState()` 只返回稳定 setter，不订阅任何状态。`useAppStateStore()` 用于把 getter/setter 注入非 React 代码。

REPL 构造 `getToolUseContext()` 时明确调用 `store.getState()`，而不使用渲染闭包中的 selector snapshot。原因是 MCP、权限和工具可能在 React 下一次 render 前已经异步变化。它还把 `getAppState: () => store.getState()` 注入 `ProcessUserInputContext`。

另一方面，`QueryEngine.processUserInput()` 中的 `const initialAppState = getAppState()` 是当前处理阶段有意冻结的 snapshot，用于系统提示、工作目录、fast mode 等一次性决策；后续代码仍可以通过注入的 getter 读取新的 session state。

因此必须区分：

- React render snapshot：为一次渲染提供一致视图；
- fresh read：在异步边界获取当前 store root；
- request snapshot：为一个请求或阶段冻结 revision；
- stale closure：错误地把旧引用当作持续实时值。

旧 snapshot 不等于 bug；没有说明冻结边界、却假定它自动更新，才是 bug。

## 11. AppState 更新不是纯内存动作

`onChangeAppState()` 在 store 更新后、普通 subscribers 前同步运行。它根据 diff：

- 向 CCR/SDK 发布 permission mode/metadata；
- 把 model 写回 user settings，并回写 Bootstrap model override；
- 持久化 verbose/expanded view；
- 设置变化时清理认证缓存；
- settings env 变化时重新应用环境变量。

因此 `setState()` 的抽象边界包含副作用，不能把它理解成纯 reducer。若 `onChangeAppState` 抛错，store 的 current root 已经替换，但普通 subscribers 尚未全部执行；这形成“状态已提交、通知未完成”的失败窗口。当前实现部分副作用自行 catch，但 store 原语没有事务回滚。

## 12. 代表性风险

1. **同 root 原地修改**：状态内容改变但 observer/listener 不运行。
2. **selector 新对象**：每次通知都重渲染，即使相关值未改变。
3. **闭包陈旧**：异步 MCP/permission 更新已经入 store，请求仍使用旧 render snapshot。
4. **初始化重排**：hooks snapshot 在 `setCwd()` 前捕获了错误项目配置。
5. **误认单例**：临时 Provider/Headless 被当作主 App store，导致跨 root 状态不可见。
6. **副作用半完成**：observer 抛错时 root 已更新，后续 subscribers 未全部运行。

## 13. 实验假设与反证条件

假设 A：相同 root 引用不通知，即使嵌套内容已被原地修改。反证：observer 或 subscriber 仍收到通知。

假设 B：新 root 的 observer 在 subscribers 之前同步运行，subscribers 按注册顺序运行。反证：顺序不同或异步延迟到调用返回后。

假设 C：一个坏 subscriber 会中断它后面的 subscriber，但 state 已提交。反证：状态回滚，或后续 listener 仍全部执行。

假设 D：Session revision 更新不会原地改变旧 RequestContext。反证：新请求开始后，旧 request 的 revision/value 随之变化。

假设 E：显式 fresh read 可看到新 SessionState，而旧 RequestContext 仍保持原值。反证：二者无法同时成立。

假设 F：初始化依赖缺失或顺序错误应在创建 request 前失败。反证：不完整 runtime 被静默创建并在深层随机失败。

观察点：root identity、observer/listener trace、异常位置、current state、session revision、request snapshot 和 fresh read。

## 14. Harness 候选契约

H1-in-progress 增加：

- `RuntimeContext`：进程级不可变依赖与已验证配置引用；
- `SessionStateStore`：有 revision 的当前会话状态 owner；
- `RequestContext`：每轮显式冻结的 request ID、session revision、配置 revision 与状态值；
- 初始化依赖检查：缺少 runtime/config/session 必须在 request 创建前失败；
- 同 root 不通知、observer 先于 subscriber、subscriber 同步有序；
- 新 session revision 不修改旧 RequestContext；
- `readFreshSession()` 是显式逃生口，调用者必须知道它打破 request 一致视图。

候选决定：`merge`，前提是 TypeScript/Python 行为测试、代表性失败实验和累计 H1 回归全部通过。

## 15. 当前证据边界

- Bootstrap、init/setup、AppState/store、Interactive/Headless 路径属于 `快照事实`；
- 双语言 store/context 实验属于 `运行验证`；
- `RuntimeContext / SessionStateStore / RequestContext` 是 `设计迁移`；
- 本单元不声称 Claude Code 使用这三个 clean-room 类型名；
- Graphify 不作为教材事实、流程图或面试答案的证据。

