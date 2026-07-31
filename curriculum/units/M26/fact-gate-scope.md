# M26 事实闸门范围

源码根目录：`D:\agent\Claude code最新\claude-code-CLI`

只读审查，不得修改源码、教材或 Harness。

独立确认：

1. interaction/LLM/tool/blocked/execution/hook span 的 parent、context owner、并行 identity 和 orphan cleanup。
2. analytics metadata type、sink attachment queue、OTel user/tool content gate 与 beta tracing 的内容/hash/truncate 边界。
3. stream TTFT、attempt timing、retry/fallback 的 success/error logging。
4. streaming usage 是 cumulative 还是 delta，message_start/delta 如何合并，final/fallback/advisor cost 在哪里累计。
5. model price table、unknown model fallback、session restore 的准确性边界。
6. provider quota headers、policy limits 与一般 tenant token/cost quota是否为同一机制。
7. SerialBatchEventUploader 的 ordering、batch、retry、backpressure、drop、flush 和 close 语义。
8. 快照是否存在通用 Agent evaluation ledger。

建议优先阅读：

- `src/services/api/claude.ts`
- `src/services/api/logging.ts`
- `src/services/api/withRetry.ts`
- `src/cost-tracker.ts`
- `src/utils/modelCost.ts`
- `src/utils/telemetry/sessionTracing.ts`
- `src/utils/telemetry/betaSessionTracing.ts`
- `src/services/analytics/index.ts`
- `src/cli/transports/SerialBatchEventUploader.ts`
- `src/services/claudeAiLimits.ts`
- `src/services/policyLimits/`

只报告会改变 M26 核心事实、实验或 H7-2 契约的问题。不要读取 Graphify，不总结无关 UI，不修改任何文件。
