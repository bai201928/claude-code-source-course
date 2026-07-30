# TypeScript 与 Node.js 难点索引

状态：`S2 已发布`

| 难点 | 首次系统讲解 | 源码/机制强化 | 当前掌握边界 | 后续复用 |
| --- | --- | --- | --- | --- |
| 字面量/判别联合 | M01 | TaskStatus、Message producer/consumer | 能读值域与分支，不能替代运行验证 | Message、Task、Hook result |
| 类型谓词与收窄 | M01 | `getLastAssistantMessage`、`normalizeMessages` | 能定位变体专属字段 | Context/Tool/Task 分支 |
| `never` 穷尽检查 | M01 | `satisfies never` | 新增变体产生编译反馈 | 全课程事件协议 |
| 泛型与 `NoInfer` | M01 | `Tool<Input,Output,P>`、H0 Tool 边界 | 关联内部类型，外部仍先验证 | Tool/MCP/Plugin ABI |
| schema 与类型擦除 | M01 | Zod Task schema、缺失 Message 声明边界 | 区分静态与运行时 | 配置、Tool、Hook、MCP |
| `readonly` 与浅/深不可变 | M01 | `readonly Tool[]` | 知道 readonly 不深冻结 | Context 投影与状态视图 |
| Promise/rejection | M02 | Query/非流请求 | 区分一次终值与部分事件后失败 | API、重试、持久化 |
| `IteratorResult<Y,R>` | M02 | 手动 `.next()` | 能读 yield 与 return 两通道 | Bash progress、Tool executor |
| AsyncGenerator/AsyncIterable | M02 | `query()`、QueryEngine、Tool progress | 理解惰性、pull 与可缓冲实现 | 模型流、Hook、Tool Loop |
| `yield*` | M02 | `query -> queryLoop`、`ask -> submitMessage` | 正常终值与 early-close 分开 | Query、Subagent、Hook |
| `for await` | M02 | QueryEngine 逐事件 mutation | 不能取得 generator return value | 流式模型/工具结果 |
| event loop/microtask/timer | M03 | cwd result reaction、progress race | 能解释状态可见性与 `unref` | API stream、后台任务 |
| Node Readable 与文件 fd | M03 | Shell file/pipe mode | 按具体输出 owner 判断 | Tool stream、Sandbox I/O |
| child process 与 signal | M03 | ShellCommand/tree-kill/exit | 请求、逻辑完成、退出确认分层 | 后台 Task、shutdown |
| AbortController/AbortSignal | M03 | child/combined signal、reason | one-shot 通知，资源动作由 consumer 实现 | Query/Tool/Subagent |
| closure 与注入 callback | M04 | `wrappedCanUseTool` | 区分定义、传参、协议调用和具体绑定 | Permission/Hook/MCP |
| array spread 浅视图 | M04 | `messages = [...mutableMessages]` | 容器分离、元素身份共享 | 请求投影、压缩 |
| private owner state | M04 | QueryEngine fields/constructor | 能追生命周期与 mutation site | Session/Task/Team |
| structured Trace union | M04/H0 | TraceableEngine、H0Harness | 调用/owner/branch/failure 可观察 | 全课程 Harness 回归 |
| dynamic import 与 surface 分支 | M05 | Interactive/Headless lazy module | 导入时机不等于运行表面语义 | Tool/Plugin/Agent |
| NDJSON 与输出判别投影 | M05 | stream-json framing | 解析先于 Core，格式不改领域 event | SDK/远程协议 |
| 对象深合并与 SameValueZero 去重 | M06 | settings source merge | 来源顺序、数组与对象语义分开 | Policy/Plugin config |
| revisioned immutable snapshot | M06 | configuration publication | 热更新不原地改旧请求视图 | Context/Capability |
| React lazy initializer 与 store identity | M07 | AppStateProvider/createStore | 类型、root value、store owner 分开 | REPL/UI state |
| `Object.is`、函数式 updater、同步 listener | M07 | AppState update pipeline | commit 不等于事务回滚 | Task/Team state |
| stale closure 与显式 fresh read | M07 | RequestContext/session getter | 稳定快照与 live read 可并存但要声明 | Query/Permission |
| catalog/request projection 与 registry | M08 | MCP/Tool Search/Plugin refresh | discovered、visible、allowed、executable 分层 | Tool/Skill/MCP |
| Map/Set 身份与插入调用顺序 | M09 | cleanup registry | 调用顺序不等于 Promise 完成顺序 | Message/Task/Transcript |
| `Promise.all` fail-fast 与 all-settled 设计 | M09 | cleanup + LifecycleCoordinator | reject 不取消 peer，错误可转 report | Hook/MCP/Team |
| `Promise.race`、局部预算与 overall deadline | M09 | cleanup/analytics/failsafe | 停止等待不等于停止底层工作 | API/Task/Cron |
| `AbortSignal.timeout` 与合作式收尾 | M09 | SessionEnd/H1 cleanup tiers | timeout signal 不等于物理终止确认 | Hook/Subagent |
| identity、alias 与 deep freeze | M10 | messagesRef、mutableMessages、H2 publication | 数组浅快照只固定成员；发布边界决定是否深冻结 | Context、Transcript |
| branded/value-object identity | M10 | envelope/response/tool-use/parent IDs | 同为 string 不代表可互换语义 | Task、Trace、幂等 |
| while 状态机与多出口 union | M12 | `queryLoop()`、Terminal、RunSummary | event、terminal、error、cancel 分通道 | Context、Task、Team |
| `for await` 与 generator terminal | M12 | QueryEngine early close、手动 `.next()` | 普通消费拿不到 return value | Hook、Subagent、stream API |
| `using` / async dispose | M12 | Query cleanup boundary | 多出口收敛资源，不等于业务 rollback | MCP、后台任务 |
| pure projection 与 post-validation | M13 | snapshot -> ModelRequest -> Provider params | source 合法不保证任意 suffix 合法 | Context、权限、持久化 |
| indexed stream assembly | M14 | content block index、late finalize | 完成顺序、数组顺序与终态时序分开 | MCP stream、Subagent |
| bounded single-consumer stream | M14 | capacity、close-to-abort、finally cleanup | 本地背压不等于网络端到端背压 | 后台任务、观测 |
| dynamic predicate 与 worker pool | M15 | parse 后 safety、safe batch、exclusive barrier | 分类异常 fail closed；固定上限避免无界并发 | Hook、MCP、Task |
| completion order 与 commit order | M15 | call ID outcome map、ordered context/result publication | 并发执行不要求乱序持久化 | Transcript、恢复 |

S0-S2 仍不是 TypeScript 的最终教程。后续机制首次引入尚未覆盖的语言能力时，继续按“最小语义 -> 当前源码作用 -> Java/Python 对照 -> 可运行验证”补齐。
