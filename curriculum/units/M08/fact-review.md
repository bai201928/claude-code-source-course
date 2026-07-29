# M08 事实闸门记录

状态：`fact-reviewed`

事实会话：`79993031-52aa-439a-9941-02da8b2163b5`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max；主审模型为 DeepSeek Max 路径，两个进程均自然退出，无应用层超时、无权限拒绝。

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 6
```

盲审独立确认了启动发现、command/skill/agent 来源、runtime tool pool、Interactive/Headless 刷新差异、prompt 组装、Tool Search、schema cache 与 plugin 激活边界。

Codex 裁决：

- base command 不统一去重、`findCommand` first-wins、全数组消费者仍可见同名项：`accepted`；正文不再宣称一个全局唯一 command 优先级，Harness 改用显式 priority；
- Headless `QueryEngine.submitMessage()` 不走 Interactive `buildEffectiveSystemPrompt()`：`accepted`；正文分开两条 prompt 组装路径；
- custom system prompt 会同时跳过 default prompt 与 system context：`accepted`；作为 replace 的真实代价写入；
- Headless 单次 submit 没有 Interactive `refreshTools` callback：`accepted`；正文明确刷新粒度非对称；
- schema cache 在同名且 cache key 不变时会保留首次 description/base：`accepted with narrowing`；带显式 JSON schema 的 input schema 改变会形成新 key，不把所有 MCP schema 变化都说成陈旧；
- dynamic skill 的去重不能推广到 base commands：与第一项合并处理，不重复建立问题。

## FACT_B

同一会话对照后结果：

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

审查者逐项确认：

- builtin/plugin 注册先于 memoized command discovery，MCP 继续异步推进；
- command 消费者的同名解析、Agent 后写覆盖和 runtime tool pool 装配描述准确；
- Interactive 在 Tool Loop 模型迭代间刷新，Headless 单次 submit 通常稳定；
- Interactive/Headless prompt builder 的非对称与 custom prompt 跳过 system context 的边界准确；
- Tool Search、deferred/discovered、schema cache 和 delta attachment 的分层准确；
- plugin 安装、cache-only、needsRefresh 与 `refreshActivePlugins()` 的激活关系准确；
- 五层 clean-room capability 契约与源码事实无冲突。

## 结论

M08 事实范围已闭合。正文不得把能力写成永久启动清单，不得把 runtime pool 等同于 API schemas，不得把 attachment 等同于 handler 注册，也不得把 Interactive 的刷新/prompt 规则外推到 Headless。

