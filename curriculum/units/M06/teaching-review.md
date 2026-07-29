# M06 教学闸门记录

状态：`teaching-reviewed`

审查会话：`18e3bb08-307f-4244-8efb-d6494202e018`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max；主审为 `deepseek-v4-pro[1m]`，另有 `deepseek-v4-flash` 辅助用量。进程自然退出，无应用层超时、无权限拒绝。

## 闸门结果

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

## 通过理由

审查者确认：

- 正文由 `default -> plan -> acceptEdits -> dontAsk` 的真实冲突持续驱动，沿发现、解析、策略选择、主合并、trust、运行决策和热更新连续推进；
- 默认优先级与显式 `--setting-sources` 的快照行为既清晰区分，又没有被写成漏洞专题；
- `Exclude`、Set insertion order、Zod safeParse、mergeWith customizer、clone/cache 都在首次改变当前语义时就地解释；
- 12 张图覆盖启动、来源、flag 双入口、顺序例外、provenance、policy provider、parse、trust、热更新和 H1 边界，图文一致；
- policy selection、main merge、write merge、runtime decision 四层可独立复述；
- pre-trust/trusted、provider switch/endpoint redirect、Interactive/Headless implicit trust 形成可操作安全模型；
- 6 个正向实验与 4 个破坏实验均包含结论、输入、观察点和反证；
- H1 compatibility 仅用于研究，canonical 作为企业默认，边界合理；
- Java/Spring、RAG、LangGraph 和 configuration revision/provenance 从当前机制自然推出；
- 10 道面试题由资深 Agent 岗问题逐层推进，回答均结论先行并可承接源码/系统设计追问。

## 非阻断风险

- 上游若修正 `getEnabledSettingSources()` 排序，需要更新 snapshot-compatible function 和对应教材表述；这是快照课程的正常维护，不阻断当前版本。
- 远程策略完整控制平面、M07 bootstrap 和桌面宿主协议已明确延后，不属于遗漏。
- 少数面试回答实际口述可能略超两分钟，但可现场压缩，不影响机制和表达训练。

根据用户“忽略不影响教材质量的问题”的决策，不消耗第二轮教学复审。

结论：M06 已通过教学闸门，可以进入 `release-candidate` 状态。
