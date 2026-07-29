# M13 教学闸门记录与 Codex 裁决

状态：`teaching-reviewed`

审查会话：`86db2c9e-fb95-4484-8469-8f919f18651d`

审查方式：新的独立 Claude Code/DeepSeek Max 会话，只读取 `2.md` 的教学标准、已确认 `benchmark-rules.md`、M13 `draft.md` 和提示词中的必要前置摘要。未读取源码快照、Graphify、事实闸门、实验实现、全局知识或历史审查输出。有效进程自然退出，无应用层超时、无权限拒绝。

第一次启动因 Windows PowerShell 5.1 错误解码脚本中的中文绝对路径，在语法解析阶段退出；Claude Code 未启动，也未读取材料。改为从 `$PSScriptRoot` 解析项目根目录后，创建新的独立会话执行本记录中的有效闸门。

## 闸门结果

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

## 审查确认

- 正文从 UI/durable history 与 Provider request 的可见差异进入，不是函数目录或表格拼装。
- durable、query、API、wire 四层对象的 owner、问题和 mutation boundary 可以独立复述。
- boundary、budget、snip/microcompact/collapse/autocompact、context、normalize、pairing 和 params 的因果顺序清楚。
- 浅数组复制、`Set`/`Map` 内部可变性及 Java/Python 对照都在改变当前机制的位置讲清。
- 17 张图分布在浅复制、replacement state、group budget、normalize、pairing、params、ownership、实验和 Harness 等认知转折处，并已实际渲染。
- 四组实验包含预测、观察、反证、事实闸门修订和真实 cursor 消费 bug，不只是测试通过。
- Harness 明确区分已合入 per-result preview 与延后的 aggregate budget、外置存储、resume record 和 cache edit。
- Java/Spring、RAG、LangGraph 与企业治理均从当前 owner、projection 与 protocol boundary 自然推出。
- 8 道资深 Agent 开发岗问题均结论先行、口语化约两分钟，并能承接源码、缓存、恢复和系统设计追问。
- M14 的 stream/retry/usage 与 M16-M18 的 Context/compact 内部实现保持延后。

## Codex 裁决

教学闸门没有实质 Issue，不需要修改正文。

审查指出正文信息密度高、接近 7 小时上限，以及状态机 cursor 修错故事对未亲自复现的学习者略抽象。这两项均为非阻断风险：时间仍在用户批准范围内，正文也提供了可运行测试和破坏修改路径。

结论：M13 可以生成 `release-candidate.md`，不得提前生成 `final.md`。

