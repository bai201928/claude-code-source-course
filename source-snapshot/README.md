# Source Snapshot

## 状态

**present** — 源码快照已存在于项目中。

## 实际位置

源码快照位于项目根目录下的 `claude-code-CLI/` 目录中，**不在** 本 `source-snapshot/` 目录内。

```
项目根目录/
├── source-snapshot/          # 本目录（只存放元数据）
│   ├── SNAPSHOT.json         # 快照元数据
│   └── README.md             # 本文件
│
└── claude-code-CLI/          # 实际源码快照位置
    ├── README.md
    └── src/                  # ~1332 个 TypeScript 源文件
        ├── QueryEngine.ts
        ├── Tool.ts
        ├── Task.ts
        ├── main.tsx
        ├── query/
        ├── tools/
        ├── tasks/
        ├── ...
        └── voice/
```

## 快照说明

- 来源：Claude Code CLI npm 包中泄露的 TypeScript 源码（2026年3月）
- 文件数：约 1332 个 `.ts`/`.tsx` 文件
- 总代码行数：约 513,237 行
- 原始仓库：https://github.com/anthropics/claude-code

## 使用规则

1. **源码快照始终只读** — 不得修改、格式化、重命名或生成缓存文件
2. Codex 从课程工程根目录启动，通过 `source-snapshot/SNAPSHOT.json` 发现快照位置
3. 首次启动 Codex 前，运行 `Lock-Snapshot.ps1` 设置操作系统级只读属性
4. 本 `source-snapshot/` 目录只存放元数据，不放源码副本
