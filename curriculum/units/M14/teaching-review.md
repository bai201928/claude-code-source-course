# M14 教学闸门与 Codex 裁决

状态：`teaching-reviewed`

审查会话：`9138eba3-b788-4805-8dcf-a5a6b7e19599`

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

## 通过理由

独立 DeepSeek Max 教学审查确认：

- 正文从“业务消息需要尽早可见，终态字段却更晚才到”的真实矛盾推进，不是 SSE 术语或函数目录；
- `withRetry()`、`queryModel()`、`queryLoop()`、caller signal 和 consumer close 的 owner 可独立复述；
- indexed assembly、assistant-before-event、later mutation 与 lazy transcript reference 形成完整因果链；
- 三类 fallback 和 user abort、SDK timeout、idle watchdog、consumer close 四类停止原因没有混淆；
- tombstone 不等于 rollback，partial tool side effect 的前摄约束清楚但未吞并 M15；
- cumulative usage、run-level cost、TTFT unknown、request-local identity 和显式 span handle 边界明确；
- 13 张局部图分布在认知转折处，并能独立用于复习；
- 实验包含预测、反证和破坏修复，Harness 准确区分已合入 bounded stream 与延后 SSE/runtime/tool/fan-out/OTel；
- Java/Spring、RAG、LangGraph 与企业迁移自然推出；
- 6 道面试题具备资深 Agent 岗位追问价值，回答结论先行、口语化且能承接系统设计。

## Codex 裁决

无实质 Issue，不需要教学复审。

审查者记录了三个非阻断风险：预测组数与测试 case 数不同、Node `--experimental-strip-types` 未解释、M15 需回调核对 partial tool 入口。Codex 对前两项增加了就地说明，避免初学者把测试组织方式或运行 flag 误解为机制；第三项保留为 M15 研究约束，不改写 M14 事实。

普通措辞、标题偏好和中间输出不进入阻断范围。
