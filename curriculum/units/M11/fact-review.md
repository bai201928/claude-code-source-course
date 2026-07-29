# M11 事实闸门记录

状态：`fact-reviewed`

审查模型：Claude Code CLI 2.1.218，经 CC SWITCH 调用 DeepSeek Max（实际模型记录为 `deepseek-v4-pro[1m]`）。

有效会话 ID：`e26ae01e-0e19-42d6-a14c-27cd339d7586`

## FACT_A

```text
GATE: FACT_A
VERDICT: PASS
MATERIAL_ISSUES: 0
```

独立盲审确认：

- REPL 路径为 `handlePromptSubmit -> executeUserInput -> processUserInput -> onQuery -> onQueryImpl -> query()`，不实例化 `QueryEngine`。
- Headless/SDK 路径由 `print.ts` 共享 `mutableMessages`，经 `ask -> QueryEngine.submitMessage -> query()`。
- 两条路径在 `query()` 汇合。
- `state.messages -> messagesForQuery -> messagesForAPI -> params.messages` 是职责不同的投影层次。
- 生产模型链最终到达 `anthropic.beta.messages.create({ stream: true })`。
- `tool_use` 通过 streaming executor 或 `runTools/runToolUse` 形成配对 `tool_result`，再进入 next state。
- 流取消、工具取消和模型异常路径会收敛或补齐工具结果，避免孤立 `tool_use`。
- 快照缺少原始测试、构建元数据和部分编译期类型文件，不能声称原项目测试通过或确定所有 feature gate 的生产取值。

## FACT_B

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

同会话对照确认：

- Codex 对 REPL/Headless 状态所有权、汇合点和浅拷贝语义的表述与源码一致。
- “会话数组不会原样发送给模型”与请求投影链一致。
- “工具结果重新进入对话协议”与 `UserMessage` 中 `tool_result` 及 next state 组装一致。
- clean-room 实验中的两轮 scripted model、工具错误配对、取消后不继续和快照隔离均能验证拟写入教材的核心表述。

## Codex 裁决

有效 FACT_A/FACT_B 均没有实质 Issue，无需 accepted/rebutted 逐项裁决。

保留的证据边界：

- 教材将当前调用链标为 `快照事实`。
- TypeScript/Python fake model 实验标为 `运行验证`，不能声称运行了 Claude Code 原项目。
- Harness 模块边界标为 `设计迁移`。
- streaming 与 non-streaming tool executor 都会讲清，不把 feature gate 的未知运行值伪装成固定生产配置。

结论：进入教材编写和实现阶段。
