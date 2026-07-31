# M18 作者工作簿：指令发现、装配与动态注入

状态：`researched`

本文件是作者工作区，不是教材正文。Graphify 只用于候选定位；结论以 `claude-code-CLI/` 当前源码快照为准。

## 单元问题与风险

“磁盘上有 CLAUDE.md”不等于“模型当前请求已经看见它”。指令至少经历发现、读取/变换、scope 判断、去重、装配、动态附件 normalization 和 Provider 投影。M18 要区分四个面：

```text
default/custom/append system prompt
eager CLAUDE.md userContext
path-triggered nested_memory attachment
turn-specific dynamic attachments
```

风险为 R2：外部 include/trust、条件 Rules、缓存旧值、重复注入、路径 scope、动态附件与 durable history 混淆会直接影响模型行为和安全边界。

## 初步源码链

### Eager instruction discovery

`src/utils/claudemd.ts -> getMemoryFiles()`：

- Managed CLAUDE.md/rules；
- User CLAUDE.md/rules（setting source 开启）；
- 从文件系统 root 到 original CWD 的 Project `CLAUDE.md`、`.claude/CLAUDE.md`、无条件 `.claude/rules/*.md` 与 Local `CLAUDE.local.md`；
- 可选 additional directories；
- AutoMem/TeamMem 属于另一 memory type，不能与 instruction source 混为一谈。

文件顺序从较全局到较局部，注释称后加载内容获得更高模型注意，但它不是机器可执行的 policy precedence。

`processMemoryFile()` 负责 symlink real path、排除项、HTML comment/frontmatter 变换、@include recursion、最大深度与 processed path 去重。当前实现先 push parent file，再递归 include；文件头注释“includes first”与实现需要事实闸门核对，不应先写入教材。

Project/Local 外部 include 默认不进入实际 context，只有 project approval 或显式 force check 路径允许；User include 可外部。warning 检查与 context build 不能混成同一读取。

### Eager context assembly

`src/context.ts -> getUserContext()`：

- `CLAUDE_CODE_DISABLE_CLAUDE_MDS` hard off；
- bare mode 跳过自动发现，但显式 additional directory 例外；
- `getMemoryFiles()` 经 `filterInjectedMemoryFiles()`、`getClaudeMds()` 转成带 source path/type 的 `claudeMd` 字段；
- 同时加入 current date；
- memoized for conversation，并缓存给 classifier。

`src/utils/queryContext.ts -> fetchSystemPromptParts()` 并行获取 default system prompt、userContext、systemContext。custom system prompt 存在时跳过 default builder 和 systemContext，但仍获取 userContext。

`QueryEngine.submitMessage()` 最终 system prompt：custom 或 default + memory mechanics（特定 opt-in）+ append prompt。append 是明确的追加层，custom 是替换 default，不应写成同优先级 merge。

### System prompt section cache

`src/constants/systemPromptSections.ts`：普通 section 首次 compute 后缓存；危险 uncached section 每轮重算并可能破坏 cache。`/clear` 与 `/compact` 清 section state 和 beta latch。system prompt 的 stable prefix 是 Prompt Cache 契约，不是“每轮读取所有环境”。

### Conditional and nested rules

`.claude/rules/*.md` frontmatter `paths` 变成 globs。无 glob rule eager 加载；conditional rule 在目标文件触发时匹配。

读取/@mention 文件会先把路径放进 `nestedMemoryAttachmentTriggers`。`getAttachments()` 必须先等待 user-input attachments，再计算 `nested_memory`，保证触发集合已填充。

`getNestedMemoryAttachmentsForFile()` 顺序：

1. Managed/User conditional rules；
2. CWD 到 target nested dirs 的 CLAUDE.md、unconditional/conditional rules；
3. root 到 CWD 的 conditional rules。

只处理 allowed working path。Project glob relative to containing `.claude` parent，Managed/User glob relative original CWD；跨 base path 不匹配。

`memoryFilesToAttachments()` 使用 non-evicting `loadedNestedMemoryPaths` 防止 LRU eviction 后重复注入；`readFileState` 另负责变化检测和 edit/read safety。内容被变换时缓存 raw bytes 并标 `isPartialView`。

InstructionsLoaded hook 为 fire-and-forget audit/observability，不拥有注入决定。

### Dynamic attachments

`getAttachments()`：

- SIMPLE/disabled 模式大多跳过，但保留 queued command attachments；
- 为附件计算创建 1 秒 abort controller；每个 getter 经 `maybe()` 隔离异常；
- user input attachments 先完成；thread/main groups 各自 `Promise.all`；返回顺序按数组位置稳定，不按完成时间；
- main-thread-only 与 subagent-safe attachments 分开；
- `getAttachmentMessages()` 把 Attachment 变成内部 message，`normalizeAttachmentForAPI()` 再生成 model-visible user/meta/system-reminder content；
- attachment 是 Query state 的动态消息，不等于 CLAUDE.md 文件 owner，也不等于 system prompt section。

## 初步状态 owner

| 状态 | Owner | 主要修改者 | 可见边界 |
| --- | --- | --- | --- |
| instruction file bytes | filesystem | user/policy/repo | discovery/read |
| eager file list | memoized `getMemoryFiles` | cache clear/reset | `getUserContext` |
| eager CLAUDE.md text | memoized `getUserContext` | clear/injection change | API user context |
| system prompt sections | section cache | resolve/clear | system prompt |
| nested loaded set | `ToolUseContext` | attachment loader/compact clear | later turns |
| read-file cache | `ToolUseContext.readFileState` | Read/attachment/change detection | safety + dedupe |
| trigger paths | `nestedMemoryAttachmentTriggers` | file/@mention processing | next attachment collection |
| dynamic attachment messages | current query iteration | getters/normalizer | API projection |

## 待事实闸门重点

- parent/include 实际顺序与注释漂移；
- rules directory enumeration 是否有排序保证；
- eager `userContext` 在 API 中的准确位置及 cache prefix 语义；
- interactive 与 QueryEngine 构建时点是否一致；
- external include approval/warning 的实际控制点；
- transformed instruction content、readFileState 和 edit safety；
- nested trigger 的具体产生点、去重和 compact reset；
- attachment timeout/abort 是否会取消所有 getter，`maybe()` 如何降级；
- custom system prompt 是否仍注入 CLAUDE.md userContext；
- InstructionsLoaded hook 失败是否影响注入；
-缺失 feature-gated 路径不得补造。

## H3-3 候选

实现 clean-room `InstructionPipeline`：source type + scope + trust + revision + content reference；deterministic ordering；normalized-path dedupe；conditional path match；immutable per-request snapshot；redacted metadata report。

Merge 候选：scoped source、trust decision、stable order、revision CAS、dynamic delta、content-free provenance report。

Defer：完整 CLAUDE.md parser、真实 Hook/Skill/MCP、OS managed path、IDE attachment 和 remote policy sync。

Reject：把所有 instruction 拼成无来源字符串、每轮无条件重读、last-write-wins shared array、external include 默认信任、把动态 attachment 写回 durable instruction store。
