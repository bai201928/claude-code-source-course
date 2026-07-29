# M09 教学闸门记录

状态：`teaching-reviewed`

审查会话：`d5333b5f-0a07-4530-8356-d5d71c155bbc`

第一次尝试的会话因 runner 未授权项目目录而无法读取任何材料，没有产生 gate verdict，不计为教学审查。修正 `--add-dir` 后使用新的独立会话完成正式审查；模型自然退出，无应用层超时、无权限拒绝。

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

## 通过依据

- 正文由按 Esc、`/clear`、`/resume`、`/exit` 的真实差异持续推动，没有退化成退出函数目录。
- turn cancellation、logical SessionEnd、process graceful shutdown 与 abrupt termination 四层作用域可以独立复述和画出；Interactive 按键与 OS signal 没有混写。
- `gracefulShutdownSync` 的同步外壳、first caller owner、阶段顺序与预算都在改变运行语义的位置讲清。
- Set + Promise.all、fail-fast、Promise.race 不取消 loser 通过决定性源码、局部时序图和 slow/fail 运行实验形成了可反驳理解。
- Transcript flush 的惰性注册、drain 过程、阶段位置与 registry 内无 priority 边界表达准确，源码注释没有被升级成不存在的保证。
- 18 张图分布在生命周期分层、信号入口、SessionEnd、同步外壳、first owner、完整阶段、registry 并发、timeout 重叠、Transcript、budget、bypass、Harness 和 Spring 等认知转折处；`18/18` 实际渲染并抽查可读。
- 双语言实验先写假设和反证，再提供 timeout、failure isolation、late registration、first owner、overall deadline 与五次破坏；独立与 H1 生命周期测试均为 TypeScript/Python 各 `8/8`。
- H1 自然承接 M03/M05-M08，明确 Core、Surface、process boundary、状态 owner、失败语义和 immutable report；累计回归 `12/12`，包含 S0 `15/15`。
- Spring/Kubernetes、远程 worker、RAG/LangGraph 与 observability 均由 owner、phase、budget 和 report 推出，不是通用架构术语堆积。
- 8 道资深 Agent 开发岗问题覆盖源码陷阱、失败边界和生产设计；回答均结论先行，约两分钟可口述。

## 非阻断风险

- Node 24 strip-only 对 parameter property 的限制已经给出当前可运行写法；其他 Node 版本可能表现不同，不影响本单元契约。
- Python `monotonic()` 秒与 TypeScript `Date.now()` 毫秒的单位差异已在正文提示。
- TypeScript 基础较弱的学习者可能需要额外消化 Promise owner 与 AbortSignal，但 M03 已建立必要前置；五组破坏实验时间本就另计。
- 本单元没有提前展开完整 Hook matcher、Task、MCP、Transcript 恢复或 Agent Team，符合边界设计。

这些风险不影响事实正确性、初学者理解、实验有效性或 Harness 契约，不阻断进入 `release-candidate`。
