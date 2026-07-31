# M16 事实闸门 B：同会话对照

继续当前 FACT_A 会话。现在对照 Codex 的研究结论，只检查错误、重要遗漏、证据不足、版本混淆或推断冒充事实，不重复总结仓库。

## Codex 结论

- `queryLoop()` 从 `state.messages` 经 last compact boundary 创建浅容器 `messagesForQuery`；这是 request view，不是 durable delete，嵌套 message/block 仍可能共享引用。
- per-tool 大结果处理位于 `runToolUse()` 结果映射到 user message 之前；aggregate API-user-group budget 位于 history view 上，只 copy-on-write 替换本轮 tool-result content。两者时点和 durable 语义不同。
- aggregate budget 按最终 normalize 会合并的 user group收集候选：新的 assistant response ID 才形成边界；progress、attachment、system 和相同 response ID fragments 不能错误拆组。
- `ContentReplacementState.seenIds/replacements` 每 conversation thread 稳定持有，冻结已观察决策；已 replacement 的 exact preview 跨轮重放并可记录到 Transcript，resume 重建，主要保护 Prompt Cache 前缀。
- 单次 enforcement 在 await 后同时写 `seenIds` 与 `replacements`，但源码没有通用 revision transaction；快照依赖 per-thread owner、clone/fresh 与串行运行边界。可并发 Harness 应增加 expected-revision stale-write rejection，这属于设计迁移。
- 顺序是 aggregate budget -> snip -> microcompact -> context collapse -> autocompact -> request user context -> normalize/pairing -> cache breakpoints/wire。缺失 snip/context-collapse/cached-MC 文件只讲现存接口，不补造算法。
- cached microcompact 的可见路径返回原 local messages，把 deletion 变为 API cache edit；time-based path 在 cache 已冷时 copy-on-write 清除旧 tool-result content并重置 cached state。接受 FACT_A 的补充：compact 层用 `startsWith('repl_main_thread')`，API `useCachedMC` 却严格等于 `repl_main_thread`；output-style variant 的 pending edit 可能被消费但不进入 wire，这是快照缺口。
- 用户轮次附件在 `processUserInput()` 中随 user message进入；Tool Loop 中途附件在全部 tool results 后进入 next state，避免普通 user 内容夹在 tool-result 区。attachment 会在 normalize 后影响真实请求，但不属于 aggregate tool-result 字符预算本身。
- 字符阈值、rough/API token、最终 user-message group 和 normalize/cache 后 wire payload 是四种不同单位/表示，不能互换。
- persist 失败会保留原 content并冻结；replacement Transcript append 是异步调用，不能宣称已形成 crash-durable transaction。
- replacement state 不是全局共享事实：cache-sharing fork clone 父 state；AgentTool resume 以 sidechain records 重建并用父 replacements 补齐；swarm teammate 使用 fresh state。

## 拟验证实验

TypeScript/Python deterministic 实验比较 global truncation、per-result preview 和 aggregate final-group budget；验证 source snapshot 不变、同 ID result 配对、相同 response fragments/attachment 不误拆组、重复 projection byte-stable、orphan history start fail closed，以及 revision ledger 拒绝 stale writer。

## Harness 候选

合入 aggregate group budget、replacement ledger/metadata、strict post-projection validation 和 revision gate；保留 per-result preview 兼容边界。外置文件、Transcript resume、Provider-specific cache edits、snip/full compact 延后。拒绝原地裁剪、全局字符串截断、无 revision 共享 Map 和 Provider adapter 临时修补。

必须以下列三行开头：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

仅报告实质问题，普通边缘问题不阻断。不得修改任何文件。
