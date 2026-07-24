# Claude Code CLI 课程工程规则

## 项目目标

本工程用于基于本地Claude Code CLI源码快照，生成30～45个系统性源码教学单元，并逐步实现TypeScript与Python版本的Mini Agent Harness。

## 启动时必须读取

开始任何任务前，必须读取：

- `orchestrator/prompts/codex-orchestrator.md`
- `input/learner-profile.md`
- `input/project-decisions.md`
- `input/original-course.md`
- `orchestrator/config/course.yaml`

这些文件共同构成本项目的完整需求。不得只依据本文件生成教材。

## 权限规则

- `source-snapshot/` 是只读证据源，不得修改、格式化、重命名或生成缓存文件。
- 所有教材单元草稿只能写入 `draft/`。
- 未通过事实审查、教学审查和阶段一致性检查，不得写入 `final/`。
- DeepSeek 只能作为审查者，不得直接修改教材正文、知识库或主项目。
- 所有 DeepSeek 实验必须在隔离审查目录执行。

## 首次运行

第一次运行只能：

1. 检查并补全课程工程目录与输入文件；
2. 扫描本地源码快照，建立全局模块清单；
3. 建立原课程核心主题覆盖清单；
4. 生成30～45单元候选目录、依赖图、阶段划分和初始风险等级；
5. 生成 Mini Agent Harness 演进路线；
6. 生成 TypeScript 知识递进索引；
7. 创建后续需要的 JSON Schema 和编排脚本骨架；
8. 将课程设计产物写入 `curriculum/design/`；
9. 输出课程设计审批总览并停止。

第一次运行禁止：

- 生成正式教材正文；
- 创建任何 `final/` 教材；
- 删除原课程核心主题；
- 调用 DeepSeek 生成教材；
- 自动进入下一阶段。

## 证据规则

内部实现优先依据本地源码和本地测试。

新版公开信息只能作为双版本补充，不得直接覆盖本地快照结论。

无法确认的正文结论必须紧邻标记 `【推断】`。

## 工作质量

主线优先级：

1. 机制与架构理解；
2. 真实源码定位、调用链和关键实现；
3. 独立复现与修改能力；
4. 面试表达。

不得用函数名堆砌代替机制解释。

## 凭据安全

不得在任何输出、日志或教材中回显真实 API Key、Token、Cookie 或其他凭据。

## Git 规则

未经用户明确要求，不得提交到远程 Git 仓库。
