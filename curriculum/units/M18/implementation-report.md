# M18 实现与实验报告

状态：`release-candidate`

## 事实闸门

会话 `aa2bf510-01ee-4e32-841c-ddb51829d05f`：

```text
FACT_A: PASS / 0
FACT_B: PASS / 0
```

## 独立实验

TypeScript `instruction-pipeline.ts` / Python `instruction_pipeline.py` 遵守同一 clean-room 契约，验证：

- Managed→User→Project→Local→Dynamic 稳定层次；
- scope root 与 conditional prefix；
- untrusted external 拒绝、approved 接受；
- normalized path 去重；
- old snapshot immutable；
- stale writer 与 stale projection 显式失败；
- dynamic request-only，report 无正文。

结果：TypeScript `7/7`、Python `7/7`、TypeScript strict PASS。

## Harness H3-3

Decision: `merge + defer + reject`

Merge：`InstructionCatalog`、`InstructionPipeline`、source/scope/trust/revision、stable order、dedupe、dynamic delta、content-free report 与双语言回归。

Defer：完整 CLAUDE.md parser、gitignore glob、filesystem discovery、symlink/include、InstructionsLoaded Hook、nested trigger、Skill/MCP/Plugin source 和持久化 Catalog。

Reject：无来源字符串拼接、external 默认信任、每轮无条件重读、shared mutable instruction array、dynamic attachment 回写 catalog、Trace 记录正文。

## 实际运行结果

```text
M18 TypeScript independent InstructionPipeline: 7/7
M18 Python independent InstructionPipeline: 7/7
Harness TypeScript Instructions: 7/7
Harness Python Instructions: 7/7
Harness TypeScript strict typecheck: passed

Integrated TypeScript Runtime: 27/27
Harness Compact: 5/5 per language
Harness Python Agent + Compact + Instructions + Scheduler + Stream: 36/36
H2 regression: 4/4
H1 regression: 12/12
S0 regression: 15/15
Integrated regression: 4/4
```

## 教学闸门

独立 Claude Code/DeepSeek Max 会话完整读取最高需求、标杆规则与正文，结果：

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

审查会话：`0790953b-2591-485c-abb5-94e16884aacf`。正文中的 16 个 Mermaid block 使用 Mermaid CLI `11.16.0` 从完整 Markdown 批量渲染，结果 `16/16`。

M18 已生成 `release-candidate.md`；S3 尚未原子发布，因此不创建 `final.md`，也不更新阶段 README。
