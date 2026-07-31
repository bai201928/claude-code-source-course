# M20 实现与实验报告

状态：release-candidate

## 事实闸门

~~~text
FACT_A: PASS / 0
FACT_B: PASS / 0
~~~

两道闸门确认 Tool ABI、初始 validation、并行 PreToolUse、Permission 合流、interactive/headless、paired result、PostHook 与 Permission/Sandbox 的主链，也确认四个重要边界：多个 Hook 的 behavior 安全单调但 rewrite/provenance 不构成确定 ledger；fresh input 无统一双重再验证；final allow 到 tool.call 无统一 executor abort recheck；preventContinuation/PostHook stop 不能回滚副作用。

## Harness H4-1

Decision：merge + defer + reject。

Merge：双语言 ExtensionDecisionPipeline、ordered Hook ABI、immutable revisioned DecisionContext、每次 Hook/resolver rewrite 后 schema + semantic revalidation、重新过 policy、metadata-only DecisionEvidence、final pre-effect cancel gate、headless ask fail-closed、post-effect continuation、Scheduler outcome metadata 与 Runtime trace。

Defer：Claude Code 全部 permission mode/classifier/UI、进程 Sandbox、distributed policy service、durable approval queue、外部副作用 exactly-once、SIEM/OTel backend。

Reject：Hook allow 越过 policy、last-writer-wins mutable input、resolver rewrite 不验证、PostHook 假装 rollback、缺 resolver时自动 allow、permission/content reason 直接进入普通 trace。

## 实际运行结果

~~~text
Harness TypeScript ExtensionDecision: 7/7
Harness Python ExtensionDecision: 7/7
Harness TypeScript strict typecheck: passed

Integrated TypeScript Agent tests: 75/75
Integrated Python Agent tests: 50/50
H2 regression: 4/4
H1 regression: 12/12
S0 regression: 15/15
Integrated regression: 4/4
~~~

其中 75/75 来自当前 package test 的 1+27+5+7+8+7+5+5+7+4；Python 50/50 来自 Agent、Compact、Instruction、Memory、Scheduler、ExtensionDecision 与 Streaming 的累计集合。

验证覆盖 Hook allow + policy deny、rewrite 非法输入、resolver rewrite 再验证/再授权、allow 后取消、PostHook stop 不回滚、headless ask fail-closed、一个 call 一个 outcome、metadata-only evidence，以及旧 Scheduler/ConversationStore/Context/Memory/Stream 契约无回退。

## 教学闸门与图表

~~~text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
~~~

独立 Claude Code/DeepSeek Max 会话只读取最高需求、标杆规则和 M20 正文。15 个 Mermaid block 使用 Mermaid CLI 11.16.0 从完整 Markdown 提取并实际渲染，结果 15/15。

M20 已生成 release-candidate.md；S4 尚未原子发布，因此不创建 final.md，也不更新阶段 README。
