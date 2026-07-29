# I01 实施与发布报告

状态：`final`

## 范围

I01 是 S0/S1 发布后的中间复习章，沿一次启动、运行、取消和收尾串联 M01-M09。它复用已发布教材、实验与 H0/H1 契约，不新增 Claude Code 事实范围，不生成新的 TypeScript/Python 实现。

时间边界已在正文明确：H1 是 S1 发布固定点；当前工作区虽已演进到 H2-in-progress `0.2`，本章不以 H2-in-progress 倒写 M01-M09 或 H1。

## 自检

- Markdown 文件完整，标题与代码围栏闭合。
- 19 张 Mermaid 图已逐张实际渲染，结果为 `19/19 passed`。
- 教材与源码引用检查：42 个引用路径存在。
- 七组复习实验的命令目标检查：36 个脚本、测试、demo 与配置文件存在。
- Interactive REPL 不经过 `QueryEngine`、H1 能力边界、快照事实/运行验证/设计迁移等高风险措辞已定向检查。
- `final.md` 由修订后的 `draft.md` 机械复制，发布时内容完全一致。

## 双闸门

```text
GATE: FACT_A
VERDICT: PASS
MATERIAL_ISSUES: 0

GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0

GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

FACT_B 在同一会话中纠正了 FACT_A 对 REPL/QueryEngine 路径的错误摘要，确认 I01 原结论正确；规范化汇总无待裁决实质 Issue。原始结果与提示词保存在 `reviews/`。

## Harness 决定

I01 只是复习章，没有候选实现或新行为契约，因此不执行 Harness `merge`、`defer` 或 `reject`，也不修改当前 H2-in-progress。正文只说明 H0/H1 已发布能力和后续依赖边界。

## 发布依据

发布依据为 `2.md`、`3.md`、已确认标杆规则、S0/S1 原子发布结论、M01-M09 正式教材、直接源码核验、既有实验，以及事实 A/B 与独立教学闸门的 `PASS / 0`。I01 可以作为独立复习教材发布。
