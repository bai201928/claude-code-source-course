# M13 实现与实验报告

状态：`implemented`

## 实现范围

M13 建立了不依赖真实模型、不修改源码快照的双语言 request projection 实验，并把经事实闸门确认的最小行为契约合入累计 Mini Agent Harness。

独立实验：

- TypeScript `request-projection.ts`：durable/query/API/wire 四层、history boundary、API user-group budget、跨轮 replacement state、request-only context、normalize、strict/repair pairing 与最终 params；
- TypeScript `request-projection.test.ts`：9 个反例驱动测试；
- Python `request_projection.py`：同一行为目标的 dataclass 实现；
- Python `test_request_projection.py`：8 个对称测试；
- 两种语言 demo：展示完整 source、projection report 与最终 payload 的差异。

这些代码是 `运行验证` 和 `设计迁移`，不是 Claude Code 私有实现复制。

## 事实闸门导致的修订

FACT_A/FACT_B 首次结果均为 `REVISE`。Codex 回到源码后作出三项有效修订：

1. user context 从 normalize 后移动到 request-local query view，确保它流经完整正规化；
2. tool-result budget 从全局候选池改为与最终 API user message 对齐的 group；
3. 新增独立 `ContentReplacementState`，冻结 seen-visible 与 replaced 两类跨轮决策。

修订后使用同一事实会话定向复审，结果为：

```text
GATE: FACT_B_RECHECK
VERDICT: PASS
MATERIAL_ISSUES: 0
```

FACT_A 将 non-streaming fallback 的 SDK 调用误当作主流式路径，声称 `stream: true` 不在 payload。直接源码重查确认主路径为 `messages.create({ ...params, stream: true }, { signal, ... })`，该意见被驳回。

## 被验证的核心结论

- compact boundary 选择 request-visible history，不删除 durable source；
- request-only context 在 normalize 前注入，不写回 source；
- progress/boundary 被过滤，attachment/local output 转成 user；
- tool-result budget 按 API user group 评估，不能使用全局总量；
- replacement state 在提高预算或加入 fresh result 后仍保持旧 prefix 形态；
- strict pairing 拒绝 missing/orphan/duplicate，repair 生成明确 synthetic error 并报告；
- params 在 message projection 后构造并冻结；
- projection 全程不修改 durable source 或嵌套 payload。

首轮 pairing 校验实验暴露一个真实状态机错误：消费 assistant 与紧随其后的 result 后没有同步推进 cursor，导致下一次循环把合法 result 判成 orphan。修复为一次消费这对 API messages，而不是增加绕过条件。

## Mini Agent Harness 合入

Decision: `merge + defer + reject`

Merge：

- `RequestProjectionPolicy`：history start、request-only context、per-result preview limit；
- `RequestProjectionReport`：source/selected/projected count、omission、replacement count、context boolean 和 strict status；
- projection 后 strict tool pairing；
- metadata-only Trace；
- TypeScript/Python 集成测试证明 Store 保留全文、Provider 只见 preview、Trace 不含正文。

Defer：

- aggregate API-user-group budget；
- 跨轮 replacement state 的正式 Harness owner；
- 外置大结果存储与 resume record；
- compact transaction、snip/collapse、Prompt Cache edit。

Reject：

- 在 `ConversationStore` 内原地截断 tool output；
- 在 Provider adapter 中偷偷修补 pairing 或内容且不返回 report。

Compatibility：默认 policy 不改变已有请求。H0、H1 和 H2-in-progress 全部累计回归保持通过。

## 实际运行结果

环境：Node `v24.14.1`、Python `3.11`、项目锁定 TypeScript `7.0.2`。

```text
M13 TypeScript: 9/9
M13 TypeScript strict typecheck: passed
M13 Python: 8/8
M13 TypeScript/Python demos: passed
Integrated TypeScript Agent: 36/36
Integrated Python Agent: 12/12
Integrated Agent regression: 4/4
H2-in-progress: 4/4
H1: 12/12
S0: 15/15
```

正文中的 17 个 Mermaid block 使用 Mermaid CLI `11.16.0` 从完整 Markdown 一次批量生成 SVG，结果 `17/17`。第一次逐图调用 `npx` 因每次重复解析包，在 10 分钟内只完成 3 张后被工具上限终止；该低效尝试不作为通过结果，也未修改工作区。

## 教学闸门

新的独立 Claude Code/DeepSeek Max 会话只读取最高需求教学标准、M11 标杆规则与 M13 正文，结果为：

```text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
```

审查确认四层对象、固定顺序、浅复制、replacement state、normalize compiler、strict/repair、双语言反例、Harness 取舍、企业迁移与 8 道面试题形成 4 至 7 小时闭环。正文接近 7 小时上限属于非阻断风险。

## 证据边界

- `快照事实`：query projection 顺序、boundary、budget state、normalize、pairing 与 params 来自当前源码直接核验和事实双闸门；
- `运行验证`：17 个独立双语言测试与累计 Harness 回归只证明 clean-room 行为；
- `设计迁移`：Harness policy/report、per-result preview 与 strict 默认值是课程方案；
- `无法确认`：当前快照缺失的 snip/context-collapse 等 feature-gated 实现没有被补造。

M13 已具备生成 `release-candidate.md` 的条件；S2 未原子发布，因此不创建 `final.md`。

