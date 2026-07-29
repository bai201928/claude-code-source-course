# M07 教学闸门审查任务

你是一名独立的教材教学审查者。请以准备 2026 年中国互联网大厂 Agent 开发岗、具有 Java/Spring/Python/Agent/RAG 经验但 TypeScript/Node/React 基础较弱的学习者视角，审查 M07 是否真正建立“状态创建、owner、通知与请求一致性”的源码级心智模型。

## 只允许读取的材料

1. `D:\agent\Claude code最新\2.md`：只用其学习者背景、教学深度、源码理解、实验、Harness、企业迁移和面试表达要求。
2. `D:\agent\Claude code最新\curriculum\design\benchmark-rules.md`：用户确认的 M11 质量标杆规则。
3. `D:\agent\Claude code最新\curriculum\units\M07\draft.md`。
4. 下面给出的学习目标与代码运行结果。

不要读取 `fact-review.md`、`fact-gate-*`、`unit-workbook.md`、Graphify、源码快照、implementation report、其他教材或历史审查结论。你不是事实闸门，不要重做全仓库调查。不得修改文件。

## 学习目标

学习者完成后应能：

- 解释 Bootstrap STATE 为何在 `init()` 前出现，以及 `init/setup/store creation` 的相对时序；
- 区分 AppState type、value、default factory、store 和 Provider；
- 说明 Bootstrap 模块单例不等于进程只有一个 AppState store；
- 画出 Interactive、Headless 与临时 Provider 的创建和所有权关系；
- 从 `Object.is` 推导同 root 静默、新 root 通知、observer/subscriber 顺序和异常半完成；
- 理解 `useState` lazy initializer、`useSyncExternalStore`、selector identity 和 stale closure；
- 区分 render snapshot、构造时 fresh read、request snapshot、live getter 与显式 refresh；
- 解释为什么 AppState 更新可能写磁盘、通知外部系统、清缓存和改环境；
- 运行、观察、破坏和修复 TypeScript/Python clean-room；
- 将 M06 configuration revision 接入 RuntimeContext，并继续分层 SessionState/RequestContext；
- 迁移到 Java/Spring、RAG 和 LangGraph，并设计 revision/trace；
- 用结论先行、口语化约两分钟回答资深 Agent 岗相关追问。

主体学习时间为 4 至 7 小时，双语言实验、破坏和企业练习另计。M07 不应提前吞掉 M08 工具/系统上下文完整启动快照、M09 生命周期清理、M10 消息 owner 或 M28 Runtime Task registry。

## 已知实验与图示结果

- M07 独立 TypeScript 7/7、Python 7/7，TypeScript strict 通过；
- H1-in-progress 8/8，保留 S0 15/15、M05、M06 回归；
- Harness RuntimeContext TypeScript/Python 各 6/6；
- 正文 16/16 Mermaid 图已实际渲染成功；
- 正文包含 10 道资深 Agent 开发岗问题，每题给出结论先行的口语回答。

你需要审查正文是否让学习者知道这些结果证明什么，不要重新执行命令。

## 审查标准

只报告会实质影响初学者理解、实验有效性、Harness 契约或 4 至 7 小时学习闭环的问题：

- 是否由“异步工具更新本轮是否可见”的真实问题连续推进，而不是全局变量、React API、表格和面试题拼装；
- 初始化时序、Bootstrap/AppState 分离和多 store owner 是否能被学习者独立复述与画出；
- `const`、引用身份、函数式 updater、`Object.is`、`useState` lazy initializer、`useSyncExternalStore` 和闭包是否在改变语义处讲清，并有 Java/Python 对照；
- 16 张图是否在认知转折处帮助首次理解与复习，方向、术语、状态和正文是否一致；
- snapshot/fresh read 混合是否讲清，是否避免“所有旧值都是 bug”或“整个请求永远实时”的极端结论；
- observer 外部副作用、异常后 state 已提交和非事务边界是否足够可操作；
- 实验是否有假设、观察点、反证和破坏，不用“测试通过”替代理解；
- H1 的 Runtime/Session/Request 分层是否自然承接 M06，而不是重新发明另一套无关架构；
- Java/Spring、RAG、LangGraph、revision、policy epoch 和 observability 是否由当前机制自然推出；
- 面试问题是否像资深面试官追问，回答是否第一句给结论、约两分钟可口述、能承接源码与系统设计追问。

普通措辞偏好、标题形式、不影响学习的小缺失、完整分布式事务/消息/清理/Task 扩展和理论漏洞不得列为 Issue。

## 输出要求

输出必须以以下三行开头：

```text
GATE: TEACHING
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

如有实质问题，每项给出定位、学习影响、为什么实质、最小修正方向。不要重写整章，不要建议新增固定栏目或配额。如无实质问题，给出简短通过理由和剩余非阻断风险。

