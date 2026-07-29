# FACT_B 修订复审提示词

继续当前 M13 FACT_A/FACT_B 会话。Codex 已回到源码裁决并修改双语言实验。请只读取下列四个文件，不扩散源码树：

- `D:\agent\Claude code最新\curriculum\units\M13\code\typescript\request-projection.ts`
- `D:\agent\Claude code最新\curriculum\units\M13\code\typescript\request-projection.test.ts`
- `D:\agent\Claude code最新\curriculum\units\M13\code\python\request_projection.py`
- `D:\agent\Claude code最新\curriculum\units\M13\code\python\test_request_projection.py`

已执行结果：TypeScript 9/9、strict typecheck 通过，Python 8/8。

请复核：

1. user context 是否在 normalize 前进入 request-local query view；
2. tool-result budget 是否按与最终 API user message 对齐的 group 处理，而不是全局池；
3. 独立 replacement state 是否能冻结 seen-but-visible 结果，并跨轮 byte-stable 复用已替换 preview；
4. durable source 是否仍保持不变；
5. 新测试是否能反证旧错误实现。

说明：`stream: true` 的 FACT_A 结论经源码重查后被驳回。主流式路径位于 `src/services/api/claude.ts -> queryModel()` 约 1822 行，实际调用为 `messages.create({ ...params, stream: true }, { signal, ... })`；FACT_A 引用约 864 行的是 non-streaming fallback，不是主路径。本轮无需再次审查该项。

输出必须以下列三行开始：

```text
GATE: FACT_B_RECHECK
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

只报告仍影响事实、实验结论或 Harness 契约的实质问题。

