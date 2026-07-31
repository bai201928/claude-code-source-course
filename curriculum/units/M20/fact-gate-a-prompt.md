# M20 事实闸门 A：独立源码盲审

你是独立源码审查者。请先完整读取：

`D:\agent\Claude code最新\curriculum\units\M20\fact-gate-scope.md`

然后在其中给定的本地源码快照中独立核验 M20。不要读取 Graphify、M20 工作簿、Codex 结论、Mini Agent Harness、教材草稿、其他单元审查或历史聊天，不要修改任何文件。

只报告会改变 Tool ABI、Pre/Post Hook、Permission 优先级、updatedInput、decision provenance、取消、paired tool_result、执行副作用或 Permission/Sandbox 边界的结论。特别检查：Hook allow 是否仍受 deny/ask/safety rule 约束；rewrite 后是否统一重跑 schema 与 `validateInput`；多个并行 Hook 的决定与 input/provenance 怎样合并；permission resolve 到 `tool.call` 是否存在统一取消复查；PostHook block 能否撤销副作用。不要把普通措辞、理论漏洞或不影响教材的边缘问题列为 Issue。

必须以下列三行开头：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

每个实质 Issue 给出源码路径、符号/决定性分支、正确结论和教材风险。若没有问题，给出足以支撑同会话 FACT_B 的独立机制摘要和无法确认项。
