# M05 教学闸门记录

状态：`teaching-reviewed`

审查会话：`3aa930d2-fbb8-480e-b096-be0711ee6af7`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max；主审模型为 `deepseek-v4-pro[1m]`，另有 `deepseek-v4-flash` 辅助用量。进程自然退出，无应用层超时、无 stderr、无权限拒绝。

## 闸门结果

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

原始输出没有按提示词要求把固定三行放在首行，但在总体判断中明确写出“M05 通过教学闸门审查”，并把全部发现标为“不阻断发布”。上述三行是对其明确结论的规范化记录，不是 Codex 自行改变判定。

## 通过理由

审查者确认：

- 正文由四个真实启动场景驱动，沿 fast path、表面分类、Interactive/Headless、输入、协议、输出、生命周期、实验与迁移连续推进，不是文件或知识点拼装；
- flags/TTY、bootstrap state 和 client type 的区分是清晰且决定性的教学主线；
- Ink root/App/REPL 与 headless store 的所有权解释足以让初学者独立复述；
- 动态导入、联合类型、AsyncIterable 和 Node strip-only 在首次改变机制时就地讲清，并有 Java/Python 对照；
- NDJSON framing、control request/response、pending map 与 outbound 顺序通过就地时序图收敛；
- 四个验证实验和四个破坏实验均包含结论、输入、观察点、预期与反证；
- H1-in-progress 的复用、未承诺范围与 merge 理由诚实，Java/Spring、LangGraph 和企业治理由当前边界自然推出；
- 8 道资深 Agent 面试题均结论先行，具有运行机制、证据边界和系统设计追问价值；
- 十项学习目标全部覆盖，主体密度能够支撑 4 至 7 小时学习。

## 非阻断意见与 Codex 裁决

### T-N01 生命周期段落位置

Decision: `rebutted as material issue`

Reason: 正文已按 output projection、SDK evidence boundary、close/failure semantics 推进，属于从协议输出到证据边界再到生命周期收敛的可理解顺序。审查者仅表达位置偏好，并明确不阻断。

Change: 无。

### T-N02 为 `string | AsyncIterable<string>` 增加一张图

Decision: `rebutted as material issue`

Reason: 该段前后已有 Headless 输入图与 StructuredIO framing 时序图，正文又给出 TypeScript/Java/Python 对照、生命周期差异和错误统一方式。当前稿实际有 10 张 Mermaid 图；新增装饰性分流图不会改变学习闭环。

Change: 无。

### T-N03 扩写 LangGraph 对照

Decision: `deferred`

Reason: 当前单元只需把 Surface/Core 分层迁移到 LangGraph，正文已经说明 adapter、graph state 和 event projection 的边界。`interrupt`/`Command` 的完整机制属于后续编排和人在环专题，本章扩写会提前吞掉依赖。

Change: 无。

### T-N04 面试回答进一步拆短

Decision: `rebutted as material issue`

Reason: 审查者确认所有回答结论先行、长度约 1.5 至 2 分钟、总体符合口语化标准，只指出个别句子仍可更自然。该意见不影响回答顺序、机制准确性或现场组织能力。

Change: 无。

## 复审判断

没有严重认知跳跃、图文冲突、实验无效或 Harness 契约问题。根据 V3 规则与用户“忽略不影响教材质量的问题”的决策，不消耗第二轮教学复审。

结论：M05 已通过教学闸门，可以进入候选稿自检与 `release-candidate` 状态。
