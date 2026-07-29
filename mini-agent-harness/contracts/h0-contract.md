# H0 行为契约

版本：`H0`

来源单元：M01-M04。

## 不变量

1. 外部消息先运行时校验，再进入内部联合类型。
2. RunState 只能 `idle -> running -> completed|failed|cancelled`，终态不能重启。
3. Query event 逐条提交；失败不会自动回滚已经追加的消息。
4. `shouldQuery=false` 必须有可观察 branch event，且 Query 调用数为 0。
5. cancel request 与 cleanup 是不同事件；cancel reason 必须保留。
6. ResourceScope 逆序、幂等清理；业务状态仍由 Harness owner 持有。
7. Trace 只记录结构化运行事实，不把 import/contains 当作调用，也不记录敏感 prompt/Tool 原文。
8. TypeScript/Python 比较事件类型、顺序、状态和不变量，不比较语法、对象布局或平台裸退出码。

## 回归命令

TypeScript：

```powershell
cd "D:\agent\Claude code最新\mini-agent-harness\typescript"
node h0.test.ts
node demo.ts
powershell -File typecheck.ps1
```

Python：

```powershell
cd "D:\agent\Claude code最新\mini-agent-harness\python"
python -m unittest -v test_h0.py
python demo.py
```

阶段全量回归由 `tests/run-s0-regression.ps1` 执行。
