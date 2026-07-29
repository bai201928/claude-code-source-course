# I01 事实双闸门规范化汇总

状态：`completed`

## 规范化结果

```text
GATE: FACT_A
VERDICT: PASS
MATERIAL_ISSUES: 0
```

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

FACT_A 使用新的独立 Claude Code CLI/DeepSeek Max 会话，只开放 `Read,Glob,Grep`，未提供 I01 正文、Graphify、M01-M09 作者结论或 Mini Agent Harness。FACT_B 复用同一 session，只加入 I01 的精简结论、图语义和实验/Harness 边界。两次进程都未传入密钥、未设置 Claude 应用层超时、自然退出且 exit code 为 `0`；DeepSeek 未修改正文、源码快照、实验或 Harness。

原始结果保存在：

- `reviews/fact-review-a.md`
- `reviews/fact-review-b.md`

两份原始结果都在规定三行头部前输出了简短英文说明和 Markdown 围栏，属于输出格式偏差；本文件只规范化头部，不改写其事实内容，也不因此重跑闸门。

## 跨闸门裁决

### Issue: I01-FG-01

`FACT_A` 摘要称 Interactive 与 Headless 都进入 `QueryEngine.ask()`，与 I01 的关键路径发生冲突。

```text
Decision: rebutted as an I01 issue
Status: resolved by FACT_B and direct source check
Change: no draft change
```

理由：

- `claude-code-CLI/src/screens/REPL.tsx` 直接导入 `query`，`onQueryImpl` 内直接 `for await ... of query(...)`；该文件不导入或构造 `QueryEngine`。
- `claude-code-CLI/src/cli/print.ts` 导入并调用 `ask()`。
- `claude-code-CLI/src/QueryEngine.ts:ask` 创建 `QueryEngine`，`submitMessage()` 调用真正的 `processUserInput()`，满足条件后再调用 `query()`。

因此真实汇合点是：

```text
Interactive REPL -> onQueryImpl -> query()
Headless / SDK -> ask() -> QueryEngine.submitMessage() -> processUserInput() -> query()
```

FACT_B 在同一会话中回到上述 call site，明确更正 A；I01 “REPL 不经过 QueryEngine、两路在 query() 汇合”的正文和图语义正确。

## 审查者摘要误差

这些是原始审查文本自身的非阻断误差，不是 I01 问题：

1. FACT_A 的 QueryEngine 路径错误已由 FACT_B 纠正，见 `I01-FG-01`。
2. FACT_B 在能力小结中有一句“两路径都不在 query loop 内部迭代刷新”。直接源码显示 `claude-code-CLI/src/query.ts` 会在声明边界调用 Interactive 注入的 `toolUseContext.options.refreshTools()`；Headless 的 `QueryEngineConfig` 则捕获具体 tools，没有同样 callback。I01 正文正是按这个差异表述，因此不修改正文。
3. FACT_B 指出提示词中的“REPL 的 processUserInput / onQuery 边界”可能让人误以为 REPL 调用了 `processUserInput()` 真函数。I01 已明确 REPL 不经过 QueryEngine，且正文用的是运行边界概括；该措辞没有改变调用链、实验或 Harness 契约，按闸门规则不形成实质 Issue。

## 已核验结论

- 入口 fast path、Interactive/Headless owner、StructuredIO framing 与输出投影边界可由当前快照闭合。
- policy provider selection、managed drop-ins、merge 语义、trust 与 runtime decision 已分层；H1 revision/provenance 明确是设计迁移。
- Bootstrap、多个 AppState store、root identity、fresh read 与稳定 snapshot 的 owner/时间边界成立。
- runtime tool pool、模型 schema、visibility、permission 与 registry 分离；Interactive/Headless 刷新粒度差异成立。
- `yield*`、`for await`、部分提交、无界 `Stream<T>`、取消意图与资源确认的边界成立。
- turn、logical session、process shutdown 与 hard termination 分离；当前 registry 的 `Set + Promise.all` 与 H1 phased coordinator 没有混写。
- M02/M03/M05-M09 clean-room 实验支持 I01 声明的验证边界，但不能反向证明 Claude Code 采用 H0/H1 的类名和结构。
- H1 仍未被表述为拥有跨 prompt conversation owner、真实模型 provider、完整 Tool Loop、完整 Transcript/恢复或 Sandbox/分布式治理。

## 待裁决 Issue

`无`。

FACT_A 与 FACT_B 都没有报告需要修改 I01 正文、图、实验或 Harness 契约的实质问题。现有跨闸门冲突已经由 FACT_B 和直接源码检查解决。
