# M05 事实闸门记录

状态：`fact-reviewed`

事实会话：`ccfb70d3-0eb6-461a-a585-d789acd5fbac`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max；FACT_A 主审实际模型为 `deepseek-v4-pro[1m]`，进程自然退出，无应用层超时，无权限拒绝。

## FACT_A

```text
GATE: FACT_A
VERDICT: REVISE
MATERIAL_ISSUES: 3
```

盲审独立确认了：

- `entrypoints/cli.tsx` 的 fast path 与普通动态导入链；
- non-interactive 的四类触发条件；
- entrypoint/client type 标签与 interactive state 分离；
- Ink `App + REPL` 与 headless store/`runHeadless()` 的分叉；
- text/json/stream-json 投影和 StructuredIO 控制协议；
- `agentSdkTypes.ts` 只含类型与占位实现的证据边界。

它另外报告三项所谓实质问题，见下方 Codex 裁决。

## FACT_B

同一会话 ID 对照 Codex 摘要、教材边界和 H1 实验契约后，结果为：

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

审查者确认所有源码摘要、证据边界和五项 RuntimeSurface 候选契约均准确，并明确三项 FACT_A 意见不使教材结论或 H1 契约无效。

## Codex 裁决

### F-A01 text result switch 没有 default

Decision: `rebutted as material issue`

Reason: FACT_A 假设未来会新增未处理的 result subtype，但没有指出当前可达 subtype 被静默遗漏，也没有推翻教材对已知输出投影的描述。这属于防御性实现建议，不应阻断源码教材。

Change: M05 不把已知 case 表述成未来穷尽全集；clean-room Headless adapter 对未知 event/result 提供显式错误，而不是复制该边缘形状。

### F-A02 无 TTY 被标为 `sdk-cli`

Decision: `rebutted`

Reason: 源码明确把 `sdk-cli` 用作默认 non-interactive CLI 的内部 client type。名称可能令人误解，但教材已经把 client type 定义为内部来源标签，并明确它不等于 TypeScript/Python SDK，也不控制 surface 分支。FACT_A 把命名偏好升级成事实缺陷没有依据。

Change: 正文会专门解释 `sdk-cli` 的反直觉命名边界。

### F-A03 `--update` argv 重写时序

Decision: `rebutted`

Reason: FACT_A 声称 argv 重写发生在 `main.tsx` 完成 non-interactive 分类之后，时序相反。重写位于 `entrypoints/cli.tsx`，随后才动态导入并调用 `main.tsx:main()`。Commander 子命令依赖也与 M05 RuntimeSurface 契约无关。

Change: 无。教材按 `entrypoints/cli.tsx -> dynamic import main.tsx -> main()` 的真实顺序画图。

## 结论

M05 运行表面主链、SDK 证据边界和 H1 候选契约已通过事实闸门。FACT_A 三项意见均不阻断；其中一项仅转化为 clean-room unknown-case 设计提醒。

