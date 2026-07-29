# M04 事实闸门中性范围

独立核验当前静态源码快照中 `ask()`、`QueryEngine`、`submitMessage()`、`processUserInput()` 与 `query()` 的结构关系、真实调用、状态所有权和条件边界。不评价教学风格，不修改文件，不读取 Graphify 或 M04 作者材料。

源码根目录：`D:\agent\Claude code最新\claude-code-CLI`

需要回答：

1. `ask()` 如何创建 QueryEngine、注入依赖、调用 `submitMessage()`，并在 finally 处理什么状态？
2. QueryEngine 哪些字段跨 turn 持久，constructor 从哪里取得初值？
3. `submitMessage()` 如何调用 `processUserInput()`、追加用户消息并创建局部 `messages` 视图？
4. `shouldQuery` 怎样控制本地结果分支与 `query()` 调用？import 存在是否能证明运行调用？
5. `for await (const message of query(...))` 之后，哪些消息会修改 mutable store、transcript、usage 或 yield 给 SDK caller？
6. `wrappedCanUseTool` 的形参 `tool` 在 L245-L259 是被调用，还是作为参数传给注入的 `canUseTool`？
7. `messages = [...this.mutableMessages]` 能证明什么数组边界，不能证明什么对象不可变性？
8. 当前快照有哪些测试或注释可支持这些结论；若测试缺失，最小复现应该观察哪些事件和状态？
9. 哪些关系只是 import、contains、references、callback 注入或静态可达，不能叫作真实运行调用？

优先阅读：`src/QueryEngine.ts`、`src/query.ts`、`src/utils/processUserInput/processUserInput.ts`，以及能确认调用者、类型和状态修改的最小相关文件。

输出必须以规定 FACT_A 三行开始，只报告影响事实正确性、代表性实验或 H0 追踪契约的实质问题，给出路径、符号和决定性语义。
