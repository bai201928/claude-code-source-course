# M01 实现与实验报告

状态：`implemented`

## 行为契约

TypeScript 与 Python clean-room 实现遵守同一组 H0 契约：

- 消息变体拥有稳定判别字段和各自载荷；
- 外部 `unknown`/`object` 数据必须经过运行时 parser；
- RunState 值域与合法 transition 分开建模；
- Tool 泛型关联内部输入输出，外部输入仍先验证；
- 新增消息变体时，TypeScript 的穷尽分支应产生编译反馈；
- TypeScript 与 Python 使用相同行为断言，不要求语法逐行一致。

## 实际验证

TypeScript：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M01\code\typescript"
node --experimental-strip-types contracts.test.ts
node --experimental-strip-types demo.ts
npx -y -p typescript tsc --project tsconfig.json
```

结果：4 个行为测试通过；demo 完成 `idle -> running -> completed`，工具输出为结构化温度；`tsc --strict --noEmit` 通过，并确认两个 `@ts-expect-error` 分别对应错误消息变体和错误 Tool 输入。

第一轮 typecheck 暴露了一个真实陷阱：让泛型参数同时从 Tool 与 raw input 推断时，错误输入可能参与推宽。最终契约把边界拆为：`executeTypedTool()` 用 `NoInfer<Input>` 保护已验证的内部调用；`executeTool()` 接收 `unknown` 并在运行时验证。这样静态边界与外部边界不再混称。

Python：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M01\code\python"
python -m unittest -v test_contracts.py
python demo.py
```

结果：4 个 `unittest` 通过；demo 产生与 TypeScript 等价的消息摘要、工具结果和终态。Python type hint 本轮未通过 mypy/pyright 单独检查，因此只把运行测试称为运行验证。

## 覆盖的代表性路径

1. 判别字段选择合法消息载荷；
2. 错误 user JSON 被运行时 parser 拒绝；
3. 字段值合法但 `completed -> running` 迁移非法；
4. Tool 内部泛型关联与外部输入校验同时成立。

## 证据分类

- `快照事实`：教材里的 Claude Code 类型模式与缺失边界来自当前只读快照。
- `运行验证`：双语言测试、demo 与 TypeScript typecheck 只验证 M01 clean-room 契约。
- `设计迁移`：`HarnessMessage`、`RunState`、transition table、parser 和 WeatherTool 是 H0 教学实现。

## Harness 裁决

Decision: `merge`

Reason: 判别联合、运行校验、状态迁移和 Tool 泛型是后续 Message、Query、Tool、Task、取消与恢复机制的共同前置，且双语言行为测试已对称通过。

Compatibility: 后续单元可以增加消息变体和 RunState 载荷，但必须保持现有 parser 拒绝非法组合、终态不可重启和 Tool 外部输入先验证。

Boundary: 本单元不接入真实模型、消息存储、并发、取消、持久化或 Provider schema。

## 候选稿回归

- 9/9 Mermaid 图经 Mermaid CLI `11.16.0` 实际渲染成功；
- 事实闸门有效会话无权限拒绝，FACT_B 为 `PASS / 0`；
- 教学闸门独立会话为 `PASS / 0`，确认图文、实验、迁移与面试表达达到已批准标杆；
- `final.md` 保持缺失，阶段发布前只生成 `release-candidate.md`。
