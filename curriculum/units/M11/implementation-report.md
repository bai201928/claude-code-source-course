# M11 实现与实验报告

状态：`implemented`

## 行为契约

TypeScript 与 Python clean-room 实现遵守同一组契约：

- 输入适配器只把外部输入转换为领域消息；
- `SessionStore` 是会话消息的唯一可变所有者；
- `RequestProjector` 从会话快照派生请求，不反向修改会话；
- `ModelAdapter` 只返回 assistant 消息，不直接执行工具；
- `AgentLoop` 拥有轮转、工具执行协调和终止判断；
- `tool_use.id` 与 `tool_result.toolUseId` 必须配对；
- 工具失败转换为可供模型理解的错误结果；
- 取消不得触发下一次模型请求，且已暴露的所有工具调用都有配对的取消结果。

## 实际验证

TypeScript：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M11\code\typescript"
node --experimental-strip-types harness.test.ts
node --experimental-strip-types demo.ts
```

结果：4 个契约测试全部通过；demo 产生 2 次 `model.request`，第二次请求的 `messageCount` 从 1 变为 3。

Python：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M11\code\python"
python -m unittest -v test_harness.py
python demo.py
```

结果：4 个 `unittest` 全部通过；demo 产生与 TypeScript 相同的两轮事件序列。

覆盖的代表性路径：

1. `tool_use -> tool_result -> 第二次模型请求 -> 最终文本`；
2. 工具异常转换为 `isError=true` 的协议消息；
3. 多个 `tool_use` 中首个执行期取消，已暴露调用全部配对，未执行工具不启动，且不会发起第二次模型请求；
4. 会话后续 append 不会改变已捕获请求的数组结构。

运行中曾发现 Node strip-only 不支持 TypeScript 参数属性语法，已改为显式字段声明与构造器赋值。

## 证据分类

- `快照事实`：正文中的 REPL/Headless 入口、消息所有权、请求投影、模型调用和 Tool Loop 结论来自当前静态源码快照，并已通过 FACT_A/FACT_B。
- `运行验证`：上述测试和 demo 只证明 M11 clean-room 行为契约，不代表 Claude Code 原项目测试。
- `设计迁移`：`SessionStore` 单一所有者、深复制实验投影、顺序工具执行和 `TraceSink` 是教学 Harness 设计，不是对 Claude Code 内部结构的声称。

## Harness 裁决

Decision: `merge`

Reason: 消息、请求投影、模型适配器、Tool feedback 和取消契约已在两种语言中通过对称测试，适合作为 H2 纵切首版。

Compatibility: 当前实现不假定 H0/H1 已发布，后续接入 Context、Permission、Hook、Transcript 和并发工具时必须保持本单元四个契约测试。

Boundary: 本次不合并持久化、恢复、真实 Provider、工具并发或完整 Context Pipeline；这些由后续单元逐步演进。

## 标杆增补后的回归

用户批准标杆并提出图文与面试表达校准后，正文新增内容没有修改 Harness 代码。回归结果：

- 9/9 Mermaid 图经 Mermaid CLI `11.16.0` 实际渲染成功；
- TypeScript 4/4 契约测试通过，demo 仍产生两次 `model.request`；
- Python 4/4 契约测试通过，demo 仍产生相同的两轮事件序列；
- `final.md` 继续保持缺失，M11 只同步为阶段发布前的 `release-candidate.md`。
