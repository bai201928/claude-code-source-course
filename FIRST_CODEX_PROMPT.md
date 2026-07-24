# First Codex Prompt — 首次启动任务

请将以下内容复制到交互式 Codex 中执行。

---

请执行本项目的首次启动任务。

## 开始前

1. 确认你已经读取根目录 `AGENTS.md`。
2. 完整读取 `orchestrator/prompts/codex-orchestrator.md`。
3. 读取 `input/learner-profile.md`、`input/project-decisions.md`、`input/original-course.md` 和 `orchestrator/config/course.yaml`。
4. 检查 `source-snapshot/SNAPSHOT.json` 确认源码快照位置，验证 `claude-code-CLI/src/` 可读且不可写。
5. 不得修改、格式化或重命名 `source-snapshot/` 和 `claude-code-CLI/` 中的任何文件。

## 本次任务只允许完成以下内容

1. **检查并补全课程工程目录** — 确认所有必要目录和文件存在，缺失的创建之。
2. **建立本地源码快照的全局模块清单** — 扫描 `claude-code-CLI/src/` 下所有目录和关键文件，建立模块关系图，输出到 `curriculum/design/source-module-map.json`。
3. **建立原课程核心主题覆盖清单** — 基于 `input/original-course.md`（如果还是 placeholder 状态则以 `input/required-topics.yaml` 为准），建立主题覆盖映射，输出到 `curriculum/design/original-topic-coverage.json`。
4. **生成 30～45 单元候选课程目录** — 基于源码模块划分和核心主题清单，生成完整的候选单元目录，每单元包含标题、目标、核心主题、预估风险等级，输出到 `curriculum/design/unit-catalog.json`。
5. **生成单元依赖图、阶段划分和初始风险等级** — 分析单元之间的前置依赖关系，按依赖分组为阶段（每阶段 3～7 单元），为每单元评定 R1～R4 风险等级，输出到：
   - `curriculum/design/unit-dependencies.json`
   - `curriculum/design/stage-plan.json`
   - `curriculum/design/initial-risk-register.json`
6. **生成 Mini Agent Harness 演进路线** — 设计与课程单元同步的 Harness 构建计划，每阶段需要新增哪些 Harness 模块，输出到 `curriculum/design/harness-roadmap.md`。
7. **生成 TypeScript 知识递进索引** — 按课程顺序列出学习者需要掌握的 TS 知识点，标注首次出现的单元和难度递进，输出到 `curriculum/design/typescript-learning-index.json`。
8. **完善 JSON Schema 和编排脚本骨架** — 检查 `orchestrator/schemas/` 中的 Schema 是否完整可用，必要时修正或补全；检查 `orchestrator/scripts/` 中的脚本是否可执行。
9. **将所有课程设计产物写入 `curriculum/design/`** — 包括上述所有文件，以及一份 `course-design.md` 总览和 `approval-summary.md` 审批摘要。
10. **输出一份需要我审批的课程设计总览** — 简洁列出：单元总数、阶段数、核心主题覆盖率、Harness 演进阶段数、TypeScript 知识点总数、各风险等级单元数量。

## 本次任务禁止

- 编写任何正式单元教材正文
- 创建任何 `final/` 目录下的教材
- 修改或删除原课程核心主题（`input/required-topics.yaml` 中列出的所有主题都必须覆盖）
- 调用 DeepSeek 生成教材或开展审查
- 自动进入第一阶段教材编写
- 提交到 Git 远程仓库

## 输出位置

所有产物写入 `curriculum/design/`：

```
curriculum/design/
├── course-design.md
├── source-module-map.json
├── original-topic-coverage.json
├── unit-catalog.json
├── unit-dependencies.json
├── stage-plan.json
├── harness-roadmap.md
├── typescript-learning-index.json
├── initial-risk-register.json
└── approval-summary.md
```

## 完成后

停止并等待用户审批课程设计包。在获得明确批准前，不得开始生成任何单元的正式教材正文。
