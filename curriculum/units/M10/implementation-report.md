# M10 实现与实验报告

状态：`implemented`

## 行为契约

TypeScript 与 Python clean-room 实现遵守同一组消息所有权契约：

- `ConversationStore` 是 durable message membership 的唯一 owner；
- 每次成功 publication 产生单调 revision，writer 必须携带 expected revision；
- snapshot 固定创建时的 revision 和成员集合；
- publication 复制并冻结嵌套 payload，调用者不能通过旧别名回写；
- envelope、provider response、tool use 和 parent identity 使用不同概念；
- human input 与 tool result 是不同领域 kind；
- progress 是 ephemeral event，不推进 durable revision；
- orphan、duplicate 和 missing tool result fail closed；
- 并行 tool uses 允许结果乱序到达，但每个 ID 必须恰好解析一次；
- provider request 边界要求 tool result 紧邻产生它的 assistant turn。

该契约是设计迁移，不复制 Claude Code 的完整消息联合，也不复制其非 strict pairing 修复策略。

## 独立实现验证

TypeScript：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M10\code\typescript"
node conversation-store.test.ts
node demo.ts
powershell -NoProfile -ExecutionPolicy Bypass -File .\typecheck.ps1
```

实际结果：10 个行为测试全部通过；strict typecheck 通过；demo 显示 turn view 保持 revision 1 和 3 个成员，owner 随 tool result publication 前进到 revision 2 和 4 个成员。

Python：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M10\code\python"
python -m unittest -v test_conversation_store.py
python demo.py
```

实际结果：11 个 `unittest` 全部通过；demo 产生与 TypeScript 一致的 revision、durable membership、ephemeral progress 和 trace 语义。

## 代表性验证与反证条件

1. 数组成员快照：旧 snapshot 在后续 append 后仍只包含创建时的成员。若旧 snapshot 的长度随 owner 增长，契约失败。
2. 嵌套别名：调用者在 publication 后修改原始 tool input，已发布 block 仍保留旧值且被冻结。若修改穿透，契约失败。
3. stale writer：两个 writer 从同一 revision 出发，先提交者成功，后提交者收到 `RevisionConflictError`。若第二次提交覆盖第一次更新，契约失败。
4. 身份分离：两个 assistant envelope 可共享 response ID 并被分组，但 envelope ID 仍分别保留。若按 response ID 覆盖，只剩一个 fragment，契约失败。
5. 配对：orphan、duplicate、missing 或不相邻 result 均不能进入 request；两个并行 tool use 各有一个 result 时通过。若错误序列被接受，契约失败。
6. ephemeral 边界：progress sequence 增长，但 durable revision 和 membership 不变。若 progress 成为 durable parent，契约失败。

TypeScript 实现首次验证时发现 `toolUseBlock()` 直接冻结了调用者传入的 `input` 对象，使测试无法继续修改原始输入来证明 publication 隔离。实现已改为先 `structuredClone()`、再深冻结副本。修复后 10/10 测试和严格类型检查通过。

## 证据分类

- `快照事实`：REPL `messagesRef`、Headless `mutableMessages`、QueryEngine 浅数组快照、stream 后写回、消息身份、progress/transcript filter、tool pairing 与并行恢复来自当前 `claude-code-CLI/` 源码，并经过 FACT_A/FACT_B。
- `运行验证`：上述测试只证明本单元 clean-room 契约，不代表 Claude Code 原仓库的动态测试。
- `设计迁移`：单 owner、expected revision、publication 深冻结、显式 domain kind 和 fail-closed pairing 是 H2 的企业化选择，不冒充 Claude Code 当前实现。

## Harness 裁决

Decision: `merge`

Reason: 消息 owner、revision、snapshot、identity、ephemeral 分离和 pairing 契约已由 TypeScript/Python 对称实现验证；它们是后续 Query Loop、模型 adapter 和 Tool Loop 的必要前置。

Compatibility: H0/H1 的运行、配置、请求状态、能力投影和生命周期接口均未修改。新增模块不接管 `SessionStateStore`，只拥有消息历史；后续 M11-M15 必须通过显式组合接入。

Boundary: 当前不合入真实 provider message、非严格 pairing 修复、Transcript DAG、fork/compact、跨进程恢复或工具执行；这些由后续单元逐步演进。

## 累计回归

```powershell
cd "D:\agent\Claude code最新\mini-agent-harness"
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-h2-regression.ps1
```

实际结果：H2-in-progress `4/4` 检查通过，其中包含 H1 `12/12` 与 S0 `15/15`；新增 ConversationStore TypeScript `10/10`、Python `11/11`，累计 TypeScript strict typecheck 通过。

## 候选稿前最终验证

- 独立 TypeScript `10/10`、Python `11/11`，TypeScript strict typecheck 再次通过；
- H2-in-progress `4/4` 再次通过，包含 H1 `12/12` 与 S0 `15/15`；
- 正文 12/12 Mermaid 图用 Mermaid CLI `11.16.0` 全量渲染；两张视觉歧义图定向修正后再次全量通过；
- 37 对 Markdown 代码围栏平衡，8 道面试题与 9 个源码定位入口完成静态检查；
- 教学闸门为 `PASS / 0`；
- `release-candidate.md` 与最终 `draft.md` 机械复制，`final.md` 保持缺失。
