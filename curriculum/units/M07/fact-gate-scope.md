# M07 事实闸门中性范围

## 审查目标

独立重建当前 Claude Code CLI 快照中 Bootstrap state、AppState store 与请求读取之间的最小运行机制，回答：

1. 模块加载、`main()`、`init()`、`setup()` 和 AppState 创建的实际相对时序是什么；
2. Bootstrap state、AppState value、AppState store、React Provider、REPL/Headless runtime 各自拥有什么；
3. Interactive 与 Headless 是否共享同一个 store 创建路径；
4. 一个进程是否必然只有一个 AppState store；
5. `createStore()` 怎样提交 root、触发 observer、通知 subscriber 和取消订阅；
6. `Object.is`、函数式更新、selector、闭包和 `getState()` 怎样影响可见性；
7. 请求处理何时读取实时 AppState，何时有意保存 snapshot；
8. AppState 改变是否只影响内存，还是会触发外部副作用；
9. 哪些失败、竞态或初始化顺序会实质改变教学与 clean-room Harness 契约。

## 源码根目录

```text
D:\agent\Claude code最新\claude-code-CLI
```

只读。禁止修改、格式化或生成缓存到该目录。

## 建议优先阅读

- `src/bootstrap/state.ts`
  - `getInitialState`
  - 模块级 `STATE`
  - `switchSession`
  - `resetStateForTests`
- `src/entrypoints/cli.tsx`
- `src/main.tsx`
  - 早期运行模式设置
  - Commander `preAction`
  - Headless initial state/store
  - Interactive initial state 与 `launchRepl`
- `src/entrypoints/init.ts:init`
- `src/setup.ts:setup`
- `src/state/store.ts:createStore`
- `src/state/AppStateStore.ts`
  - `AppState`
  - `AppStateStore`
  - `getDefaultAppState`
- `src/state/AppState.tsx`
  - `AppStateProvider`
  - `useAppState`
  - `useSetAppState`
  - `useAppStateStore`
- `src/state/onChangeAppState.ts:onChangeAppState`
- `src/components/App.tsx`
- `src/replLauncher.tsx`
- `src/screens/REPL.tsx`
  - store 获取
  - `getToolUseContext`
  - `processUserInput` 上下文装配
- `src/cli/print.ts`
  - settings change subscription
  - getter/setter 注入
- `src/QueryEngine.ts:processUserInput`
- 独立挂载 `AppStateProvider` 的 CLI handler/dialog 文件，用于判断 store 实例数量。

## 审查边界

- 当前源码快照是内部实现事实的最高证据。
- 不读取 Graphify 输出，不把结构邻接当作运行链。
- 不读取 M07 `unit-workbook.md`、草稿、实现或 Codex 结论。
- 不展开完整 Tool/Permission/MCP/Task/Transcript 机制，只在它们能证明状态所有权或读取时机时引用。
- 不审查产品全部全局变量，不要求重构源码。
- 只报告会影响事实正确性、实验有效性、初学者状态模型或 Harness 契约的问题。

