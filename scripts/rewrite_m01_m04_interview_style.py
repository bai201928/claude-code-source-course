#!/usr/bin/env python3
"""Non-destructively restyle M01-M04 final.md as interview-led source courses.

The script deliberately preserves every original paragraph, code block, diagram,
experiment, boundary statement, interview answer and source map. It only:
1. replaces the article title;
2. inserts a tailored interview-story opening and learner positioning;
3. renames major section headings to a conversational, question-led style;
4. adds a compact design-philosophy conclusion before the source map.

It is idempotent: files containing STYLE_MARKER are skipped.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

STYLE_MARKER = "<!-- INTERVIEW_LED_STYLE_V1 -->"
ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class UnitStyle:
    path: str
    title: str
    opening: str
    heading_map: dict[str, str]
    section_leads: dict[str, str]
    conclusion: str


COMMON_READER_BLOCK = """
### 这篇文章写给谁？

这四个单元不再把读者假设成“已经熟悉 TypeScript、Node.js 和 Claude Code 的源码老手”。它同时面向三类人：

- **零基础或基础薄弱的 Agent 学习者**：先从一次真实操作和一个可观察问题出发，再解释术语、类型和源码；
- **正在准备大厂 Agent / Java 后端面试的人**：不仅要知道 Claude Code 怎么写，还要能把它迁移成工业级 Agent Harness 的设计答案；
- **已经能读代码、但容易停在 happy path 的工程师**：重点追状态 owner、异常路径、取消、恢复、运行时验证和可证伪证据。

### 这篇应该怎么学？

不要把正文当成 API 手册从头背到尾。每一节都按同一条主线阅读：

```text
先看用户或面试场景
-> 提出一个能被证伪的问题
-> 找到决定性源码
-> 追数据、状态与资源 owner
-> 补异常路径和边界
-> 用实验推翻错误直觉
-> 最后压成两分钟面试表达
```

文中的 Claude Code 快照事实、clean-room 运行验证和 Mini Agent Harness 设计迁移仍然严格分开；新的叙事方式只负责把路带得更清楚，不会把推断包装成源码事实。
""".strip()


UNITS = [
    UnitStyle(
        path="curriculum/units/M01/final.md",
        title="# M01 面试官问“TypeScript 类型能保证 Agent 安全吗？”：从 Message、Tool、Task 扒开三道系统边界",
        opening="""
这题面试官想考的，其实不是你会不会背 `type`、`interface`、泛型和 Zod，而是看你有没有真正想过：一个工业级 Agent 到底靠什么守住消息、工具和任务的边界。

你是停在“TypeScript 有类型检查，所以比较安全”这种皮毛上，还是会继续追问：模型吐回来的 JSON 根本没经过 `tsc`，谁来验？两个模块都叫 `TaskStatus`，凭什么不是同一个领域？状态值合法，为什么仍然可能发生非法迁移？

很可惜，这位林友当时只回答：“TypeScript 能在编译期发现错误，Zod 再校验一下就行。”面试官接着问：“那 `completed -> running` 为什么还能写出来？`src/Task.ts` 和 `src/utils/tasks.ts` 的 `TaskStatus` 能直接互转吗？”他就接不下去了，面试官摇了摇头，让他先回去等通知。

今天这篇文章，我们就不从语法表开始背，而是沿着 Claude Code 的 Message、Tool 和两套 Task 领域，把下面这些问题一层层扒清楚：

- 类型到底能证明什么，又绝对不能证明什么？
- 模型 tool input 怎样从 `unknown` 进入可信内部对象？
- Agent 为什么需要判别联合，它怎样直接改变控制流？
- `Tool<Input, Output, P>` 为什么能把权限、并发、执行和结果锁成同一条契约？
- 同样是合法的 status，为什么还必须有 transition guard？
- 关键类型文件缺失时，怎样依靠 producer、consumer 和 validator 重建“最小可证事实”？

看完这一章，你不只会解释 Claude Code 的类型设计，还应该能在面试里把答案提升到“静态契约、运行校验、状态迁移”三道门。文章依旧硬核到底，发车！
""".strip(),
        heading_map={
            "## 从一个真实误判开始": "## 一、先看一个面试翻车现场：两个 `TaskStatus`，真的是同一个东西吗？",
            "## 先把三种约束分开": "## 二、别急着钻源码：工业级 Agent 到底有哪三道安全门？",
            "## `Task.ts`：类型先告诉你值域": "## 三、第一套 Task：运行任务的类型到底承诺了什么？",
            "## 同名的第二个 Task 领域": "## 四、第二套 Task：同名不等于同一个领域",
            "## 判别联合如何改变控制流": "## 五、Agent 怎么知道自己拿到的是哪一种消息？",
            "## `Tool<Input, Output, P>`：泛型不是占位符": "## 六、Tool 泛型为什么不是“写着好看”？",
            "## `ToolDef` 和 `buildTool()`：类型层与运行层要对齐": "## 七、默认能力怎么补齐，类型和运行对象又怎么对上？",
            "## Message 声明不在快照里，怎么办": "## 八、关键类型文件缺失了，还能不能严谨分析源码？",
            "## `interface`、`type` 与结构类型": "## 九、结构类型为什么既省事，又容易串领域？",
            "## 用实验把三层边界亲手拆开": "## 十、别只看懂：亲手把三层边界拆坏一次",
            "## H0：把类型思想迁移进 Mini Agent Harness": "## 十一、学完不能只会讲：把契约真正合进 Mini Agent Harness",
            "## 迁移到 Java、Spring 和 Python": "## 十二、换成 Java、Spring、Python，这套边界还成立吗？",
            "## 与 LangGraph 和企业 Agent Harness 的关系": "## 十三、到了 LangGraph 和企业 Agent，框架会替你守住这些边界吗？",
            "## 资深 Agent 开发岗面试：把类型讲到运行边界": "## 十四、面试官继续深挖：怎样把“类型题”答成工业级 Agent 设计题？",
            "## 离开本单元前，完成一次闭环": "## 十五、关掉答案：你能不能独立走完一次证据闭环？",
            "## 源码定位地图": "## 附录：源码定位地图",
        },
        section_leads={
            "## 二、别急着钻源码：工业级 Agent 到底有哪三道安全门？": "> **这一节面试官真正想听的：** 不要把 type、schema 和 state machine 混成一句“类型安全”。它们执行时间不同、证明能力不同、失败后果也不同。",
            "## 六、Tool 泛型为什么不是“写着好看”？": "> **先带着一个问题看源码：** 如果 Tool 参数改了，执行、权限、只读判断、并发判断和进度回调，谁来保证它们不会各说各话？",
            "## 八、关键类型文件缺失了，还能不能严谨分析源码？": "> **这是源码面试的加分点：** 真正成熟的回答不是把缺失接口补得像真的一样，而是主动缩小结论，只保留证据能支持的最小契约。",
        },
        conclusion="""
## 写在最后：这一章真正值得带走的四个设计哲学

一、**类型不是注释，但类型也不是防火墙。** 它约束内部代码的承诺，却不会替你检查模型、磁盘和网络送来的现实数据。

二、**同名不等于同域，import path 本身就是语义。** 工业系统里最危险的错误之一，就是因为字符串和值长得一样，便省掉显式映射。

三、**外部输入永远先按 `unknown` 对待。** 先迁移、再 schema 校验、再进入领域联合；任何 `as Message` 都只能移动编译器视线，不能改变真实数据。

四、**合法值不等于合法变化。** 联合类型定义值域，transition policy 定义边，数据库条件写和幂等机制再保证并发环境里的真实迁移。

面试现场记住一句话就够了：**type 管内部承诺，schema 管外部事实，state machine 管此刻能不能变。**
""".strip(),
    ),
    UnitStyle(
        path="curriculum/units/M02/final.md",
        title="# M02 面试官问“Agent 为什么不能只 return Promise？”：从 AsyncGenerator 扒开事件流、终值、背压与关闭协议",
        opening="""
这题面试官想考的，其实不是你会不会写 `async function*`，而是看你有没有把 Agent 当成“一段持续发生的过程”，而不是“一次晚点返回的函数调用”。

很多候选人会回答：“因为要流式输出，所以用 AsyncGenerator。”这句话只答到最表面。面试官真正会继续追：`yield*` 和 `for await` 到底差在哪？生成器 `return` 的终值去了哪里？消费者 `break` 以后网络请求真的停了吗？用了 AsyncIterable 为什么仍然可能 OOM？错误应该 throw，还是作为 event 继续流？

很可惜，这位林友当时只说：“Promise 一次返回，AsyncGenerator 可以多次 yield，所以体验更好。”面试官追问：“外层 `.return()` 后，`yield*` 后面的 completed 通知还会执行吗？多个模块能不能一起 `for await` 同一个流？”他沉默了。面试官摇摇头，让他回去等通知。

今天这篇文章，我们就沿着 Claude Code 的 `query() -> queryLoop() -> QueryEngine.submitMessage()` 和 StreamingToolExecutor，把下面这些问题一次讲透：

- 一次 Query 的事件、终值和异常分别走哪条通道？
- 为什么 `yield*` 能拿到 Terminal，而普通 `for await` 拿不到？
- 提前关闭生成器时，哪些 `finally` 会执行，哪些“正常完成”代码会被跳过？
- Tool progress 为什么一边流、一边仍然进入数组缓存？
- AsyncIterable 为什么不等于网络流、不等于背压、更不等于自动取消？
- 已经 yield 的部分状态，后续 throw 为什么不会自动回滚？

看完这一章，你应该能把“流式输出”答成一份完整的事件协议：生产、消费、缓冲、完成、失败、关闭和资源联动，一个都不能少。发车！
""".strip(),
        heading_map={
            "## 先把值经过的边界看清": "## 一、先别背语法：一句 Query 的值到底穿过了几层？",
            "## Promise 解决终值，事件流解决过程": "## 二、Promise 不是不够快，而是它只表达一次完成",
            "## 调用生成器不会立刻运行函数体": "## 三、你创建了生成器，代码为什么还没开始跑？",
            "## `yield`、`return` 和 `throw` 是三种不同的完成": "## 四、模型流结束了：到底是 yield、return，还是 throw？",
            "## `yield*` 不只是少写一个循环": "## 五、从 query 到 queryLoop：`yield*` 为什么是协议接力棒？",
            "## `for await` 让 QueryEngine 边消费边修改状态": "## 六、事件一到，状态就改：QueryEngine 为什么不能等到最后再处理？",
            "## 手动 `.next()`：需要终值时不要假装 `for await` 足够": "## 七、既要中间事件、又要最终对象，为什么必须手动 `.next()`？",
            "## Tool 进度为什么既像流，又仍然有缓存": "## 八、工具进度明明在流，为什么内存里还是有队列？",
            "## `Stream<T>`：AsyncIterable 外观背后可以是 push queue": "## 九、用了 AsyncIterable 还会 OOM？看清 push queue 的真面目",
            "## 提前退出只发出关闭请求，不等于所有资源都停了": "## 十、用户不看了，模型和工具就真的都停了吗？",
            "## 错误有两条通道，消费者必须分别设计": "## 十一、错误应该 throw，还是当成普通 event 继续跑？",
            "## 用实验让每个语法承诺变得可观察": "## 十二、别靠感觉：把惰性、终值、关闭和缓冲全部跑出来",
            "## Python 不是 TypeScript 的逐行翻译": "## 十三、换成 Python，为什么完成协议必须重新设计？",
            "## H0：把事件协议合入 Mini Agent Harness": "## 十四、把事件流真正合进 Mini Agent Harness",
            "## Java、Reactive Streams 与 Spring：相似处不等于等价": "## 十五、迁移到 Java 和 Spring：Flux 就等于 AsyncIterable 吗？",
            "## 与 LangGraph 的关系：stream mode 仍需底层协议": "## 十六、LangGraph 支持 streaming，就等于底层问题解决了吗？",
            "## 提升到企业级：先写流协议，再选库": "## 十七、企业级 Agent 怎么设计：先写协议，再挑库",
            "## 资深 Agent 开发岗面试：从异步语法讲到流控与取消": "## 十八、面试官继续深挖：怎样从 async generator 讲到流控与取消？",
            "## 离开本单元前，完成一次闭环": "## 十九、关掉答案：你能不能独立画出完整事件协议？",
            "## 源码定位地图": "## 附录：源码定位地图",
        },
        section_leads={
            "## 五、从 query 到 queryLoop：`yield*` 为什么是协议接力棒？": "> **这一节是高频追问：** “调用了子生成器”只是表面；真正要讲清的是中间事件怎样原样上浮、正常终值怎样被外层接住、异常和提前关闭又为什么跳过完成段。",
            "## 九、用了 AsyncIterable 还会 OOM？看清 push queue 的真面目": "> **面试官在这里看工程经验：** 流式只说明分段到达，不说明生产者受控。看到 queue、pending waiter 和 subscriber，就要继续问上限、丢弃、阻塞与观测。",
            "## 十、用户不看了，模型和工具就真的都停了吗？": "> **先把结论记住：** iterator 关闭是控制流事实，socket、Promise、子进程是否停止是资源事实；两者之间必须有显式桥接。",
        },
        conclusion="""
## 写在最后：事件流背后的四个设计哲学

一、**Agent 首先是过程，其次才是结果。** 用户界面、Transcript、预算、工具进度和取消都依赖中间事件，而不是最后那个 FinalAnswer。

二、**yielded event 与 generator return 是两份协议。** 谁只消费事件，谁还需要终值，必须在 API 设计时说清楚，不能靠调用者猜。

三、**流式不等于背压。** AsyncIterable 可以包着无界 push queue；判断系统是否安全，要沿 producer、buffer、dispatcher、subscriber 一直追到底。

四、**关闭控制流不等于关闭资源。** `finally` 是挂接取消和释放动作的位置，不是网络、工具和子进程已经停下来的证明。

面试现场可以用一句话收束：**Promise 交付一次完成，事件流交付运行过程；真正的工业设计还要补上缓冲、关闭、错误和资源联动。**
""".strip(),
    ),
    UnitStyle(
        path="curriculum/units/M03/final.md",
        title="# M03 面试官问“用户按 Ctrl+C 后，子进程真的停了吗？”：从 await 扒开事件循环、Stream、取消与资源收敛",
        opening="""
这题面试官想考的，其实不是你会不会调用 `AbortController` 或 `child_process.spawn`，而是看你有没有真正治理过一个长期运行的 Agent 资源生命周期。

你是停在“收到取消就 `abort()`，然后 `await` 抛异常”这种皮毛上，还是会继续追：谁持有 child process？stdout/stderr 到底走 pipe 还是文件？timeout 是失败、kill，还是转后台？kill 请求发出后，什么时候才能说进程真的退出？`Promise.race` 赢了以后，输家为什么还在跑？服务 shutdown 到底应该等多久？

很可惜，这位林友当时回答：“Ctrl+C 会触发 AbortSignal，catch 住异常后清理资源就行。”面试官只追问了一句：“AbortSignal 触发，能证明孙进程和 fd 都关了吗？`unref()` 是取消 timer 吗？”他立刻卡住。面试官摇了摇头，让他回去等通知。

今天这篇文章，我们就沿着 Claude Code 的 Bash 路径，从 `BashTool.call -> runShellCommand -> Shell.exec -> ShellCommandImpl` 一路往下扒：

- `await exec()` 这一行背后到底有哪些 timer、I/O、microtask 和 owner？
- 默认 Bash 输出为什么不是直接 `child.stdout.on('data')`？
- timeout、abort、kill、background 为什么必须是四个不同动词？
- tree-kill 请求发出后，逻辑结果和 OS exit confirmation 为什么可能不是同一时刻？
- progress 怎样通过 `Promise.race` 和 poll signal 一段段 yield？
- 为什么 cleanup 不能等同于 cancel，graceful shutdown 也不能无限等待？

看完这一章，你应该能把“取消功能”答成一套资源收敛协议：请求、传播、动作、确认、升级、清理和预算。发车！
""".strip(),
        heading_map={
            "## 先把长命令的全部生命周期看见": "## 一、先看全貌：一条 Bash 命令从 tool_use 到 cleanup 经历了什么？",
            "## 事件循环不是一个神秘队列": "## 二、别再只说“Node 是单线程”：事件到底按什么时序恢复？",
            "## `Shell.exec()`：先装配，再 spawn": "## 三、真正 spawn 之前，Shell.exec 已经做了多少事？",
            "## stdout/stderr 有两条完全不同的路径": "## 四、命令输出到底怎么回来：文件轮询，还是 Readable pipe？",
            "## Node Readable 的两种消费姿势": "## 五、同样是 Stream，`data` listener 和 `for await` 有什么区别？",
            "## `ShellCommandImpl` 才是命令生命周期 owner": "## 六、谁真正拥有 child、timer、listener 和 result？",
            "## timeout、abort、kill、background 必须分四个动词": "## 七、最容易答错的一题：timeout、abort、kill、background 到底差在哪？",
            "## progress 是 result 与 poll signal 的竞速": "## 八、命令还没结束，进度为什么能持续冒出来？",
            "## `.then()` 中的同步工作为什么影响 `await` 后的可见状态": "## 九、一个 `.then()`，为什么会改变 `await` 之后看到的状态？",
            "## AbortController：通知图，不是 kill 方法": "## 十、AbortController 只是通知，那真正的终止动作谁来做？",
            "## cleanup 为什么不能只写在 process exit": "## 十一、资源清理为什么必须跟 owner 走，不能全塞进 exit？",
            "## graceful shutdown 是有预算的降级流程": "## 十二、服务退出时，为什么既不能无限等，也不能立刻 `process.exit()`？",
            "## 用双语言实验验证“请求取消”与“确认退出”": "## 十三、别只看 cancelled：亲手验证“请求”和“确认”不是一回事",
            "## H0：合入取消域、资源域和可控时钟": "## 十四、把取消域、资源域和可控时钟合进 Mini Agent Harness",
            "## Java/Spring：线程中断也不是强制终止": "## 十五、换成 Java/Spring：Thread.interrupt 真的能强杀任务吗？",
            "## Python asyncio：Task.cancel 只注入 CancelledError": "## 十六、换成 Python asyncio：Task.cancel 为什么仍然只是合作式通知？",
            "## 与 LangGraph 和企业 Agent 的关系": "## 十七、LangGraph run 被取消，节点里的子进程就一定停了吗？",
            "## 资深 Agent 开发岗面试：从 event loop 讲到资源收敛": "## 十八、面试官继续深挖：怎样从 event loop 讲到资源收敛？",
            "## 离开本单元前，完成一次闭环": "## 十九、关掉答案：你能不能独立设计一条取消与退出确认链？",
            "## 源码定位地图": "## 附录：源码定位地图",
        },
        section_leads={
            "## 七、最容易答错的一题：timeout、abort、kill、background 到底差在哪？": "> **这一节先不要背定义。** 每遇到一个事件，都问四件事：child 还跑不跑、owner 有没有变化、result 表示逻辑完成还是 OS 确认、cleanup 由谁接管。",
            "## 十、AbortController 只是通知，那真正的终止动作谁来做？": "> **面试官想听的是桥接关系：** signal 只发布取消事实，resource adapter 才把它翻译成 abort request、stream destroy、tree-kill 或业务 background。",
            "## 十二、服务退出时，为什么既不能无限等，也不能立刻 `process.exit()`？": "> **这是生产系统题：** graceful 的本质不是“温柔退出”，而是在有限预算里按价值排序，先保护用户状态和协议完整性，再尽力收敛次要资源。",
        },
        conclusion="""
## 写在最后：资源生命周期背后的四个设计哲学

一、**`await` 只是等待语法，不是生命周期管理器。** child、stream、timer、listener 和全局状态都有自己的 owner 与完成条件。

二、**取消请求和退出确认必须分开。** Abort、interrupt、terminate、kill 都可能只是动作；真正释放隔离资源前，要知道系统承诺的是 logical ack 还是 OS confirmation。

三、**background 不是“让 Promise 自己跑”。** 它是一次所有权转移，必须伴随 durable task、输出限制、后续通知和新的 cleanup owner。

四、**graceful shutdown 必须有预算。** 先保证 transcript、终端和关键状态，再处理工具与连接，最后才是 telemetry；任何阶段都要有 failsafe。

面试现场用一句话收束：**取消是通知图，资源收敛是 owner 驱动的确认流程，二者中间必须有明确的动作、超时和升级策略。**
""".strip(),
    ),
    UnitStyle(
        path="curriculum/units/M04/final.md",
        title="# M04 面试官问“你怎么证明这条调用链真的走过？”：从代码图、call site 追到状态 owner 与可验证证据",
        opening="""
这题面试官想考的，其实不是你会不会用 IDE 查引用，也不是看你能不能画一张箭头很多的架构图，而是看你有没有能力把“结构上有关”与“运行时真的发生”分开。

你是停在“QueryEngine import 了 query，所以 submitMessage 会调用 query”这种皮毛上，还是会继续追：真实 call site 在哪？什么 guard 决定本次是否到达？参数只是被传进去，还是对象真的被执行？状态到底改在长期 owner、当前 turn view，还是 usage 计数器？事件先 yield 后 throw，前面的副作用会不会留下？

很可惜，这位林友当时打开 Call Hierarchy，画了一张 `ask -> QueryEngine -> query -> tool` 的图，就自信地说链路已经证明。面试官追问：“本地 slash command 也一定进模型吗？`canUseTool(tool, ...)` 为什么能证明 tool 被调用？”他回答不上来。面试官摇了摇头，让他回去等通知。

今天这篇文章，我们就只追一个能被证伪的问题：一条 prompt 什么时候从 `QueryEngine.submitMessage()` 真正进入 `query()`，在那之前和之后，哪些状态已经改变？沿途会解决这些疑问：

- import、contains、call、callback、mutation，分别能证明到哪一步？
- Graphify 的 EXTRACTED 和 INFERRED 为什么都必须回源码核验？
- `shouldQuery=false` 时，为什么“没调模型”不等于“什么都没发生”？
- 数组浅快照怎样让长期消息 store 和本轮 request view 分离？
- query event 到达后，谁修改 mutableMessages、Transcript、usage 和 SDK 输出？
- 怎样用可计数 fake、TraceEvent 和部分失败测试证明一条边存在或不存在？

看完这一章，你应该从“会搜代码”升级为“会建立证据链”：候选、调用点、条件、数据、owner、失败和可观察结果，缺一个都不能把箭头画成事实。发车！
""".strip(),
        heading_map={
            "## 先看见“源码关系”不是一种关系": "## 一、先拆掉第一层错觉：源码里的“连线”根本不是同一种关系",
            "## Graphify 先缩小搜索面，但不替你作结论": "## 二、Graphify 能帮你找路，但为什么不能替你下结论？",
            "## 先验证那条看起来最真的边": "## 三、第一条硬证据：submitMessage 真的在哪里调用 query？",
            "## 再向上找 guard：import 了也可以一次都不调用": "## 四、call site 明明存在，为什么这次仍然可能一次都不调用？",
            "## 假阳性为什么出现：传一个值，不等于调用它": "## 五、最常见假阳性：把 tool 当参数传入，等于执行 tool 吗？",
            "## 向上追 caller：谁创建 owner，谁只做一轮适配": "## 六、从 ask 往下看：谁创建会话 owner，谁只是一次性适配？",
            "## 找到 state owner，才能解释“调用产生了什么”": "## 七、只找到函数还不够：真正决定后果的是 state owner",
            "## 数组浅快照：引用关系也属于调用证据": "## 八、两行数组代码，为什么足以改变整条消息链的解释？",
            "## 向下追 callee：事件不是“query 返回一个结果”": "## 九、query 不是返回一个大对象：每个事件到底改了什么？",
            "## 失败路径：部分状态不会因为 throw 自动撤销": "## 十、流中途炸了，前面写入的状态会自动回滚吗？",
            "## 依赖注入让调用图从箭头变成协议": "## 十一、依赖注入之后，静态调用图为什么天然不完整？",
            "## 测试不是源码的装饰，也不是万能真相": "## 十二、没有官方专题测试时，怎样保持结论可信？",
            "## 用 TraceLog 把“我看懂了”改成可反驳事件": "## 十三、别说“我看懂了”：用 TraceLog 把解释变成可反驳事件",
            "## 做六次有目的的破坏": "## 十四、亲手制造六次失败，看看哪条解释最先站不住",
            "## 一次可复用的追踪循环": "## 十五、把这次分析收敛成一套可复用的源码追踪循环",
            "## H0：合入可观察证据与跨语言行为测试骨架": "## 十六、把可观察证据与跨语言测试合进 Mini Agent Harness",
            "## Java/Spring：Bean 注入图也不是运行时调用图": "## 十七、换成 Java/Spring：Bean 依赖图为什么也不是运行调用图？",
            "## Python：duck typing 更需要显式 composition root": "## 十八、换成 Python：动态绑定为什么更需要 composition root 与 fake？",
            "## LangGraph：图节点边是编排允许，不是所有内部副作用": "## 十九、LangGraph 画了节点边，就能代表所有内部副作用吗？",
            "## 企业级迁移：把代码图、运行 trace 和契约测试分层治理": "## 二十、企业级代码智能：静态图、运行 Trace、契约测试怎么分层治理？",
            "## 资深 Agent 开发岗面试：从“会搜代码”讲到可验证架构": "## 二十一、面试官继续深挖：怎样把“查引用”答成可验证架构？",
            "## 离开本单元前，完成一次纵向证据闭环": "## 二十二、关掉答案：你能不能独立完成一次纵向证据闭环？",
            "## 源码定位地图": "## 附录：源码定位地图",
        },
        section_leads={
            "## 四、call site 明明存在，为什么这次仍然可能一次都不调用？": "> **这一节决定你是否真的会读运行路径：** call site 证明“可以调用”，guard 才证明“这个输入会不会调用”；本地命令、权限拒绝和 feature gate 都可能让结构边不发生。",
            "## 七、只找到函数还不够：真正决定后果的是 state owner": "> **面试官在这里看架构能力：** owner 决定状态跨不跨 turn、失败后留不留下、并发时谁竞争；函数名只能告诉你动作发生在哪里。",
            "## 十三、别说“我看懂了”：用 TraceLog 把解释变成可反驳事件": "> **真正可靠的源码结论要允许被推翻。** 让 fake 统计调用次数，让 Trace 记录 owner mutation，让部分失败暴露提交点，比再画一张大图更有说服力。",
        },
        conclusion="""
## 写在最后：源码追踪背后的四个设计哲学

一、**静态边首先是假说，不是运行事实。** import、contains 和 references 用来缩小搜索面；call site、guard 与 trace 才能逐步增强结论。

二、**条件决定路径，owner 决定后果。** 是否调用要看 guard，调用以后留下什么要看 mutation site 与生命周期 owner。

三、**参数传递、回调调用和真实副作用必须分开。** `f(x)`、`x()`、`x.run()` 与 `() => x()` 是四种不同关系，任何图工具都可能在这里产生假阳性。

四、**证据必须分层治理。** 静态图说明可能影响，契约测试说明给定场景的不变量，运行 trace 说明这一次真实发生；没有任何一层可以单独代表全局真相。

面试现场用一句话收束：**我不从箭头猜调用，而是从 call site、guard、owner、mutation、失败路径和可观察反证建立证据链。**
""".strip(),
    ),
]


def apply_style(unit: UnitStyle) -> bool:
    path = ROOT / unit.path
    original = path.read_text(encoding="utf-8")
    if STYLE_MARKER in original:
        print(f"skip {unit.path}: marker already present")
        return False

    lines = original.splitlines()
    if not lines or not lines[0].startswith("# "):
        raise RuntimeError(f"unexpected title in {unit.path}")

    original_title = lines[0][2:].strip()
    body = "\n".join(lines[1:]).lstrip("\n")

    source_heading = "## 源码定位地图"
    if source_heading not in body:
        raise RuntimeError(f"source map heading missing in {unit.path}")
    body = body.replace(
        source_heading,
        f"{unit.conclusion}\n\n{source_heading}",
        1,
    )

    for old, new in unit.heading_map.items():
        if old not in body:
            raise RuntimeError(f"heading not found in {unit.path}: {old}")
        body = body.replace(old, new, 1)

    for heading, lead in unit.section_leads.items():
        if heading not in body:
            raise RuntimeError(f"restyled heading not found in {unit.path}: {heading}")
        body = body.replace(heading, f"{heading}\n\n{lead}", 1)

    preface = f"""{STYLE_MARKER}

{unit.opening}

{COMMON_READER_BLOCK}

> **原单元主题：** {original_title}
>
> **内容保留说明：** 下文原有源码事实、代码片段、Mermaid 图、实验结果、破坏练习、H0 迁移、跨语言对照、企业治理、面试答案和源码定位均完整保留；本次修改只重构目标读者、叙事入口、章节标题、过渡方式与总结风格。
""".strip()

    rewritten = f"{unit.title}\n\n{preface}\n\n{body.rstrip()}\n"
    path.write_text(rewritten, encoding="utf-8", newline="\n")
    print(f"rewrote {unit.path}")
    return True


def main() -> None:
    changed = 0
    for unit in UNITS:
        changed += int(apply_style(unit))
    print(f"changed files: {changed}")


if __name__ == "__main__":
    main()
