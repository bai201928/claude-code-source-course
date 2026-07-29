# FACT_A 独立盲审提示词

你正在执行 M13 的事实闸门 A。请先完整读取同目录 `fact-gate-scope.md`，然后只读取其中指定源码根目录内与问题直接相关的文件。

这是独立盲审。请自行重建 durable/query/API/wire 四层消息视图，以及 compact boundary、tool result budget、snip/microcompact、user context、消息正规化、tool pairing 和 Provider 参数构造的真实顺序。不要预设 Codex 的结论。

禁止修改文件，禁止读取或引用 Graphify。只报告会影响事实正确性、实验有效性或 Harness 契约的问题。

输出必须以下列三行开始：

```text
GATE: FACT_A
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

随后给出：

1. 精简投影链；
2. 各层 owner 与 mutation boundary；
3. 代表性过滤、合并、替换与配对语义；
4. 最终参数构造和传输边界；
5. 实质问题或无法确认项。

每个实质问题必须给出源码路径、真实符号、理由和验证目标。不要报告格式偏好、理论漏洞或不影响教材核心质量的边缘问题。

