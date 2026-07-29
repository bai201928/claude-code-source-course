# M04 实现与实验报告

状态：`implemented`

TypeScript 与 Python 均验证 5 个源码追踪契约：主路径可观察真实调用/事件/状态修改；本地分支不调用已注入的 Query；请求数组视图不随 owner 后续 append 增长；对象作为参数传递不等于对象被调用；Query 产生部分事件后失败时已写状态不会自动回滚。

运行结果：TypeScript 5/5、Python 5/5，两个 demo 正常。TypeScript 核心实现通过 strict typecheck。

H0 初步裁决为 `merge`：加入稳定 TraceEvent、TraceLog、显式依赖端口、owner/mutation 事件和跨语言同名行为测试骨架。Graphify 边、Claude Code 私有符号和具体目录结构不进入通用 Harness。

证据分类：QueryEngine 调用与状态边界是快照事实；双语言 TraceableEngine 是运行验证；H0 行为追踪和测试骨架是设计迁移。
