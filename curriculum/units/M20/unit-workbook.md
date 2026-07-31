# M20 作者工作簿：Tool ABI、Permission 与 Hook 决策链

状态：`researched / awaiting FACT_A`

风险：`R2`。本单元涉及输入改写、权限、安全边界、并发 Hook、取消窗口和工具副作用。

## 1. 本单元只回答一个问题

模型已经输出一个结构合法的 `tool_use`，为什么执行器仍不能直接调用 handler？

本单元沿一条工具调用闭合：

```text
tool_use
-> schema / tool.validateInput
-> PreToolUse hooks
-> hook decision 与 permission policy 合流
-> rule / mode / classifier / human 或 PermissionRequest hook
-> tool.call
-> PostToolUse 或 PostToolUseFailure
-> 与 tool_use_id 配对的 tool_result
```

M15 已讲 Tool Loop 的调度、并发与结果配对；M20 聚焦单个 call 内部的执行治理。Sandbox 的隔离实现留给 M25，只在此解释它为什么不是 Permission 的同义词。

## 2. 精简源码地图

- `src/Tool.ts -> Tool`：Tool ABI，包含 schema、`validateInput`、`checkPermissions`、`call`、结果映射、并发/只读/破坏性元数据。
- `src/services/tools/toolExecution.ts -> checkPermissionsAndCallTool`：一次 call 的总编排和 paired result owner。
- `src/services/tools/toolHooks.ts -> runPreToolUseHooks / resolveHookPermissionDecision / runPostToolUseHooks / runPostToolUseFailureHooks`：Hook 结果到执行决策的适配层。
- `src/utils/hooks.ts -> executeHooks / executePreToolHooks / executePermissionRequestHooks`：Hook 匹配、并行执行、timeout/abort、输出解析与聚合。
- `src/utils/permissions/permissions.ts -> hasPermissionsToUseTool / hasPermissionsToUseToolInner / checkRuleBasedPermissions`：规则、模式、classifier、headless PermissionRequest Hook。
- `src/hooks/useCanUseTool.tsx` 与 `src/hooks/toolPermission/`：交互式 permission dialog、classifier/Hook/user race、decision logging。
- `src/types/permissions.ts`：Permission mode、allow/ask/deny、updatedInput、decisionReason。
- `src/tools/BashTool/shouldUseSandbox.ts`、`BashTool.tsx`：Sandbox 只在实际 Bash 执行层施加资源约束；permission pipeline 只把 sandbox 状态作为部分决策输入。

## 3. 已由直接源码确认的运行链

### 3.1 输入先成为可治理对象

`checkPermissionsAndCallTool()` 首先执行 `tool.inputSchema.safeParse(input)`，失败立即生成 `is_error: true` 且带原 `tool_use_id` 的 user/tool_result。通过后再执行可选 `tool.validateInput(parsedInput.data, context)`；失败同样配对返回。

Bash 的 `_simulatedSedEdit` 还会被 defense-in-depth 删除。`backfillObservableInput` 只在浅 clone 上补观察字段，使 Hook、Permission、SDK/Transcript 能看到兼容字段，但不默认污染 `tool.call()` 的原始输入。如果后续 Hook 或 Permission 返回 fresh `updatedInput`，替换会有意进入 call。

### 3.2 PreToolUse 是并行观察与决策，不是单个布尔回调

`executeHooks()` 并行启动匹配 Hook。单个结果可以带 progress、diagnostic、blockingError、preventContinuation、stopReason、additionalContext、permission behavior 或 updatedInput。

多个 Hook 的 permission behavior 按 `deny > ask > allow` 聚合，不应讲成“最后完成者获胜”。Hook cancel、解析异常和运行异常会形成 attachment/diagnostic；`runPreToolUseHooks()` 的外层异常或检测到 abort 会 yield `stop`，总编排据此提前生成配对 stop tool_result。

需要闸门复核的并发细节：permission behavior 是累计变量，而 yielded reason/source/updatedInput 来自当前完成的 Hook；教材不把它包装成完整、不可混淆的 provenance ledger。Harness 使用显式 ordered `DecisionEvidence[]`，避免把一个汇总决定错误归因给单个 Hook。

### 3.3 Hook allow 只免去默认 prompt，不越过显式规则

`resolveHookPermissionDecision()` 的实现约束：

- Hook `deny` 直接拒绝；
- Hook `ask` 或无决定进入普通 `canUseTool`，可携带 forceDecision/updatedInput；
- Hook `allow` 仍调用 `checkRuleBasedPermissions()`；tool deny、content ask 和 bypass-immune safety check 可覆盖 allow；
- `requiresUserInteraction` 且 Hook 未提供 updatedInput，或 `requireCanUseTool` 为真时，仍必须进入 `canUseTool`；
- requires-interaction 工具若由 Hook 返回 updatedInput，可把该 Hook 视为交互适配器，但仍不能跳过 deny/ask rule。

所以正确心智模型不是一条固定的 `hook -> policy -> human` 串行链，而是 Hook 先提出输入/决定，rule/mode/tool-specific check 再决定能否自动落地，必要时进入不同表面的交互适配器。

### 3.4 Permission 的实际优先层

`hasPermissionsToUseToolInner()` 的关键顺序：

```text
abort precheck
-> entire-tool deny
-> entire-tool ask（sandboxed Bash 有受控例外）
-> tool.checkPermissions（schema.parse 后调用）
-> tool deny
-> requiresUserInteraction
-> content-specific ask
-> safetyCheck
-> bypassPermissions / plan-bypass
-> entire-tool allow
-> passthrough 转 ask
```

外层 `hasPermissionsToUseTool()` 再处理：

- allow 时重置 auto-mode denial streak；
- `dontAsk` 在末端把 ask 变 deny，防止早期 ask 绕过；
- auto mode 对不可 classifier approve 的 safety check 保持人工/无 UI 时 deny；
- PowerShell、requires-interaction、acceptEdits fast path、safe-tool allowlist、side-query classifier 各有分支；
- classifier unavailable 是否 fail closed 受 gate 控制，不能泛化成永远 fail closed；
- headless/async 无法显示 dialog 时先跑 PermissionRequest Hook，无决定才 auto-deny；Hook 异常落到 auto-deny，而不是自动放行。

### 3.5 interactive、headless、async agent 不是同一交互外壳

交互式路径由 `useCanUseTool()` 和 `handleInteractivePermission()` 建立 queue item；Hook、classifier、bridge/channel 与用户输入可能竞争，`createResolveOnce().claim()` 保证一个 winner。多处 `resolveIfAborted()` 防止等待后弹出 stale dialog。

headless/async agent 依赖 `shouldAvoidPermissionPrompts`：PermissionRequest Hook 可 allow/deny；无决定则 deny。Hook deny 的 `interrupt` 可 abort 整个 controller。PermissionRequest Hook allow 可附带 updatedInput 和 permission updates。

### 3.6 allow 之后才发生副作用，PostHook 无法撤销它

总编排只在最终 decision 为 allow 后调用 `tool.call()`。非 allow 会立刻生成 error tool_result；auto classifier deny 后的 PermissionDenied Hook `retry: true` 只告诉模型可重试，不把当前 deny 改成成功。

工具成功后先形成或准备 tool_result，再执行 `PostToolUse`；非 MCP 工具的 result 在 PostHook 前已加入消息数组，MCP 因允许 Hook 改写 output 而延后映射。PostHook block/stop/additional context 都发生在 handler 副作用之后，最多改变后续 Agent continuation 或可见输出，不能称回滚。工具 throw/AbortError 则进入 `PostToolUseFailure`，最终仍产生 error tool_result。

`toolExecution.ts` 的总编排拥有“一次 `tool_use` 返回一组更新，其中含一个配对 tool_result”的职责；Hook attachment 是旁路消息，不能代替 paired result。

## 4. 两个必须醒目标注的快照弱保证

### 4.1 updatedInput 没有统一的二次业务验证

初始 schema 与 `validateInput()` 在 PreToolUse 之前执行。Hook、PermissionRequest Hook 或用户 dialog 之后可以返回 fresh `updatedInput`。Permission 内部会尝试 `tool.inputSchema.parse(input)` 以执行 `checkPermissions`，但 parse 异常被记录后继续后续 mode/rule 路径；总编排在最终 allow 后没有再次统一执行 `safeParse + validateInput`。

因此不能写“任何改写都会重新完整验证”。当前快照在某些路径会由 permission parsing 间接拦住，但这不是统一 post-rewrite invariant。H4-1 必须采用：每次 rewrite 生成新 revision，重新 schema + semantic validation 后才能继续决策。

### 4.2 permission resolve 到副作用之间没有统一最后取消闸门

permission 检查和交互 handler 多处观察 AbortSignal，但 `checkPermissionsAndCallTool()` 在最终 allow、日志和输入收敛后直接进入 `tool.call()`，没有统一的 `throwIfAborted()`。具体工具可能在 handler 内观察 signal，例如 Bash 把 controller 传给 shell；但不能把这种工具内协作说成执行器级强保证。

H4-1 在决策后、side effect 前做最后一次 cancel recheck，并在 handler 返回后再次归一化取消结果，保证取消也只提交一个 paired result。

## 5. Permission 与 Sandbox 的边界

Permission 回答“是否授权这次能力调用，以及输入是否需要改写”；Sandbox 回答“即使获准，进程实际能读写什么、访问什么网络、以什么资源边界运行”。

两者会交叉：sandboxed Bash 可影响 ask/auto-allow 判断，`dangerouslyDisableSandbox` 或 excluded command 会改变是否实际 sandbox。但 Permission allow 不证明已隔离，Sandbox 拒绝也不是 permission deny；后者通常表现为执行阶段错误。M20 只建立这一接口边界，M25 再展开隔离、策略和逃逸面。

## 6. Evidence status

- `快照事实`：以上调用、类型、分支均来自当前 `claude-code-CLI/src` 直接读取。
- `Graphify 候选`：Tool、toolExecution、toolHooks、permissions、useCanUseTool 和 hooks 社区只用于缩短定位，不进入教材证据。
- `待 FACT_A/B`：Hook 并发汇总的 provenance 边界、rewrite 后验证缺口、决策后取消窗口、PreToolUse preventContinuation 的精确语义、PostHook 与 paired result 的先后差异。
- `设计迁移`：H4-1 的 immutable DecisionContext、revisioned rewrite、统一 revalidation、pre-effect cancel gate、content-free trace。

## 7. 实验与 H4-1 候选契约

同一个 tool call 经过：visible -> schema -> pre-hook -> policy -> human/headless adapter -> handler -> post-hook -> paired result。

代表性实验：

1. Hook allow 与 deny rule 冲突，最终必须 deny，provenance 同时保留 hook proposal 与 policy winner。
2. Hook 把合法输入改成非法输入，必须在 H4-1 rewrite revision 上失败，handler 调用次数为 0。
3. Permission allow 后触发 cancel，最后副作用闸门必须阻止 handler，仍生成一个取消 tool_result。
4. handler 已成功产生副作用后 PostHook block，只阻止 continuation，不宣称回滚。
5. headless ask 无 resolver 时 fail closed；resolver Hook throw 也不能 allow。
6. 任意 deny/throw/cancel 路径都恰好产生一个与 call ID 配对的结果。
7. Trace 只记录 tool/call/revision/decision source/outcome/duration，不记录 command、path、Hook stdout 或 tool output。

Harness 决策候选：`merge`。新增 `ExtensionDecisionPipeline`、Hook ABI、immutable/revisioned DecisionContext、Rule/Human ports、validation stages、exactly-one result finalizer 和 content-free trace。Claude Code 的所有 mode/classifier/UI 分支不照搬。

## 8. 教材叙事与局部图计划

- 章首：一个 call 的六道边界总图。
- 初始验证之后：observable input 与 call input 的所有权图。
- 多 Hook：并行执行与 `deny > ask > allow` 汇总图。
- Permission：rule/tool/mode/classifier/human 决策树。
- 表面差异：interactive 与 headless 时序对照。
- allow 到 call：取消窗口图。
- 成功/失败：PostToolUse、PostToolUseFailure 与 paired result 时序图。
- 边界：Permission 与 Sandbox 双轴图。
- Harness：revisioned DecisionContext 状态图。

面试重点预计 8 题左右，由最终叙事自然决定：Permission/Hook 优先级、rewrite revalidation、决策 provenance、取消窗口、exactly-once pairing、PostHook 回滚误区、headless fail-closed、Permission/Sandbox 分界。
