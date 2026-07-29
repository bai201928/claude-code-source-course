# M10 事实闸门范围

## 审查目标

独立重建当前 Claude Code 快照中“内部消息如何成为可变会话状态、一次 turn view、工具关联与可恢复 transcript 节点”的最小模型。

请回答：

1. Interactive REPL 与 Headless/SDK 分别由谁拥有跨轮消息容器；AppState 是否直接拥有 REPL 主消息数组。
2. REPL `messages`、`messagesRef`、包装 `setMessages` 和 `onQueryImpl` 的同步/渲染关系。
3. `print.ts mutableMessages`、`ask()`、`QueryEngine.mutableMessages` 的引用关系；普通 push、slash-command `setMessages`、snip/compact/clear 后是否仍保持同一外部数组 owner。
4. `const messages = [...this.mutableMessages]` 只隔离什么；streaming assistant message在 yield 后是否仍被字段级修改。
5. 从可见构造函数、switch、type guard 与 SDK schema 能确认哪些 message family；缺失 `src/types/message.ts` 和 generated SDK type 对结论有什么限制。
6. envelope `uuid`、assistant provider `message.id`、`tool_use.id`/`tool_result.tool_use_id`、`sourceToolAssistantUUID`、serialized `parentUuid`、SDK `session_id`/`parent_tool_use_id` 的不同职责。
7. tool result为何使用 user role却不能被当作 human turn；当前谓词是否覆盖全部历史/边缘形状。
8. progress 与 attachment在内存、SDK、API 投影和 transcript 中分别如何处理；`recordTranscript` 邻近注释是否与 `cleanMessagesForLogging/isLoggableMessage/isTranscriptMessage` 一致。
9. `sessionStorage.insertMessageChain/buildConversationChain/recoverOrphanedParallelToolResults` 如何处理普通链、并行 tool result、cycle 和 legacy progress。
10. API 前 tool use/result唯一性、相邻配对、strict failure 与 synthetic repair 的真实边界；不要展开 M13 的全部 normalization。
11. 哪些结论属于快照事实，哪些因缺失类型/测试只能缩小表述，哪些适合作为 clean-room Harness 迁移。

## 源码根目录

```text
D:\agent\Claude code最新\claude-code-CLI
```

## 优先阅读路径与符号

- `src/screens/REPL.tsx`：`messages/messagesRef/setMessages`、`onQuery` / `onQueryImpl`。
- `src/utils/handlePromptSubmit.ts`：`processUserInput` 聚合、`newMessages`、`onQuery`。
- `src/cli/print.ts`：`mutableMessages`、逐 command `ask()`。
- `src/QueryEngine.ts`：constructor、`ProcessUserInputContext.setMessages`、`submitMessage()`、event switch、`ask()`。
- `src/utils/processUserInput/processTextPrompt.ts` 与 `processUserInput.ts`。
- `src/utils/messages.ts`：message creators、`normalizeMessages`、`normalizeMessagesForAPI`、`ensureToolResultPairing`。
- `src/utils/messagePredicates.ts`：`isHumanTurn`。
- `src/utils/attachments.ts`：`createAttachmentMessage`。
- `src/query.ts`：`yieldMissingToolResultBlocks`、tool result收集和 next-state拼接。
- `src/services/api/claude.ts`：stream `content_block_stop` 与 `message_delta`、API 前 normalization/pairing。
- `src/utils/sessionStorage.ts`：`isTranscriptMessage`、`isChainParticipant`、`insertMessageChain`、`recordTranscript`、`cleanMessagesForLogging`、`buildConversationChain`、并行 tool-result recovery、legacy progress bridge。
- `src/entrypoints/sdk/coreSchemas.ts`：公开 SDK message schema。

## 证据边界

- 当前快照缺失 `src/types/message.ts` 和 `src/entrypoints/sdk/coreTypes.generated.ts`；不要伪造其完整内容。
- 可以从使用点与 Zod schema确认必要字段，但必须标明无法确认的完整 union/可选字段。
- 只读当前快照；官方仓库/CHANGELOG只用于公开行为对照，不能覆盖快照事实。
- Graphify 只曾用于 Codex 的候选定位，不向审查者提供，也不能作为证据。
- 禁止修改任何文件。

## 本单元边界

不要求完整审查 Context Pipeline、query recursion、tool scheduling、权限、Hook、MCP、compact、fork 或所有 Transcript 功能。只有它们改变消息 owner、identity、pairing、durability 或恢复结论时才指出最小相关分支。

只报告会影响事实正确性、初学者理解、实验有效性或 Harness 契约的问题。格式偏好、理论漏洞和不影响教材质量的边缘问题不构成 Issue。
