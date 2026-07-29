# M05 实现与实验报告

状态：`implemented`

## 独立行为契约

TypeScript 与 Python clean-room 实现遵守同一组 RuntimeSurface 契约：

- Interactive 与 Headless 把外部输入转换成同一种 `RuntimeCommand`；
- `RuntimeCore` 只产生 `DomainEvent`，不读取 TTY、React 或 output format；
- 不同表面对同一 command 保持相同 Core event 序列；
- Headless 的 text/json/stream-json 只改变输出投影；
- NDJSON 在 Core 调用前解析和校验，多行输入保持 command 顺序；
- surface close 后拒绝新输入，不产生伪 result；
- 未知 event 在投影边界显式失败；
- `SurfaceTrace` 只记录适配器边界，不拥有业务状态。

## M05 实际验证

TypeScript：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M05\code\typescript"
node runtimeSurface.test.ts
node demo.ts
powershell -NoProfile -ExecutionPolicy Bypass -File .\typecheck.ps1
```

结果：7/7 行为测试通过，demo 正常输出 Interactive 与 stream-json 投影，strict typecheck 通过。

Python：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M05\code\python"
python -m unittest -v test_runtime_surface.py
python demo.py
```

结果：7/7 `unittest` 通过，demo 产生与 TypeScript 相同的 Core event 顺序和对应表面输出。

运行中发现 Node 24 strip-only 不支持 TypeScript 构造器参数属性，已改为显式字段声明与构造器赋值。另一个 strict narrowing 问题来自已经排除 `progress` 后仍保留不可达 case，删除死分支后 typecheck 通过。两项修正均未改变行为契约。

## H1-in-progress 合入

Decision: `merge`

新增：

- `mini-agent-harness/typescript/h1.ts` 与 `h1.test.ts`；
- `mini-agent-harness/python/h1.py` 与 `test_h1.py`；
- `mini-agent-harness/contracts/h1-contract.md`；
- `mini-agent-harness/tests/run-h1-regression.ps1`。

`H0RuntimeCore` 把 H0 的 progress/assistant/exception 映射为 progress/result/failure；Surface 再负责 display、text、JSON 或 NDJSON 投影。H0 文件和 S0 回归脚本未修改。

累计回归：

```powershell
cd "D:\agent\Claude code最新\mini-agent-harness"
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-h1-regression.ps1
```

实际结果：H1 4/4 检查通过，其中包含 S0 原有 15/15 全量回归；H1 TypeScript 8/8、Python 7/7 行为测试通过，TypeScript strict 通过。

## 教学候选稿自检

- `draft.md` 中 10/10 Mermaid 图已使用 Mermaid CLI `11.16.0` 实际渲染成功；
- 首轮渲染发现 sequence diagram 的 participant 别名 `Loop` 与 Mermaid 语法冲突，已改为 `AgentLoop`，运行方向和教材含义未改变；
- 图修正后重新执行 M05 TypeScript 7/7、Python 7/7、TypeScript strict 与 H1 全量回归，全部通过。

## 兼容与边界

- H1 当前为 `H1-in-progress`，将在 M06-M09 继续演进。
- M05 证明 Interactive 表面可连续接收 prompt，但不声称多个 H0 run 已共享会话历史；后续单元决定真正的 session owner。
- 本次不加入配置优先级、CapabilitySnapshot、完整启动/关闭预算、真实模型、Tool Loop 或持久化。
- `快照事实` 来自当前 Claude Code 静态源码并已通过 M05 FACT_A/B；上述测试只属于 `运行验证`；H1 分层属于 `设计迁移`。
