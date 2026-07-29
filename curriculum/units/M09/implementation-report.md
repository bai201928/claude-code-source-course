# M09 实现与实验报告

状态：`implemented`

## 独立 clean-room 实现

TypeScript：

- `code/typescript/lifecycle-coordinator.ts`
- `code/typescript/lifecycle-coordinator.test.ts`
- `code/typescript/demo.ts`

Python：

- `code/python/lifecycle_coordinator.py`
- `code/python/test_lifecycle_coordinator.py`
- `code/python/demo.py`

两种实现遵守同一行为契约：

- `running -> stopping -> stopped`；
- first shutdown request 拥有共享 Promise/Task 与 report；
- `critical -> resource -> best-effort` 跨层串行；
- 层内并发、失败隔离；
- 合作式 timeout signal 与显式 `timed-out`；
- overall deadline 后的 `skipped` 与 failsafe callback；
- prepare/recovery hint 先于慢 cleanup；
- unregister 幂等，stopping 后拒绝新注册。

该分层是设计迁移，不冒充 Claude Code 当前 `cleanupRegistry.ts`。

## 独立验证结果

- TypeScript strict：通过；
- TypeScript 生命周期测试：`8/8`；
- Python 生命周期测试：`8/8`；
- TypeScript demo：按 critical/resource/best-effort 顺序完成；
- Python demo：行为与 TypeScript 对齐；
- snapshot-shaped registry 反例：确认 fail-fast 不取消慢 peer。

Node 24 的 strip-only TypeScript 运行器不支持 parameter property；实现已改为显式字段赋值，使示例无需编译产物即可直接运行。Python 的预算校验同步收紧为有限正数，保证双语言边界一致。

## Harness 裁决

Decision：`merge`

影响模块：

- `mini-agent-harness/typescript/lifecycleCoordinator.ts`
- `mini-agent-harness/python/lifecycle_coordinator.py`
- 双语言 lifecycle tests；
- `contracts/h1-contract.md`；
- H1 regression orchestration。

状态所有者：`LifecycleCoordinator` 只拥有 Harness 内部 lifecycle state、cleanup registrations、shutdown owner 与 report。外层 Surface adapter 拥有 OS signal、终端恢复/提示和最终 process exit。

失败语义：handler failure 被隔离记录；timeout 只发合作式取消并停止等待；overall deadline 跳过未开始低优先级项。底层 Promise/Task 可能在 report 之后继续收尾，不能被描述成物理取消。

兼容影响：H0 及 M05-M08 契约不变；H1 新增生命周期模块，不修改既有 Interactive/Headless 的领域事件投影。

## 累计回归

执行：

```powershell
cd "D:\agent\Claude code最新\mini-agent-harness"
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-h1-regression.ps1
```

结果：

```text
H1-in-progress regression: 12/12 checks passed (including S0 15/15)
TypeScript LifecycleCoordinator: 8/8
Python LifecycleCoordinator: 8/8
TypeScript strict: PASS
```

结论：M09 生命周期能力适合进入累计 H1；它修复了 snapshot-shaped registry 缺少 phase、failure isolation 与可解释报告的问题，同时保留“timeout 不等于物理取消”的真实边界。
