# Claude Code CLI 源码课程工程

基于本地 Claude Code CLI 泄露源码快照，系统学习 Agent CLI 的源码实现，构建 30～45 单元源码教材，并逐步实现 TypeScript 与 Python 版本的 Mini Agent Harness。

## 工程结构

```
├── AGENTS.md                  # Codex 项目级规则
├── FIRST_CODEX_PROMPT.md      # 首次 Codex 启动输入
├── BOOTSTRAP_REPORT.md        # 环境初始化报告
├── input/                     # 输入文件（学习者资料、决策、原始课程）
├── source-snapshot/           # 源码快照元数据
├── orchestrator/              # 编排中心
│   ├── config/                # 课程参数、风险规则、发布规则
│   ├── prompts/               # Codex主控提示词、审查提示词
│   ├── schemas/               # JSON Schema
│   └── scripts/               # 启动与维护脚本
├── review-template/           # 独立审查工作区模板
├── curriculum/                # 课程产物
│   ├── design/                # 课程设计包
│   ├── global/                # 全局知识库
│   ├── units/                 # 各单元教材
│   └── stages/                # 阶段发布
├── mini-agent-harness/        # Mini Agent Harness 实现
├── review-workspaces/         # 审查工作区（运行时）
└── tmp/                       # 临时文件
```

## 工具链

- **Codex** (GPT-5.2 Codex)：主分析、主作者、主编排
- **Claude Code + DeepSeek**：事实审查、教学审查
- **TypeScript**：源码语言
- **Python**：契约等价实现
- **Java**：类比与迁移实验

## 启动

### 首次启动

1. 运行环境检查：`.\orchestrator\scripts\Verify-Environment.ps1`
2. 锁定源码快照：`.\orchestrator\scripts\Lock-Snapshot.ps1`
3. 启动 Codex：`.\orchestrator\scripts\Start-Codex.ps1`
4. 将 `FIRST_CODEX_PROMPT.md` 内容粘贴到 Codex 中

### 运行测试

```powershell
.\orchestrator\scripts\Test-Bootstrap.ps1
```

## 状态

项目已初始化，等待首次 Codex 运行生成课程设计包。
