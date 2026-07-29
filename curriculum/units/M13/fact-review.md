# M13 事实闸门记录与 Codex 裁决

状态：`fact-reviewed`

审查会话：`8e99a06c-3a7f-47ad-9c9a-e3cd80815802`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max；FACT_A 首轮路由包含 `deepseek-v4-flash`，主审与后续对照实际模型为 `deepseek-v4-pro[1m]`。三次进程均自然退出，无应用层超时、无权限拒绝。

## 闸门结果

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 5
```

```text
GATE: FACT_B
VERDICT: REVISE
MATERIAL_ISSUES: 3
```

修订双语言实验后，在同一会话进行定向复审：

```text
GATE: FACT_B_RECHECK
VERDICT: PASS
MATERIAL_ISSUES: 0
```

闸门头部不是自动裁决。Codex 回到当前源码快照核验每项结论，并用修订后的 TypeScript `9/9`、strict typecheck 与 Python `8/8` 作为实验反证。

## 已确认事实

- `queryLoop()` 每轮从 `State.messages` 派生 producer-local `messagesForQuery`；初始 spread 只复制数组容器。
- 顺序为 compact/snip 可见范围、tool-result budget、snip、microcompact、context collapse、autocompact、user context、`queryModel()`。
- `normalizeMessagesForAPI()` 是过滤、重排、合并、转换和校验，不是普通 JSON 序列化。
- `ensureToolResultPairing()` 位于 normalize 之后；默认 repair 服务兼容恢复，strict 模式在需要 repair 时抛错。
- `paramsFromContext()` 在正规化后组装 model、messages、system、tools、betas、thinking、cache 等参数；主流式路径调用 `messages.create({ ...params, stream: true }, { signal, ... })`。
- durable conversation、query view、API messages 与最终 wire params 是四层不同对象；中间投影不等于删除 durable membership。
- `ContentReplacementState` 是独立的跨轮 owner。seen-but-visible 与 already-replaced 两种决策都会冻结，避免后续请求改变已经形成的 prompt prefix。

## 接受并修正

### B-1 user context 层位

Decision: `accepted`

旧实验在 normalize 和 pairing 之后注入 context，虽然简单样例结果相近，却把 query-local 注入误画成 API 层操作。现已在两种语言中先构造 request-local `user-context`，再进入 normalize，并以 `<system-reminder>` 作为可观察包装。

### B-2 API user-group 预算

Decision: `accepted with corrected rationale`

旧实验把全部 tool result 放进全局池，不足以验证真实的 per-wire-user-message 契约。现按新的 assistant response 边界分组，相同 response 的 assistant fragments 不重复切组；两个不同 round 各 80 字符、预算 100 的反例证明不能使用全局 160 字符判断。

FACT_B 曾声称“两个相邻 user message 各自独立预算”，该说法被源码驳回：`collectCandidatesByMessage()` 正是为了把 normalize 后会合并的相邻 user/progress/attachment 视作同一 wire group。

### B-3 replacement state

Decision: `accepted`

实验新增 `ContentReplacementState`。一次可见但未替换的旧结果在以后变为 seen/frozen；一次已替换的结果从 Map 复用同一 preview。新测试分别反证“提高预算后恢复全文”和“新内容出现后改替换旧前缀”两种错误实现。

### A-5 test mode context guard

Decision: `accepted for teaching boundary`

`prependUserContext()` 在 `NODE_ENV === 'test'` 时直接返回输入。教材会说明这是 Claude Code 快照的测试隔离行为；clean-room 实验验证的是请求投影契约，不冒充运行该生产 helper，因此不复制这个环境短路。

## 驳回或降级

### A-1 `stream: true` 不属于主请求参数

Decision: `rebutted`

FACT_A 引用了 `src/services/api/claude.ts` 约 864 行的 non-streaming fallback，并据此声称 `stream: true` 只在第二参数。主流式路径在约 1822 行，源码明确为：

```text
anthropic.beta.messages.create({ ...params, stream: true }, { signal, ... })
```

所以工作簿和教材应继续把 `stream: true` 视为主流式 payload 的最后装配字段，同时区分第二参数里的 signal/headers。

### A-2 snip/context-collapse 缺失作为“新 Issue”

Decision: `already bounded`

工作簿和中性范围已经声明 feature-gated 实现文件在当前快照缺失，只能确认调用接口、顺序、调用侧注释和返回值使用。该限制保留，但不阻断本单元。

### A-3 boundary 过滤是隐式依赖

Decision: `accepted wording, not an implementation defect`

`getMessagesAfterCompactBoundary()` 的注释和 `normalizeMessagesForAPI()` 的普通 system filter 共同确认 boundary 被保留到 query view、随后不会进入 API。教材会把两步依赖画清，不虚构独立 `removeBoundary()`。

### A-4 预算必须在 normalize 前的理由

Decision: `clarified`

关键不是“normalize 后无法预算”，而是预算必须按 normalize 最终会形成的 user group 提前分组，并在 microcompact 只按 tool-use ID 工作之前冻结替换决策。顺序与 owner 契约均已进入实验。

## 结论

事实闸门闭合。M13 可以基于“四层对象、投影编译器、独立 replacement state、strict/repair 取舍”编写正文并合入累计 Harness；完整 snip、microcompact、autocompact、外置结果存储、resume record 与 Prompt Cache edit 继续留给 M16-M18。

