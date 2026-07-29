# M07 实现与实验报告

状态：`implemented`

## 独立行为契约

TypeScript 与 Python clean-room 实现遵守同一组状态契约：

- store 以 root identity 判断 no-op；相同 root 不运行 observer/subscriber；
- 新 root 先成为 current state，再同步运行 observer 和有序 subscribers；
- 退订幂等；listener 异常不回滚已提交 state，并中断后续 listener；
- RuntimeContext 在请求前验证 runtime ID、model adapter 和 configuration revision；
- SessionStateStore 每次发布新 revision，复制并冻结外部输入；
- RequestContext 显式冻结 runtime/configuration/session revision 和 session values；
- `readFreshSession` 显式读取当前 session，不修改旧 RequestContext；
- clean-room 不导入 Claude Code、不触发真实 settings/auth/process.env 副作用。

## M07 独立实验

TypeScript：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M07\code\typescript"
node runtime-context.test.ts
node demo.ts
powershell -NoProfile -ExecutionPolicy Bypass -File .\typecheck.ps1
```

实际结果：7/7 行为测试通过；demo 显示 request snapshot 保持 session revision 1，fresh read 观察 revision 2，通知顺序为 observer 后 subscriber；strict typecheck 通过。

Python：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M07\code\python"
python -m unittest -v test_runtime_context.py
python demo.py
```

实际结果：7/7 `unittest` 通过；demo 在 request revision、fresh read revision、状态值和通知顺序上与 TypeScript 一致。

## 代表性失败实验

1. 原地修改嵌套字段并返回同一 root：直接 getter 看见修改，但 observer/subscriber trace 为空。
2. 第一个 subscriber 抛错：新 root 已提交，第二个 subscriber 未运行，异常传播给调用者。
3. 缺少 RuntimeContext 或非法 configuration revision：在 RequestContext 创建前失败。

这些实验分别验证引用身份、非事务通知和初始化依赖边界，不穷举 AppState 的所有字段和副作用。

## H1-in-progress 合入

Decision：`merge`

新增：

- `mini-agent-harness/typescript/runtimeContext.ts` 与测试；
- `mini-agent-harness/python/runtime_context.py` 与测试；
- H1 contract 的 Runtime/Session/Request 分层不变量；
- M06 ConfigurationSnapshot revision 到 RuntimeContext 的显式连接；
- H1 regression 中两项双语言 runtime context 检查。

累计回归：

```powershell
cd "D:\agent\Claude code最新\mini-agent-harness"
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-h1-regression.ps1
```

实际结果：H1-in-progress 8/8 检查通过，其中包含 S0 15/15；M05 RuntimeSurface TypeScript 8/8、Python 7/7；M06 Configuration TypeScript/Python 各 9/9；M07 RuntimeContext TypeScript/Python 各 6/6；TypeScript strict 通过。

## 图示验证

`draft.md` 的 16/16 Mermaid 图已用 Mermaid CLI 实际渲染为 SVG。输出位于 `review-workspace/rendered-*.svg`，只作可重建审查产物，不进入候选正文。

## 兼容与边界

- Bootstrap `STATE`、AppState store 与请求读取属于快照事实；三层 context 属于设计迁移。
- Harness 不复制模块级 Bootstrap 单例，也不声称当前源码使用 `RuntimeContext/SessionStateStore/RequestContext` 类型名。
- SessionState publication 比源码通用 store 更严格地复制、冻结 value；通用 store 实验仍保留同 root 静默语义用于验证。
- M07 不展开 M08 能力启动快照、M09 完整清理、M10 消息 owner 或 M28 Runtime Task registry。

