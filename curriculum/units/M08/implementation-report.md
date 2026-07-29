# M08 实现与实验报告

状态：`implemented`

## 独立行为契约

TypeScript 与 Python 独立实验遵守同一组能力契约：

- catalog 以 source、显式 priority 和 revision 发布唯一 active definition；
- policy、mode、provider、model 和 deferred discovery 只改变 projection，不删除 registry handler；
- request/iteration snapshot 创建后不可变，新 catalog revision 只在显式 boundary 生成新 snapshot；
- deferred capability 可已注册，但 discover 前没有 model-visible schema；
- model-visible 但无 handler 的 dispatch fail closed；
- projection decision 保留 reason；
- custom prompt 替换 default，append 是独立层，user/system context 分开保存；
- portable ASCII capability name 与 code-point 排序保证双语言 trace 可复现。

## M08 独立实验

TypeScript：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M08\code\typescript"
node capability-projection.test.ts
node demo.ts
powershell -NoProfile -ExecutionPolicy Bypass -File .\typecheck.ps1
```

实际结果：8/8 行为测试通过，strict typecheck 通过。demo 显示旧 snapshot 保持 revision 1/`Read`，刷新 snapshot 为 revision 2/`Read + Search`，registry 同时保存 `Read + Search`，policy 隐藏 `Deploy`。

Python：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M08\code\python"
python -m unittest -v test_capability_projection.py
python demo.py
```

实际结果：8/8 `unittest` 通过；demo 在 revision、visible schemas、registry、dispatch 与 projection reasons 上和 TypeScript 对称。

## 代表性失败实验

1. Catalog/registry 中存在 `Deploy`，policy 隐藏后模型 projection 不含它，但 registry handler 仍存在；证明 discovery/executable 不等于 visibility。
2. Catalog revision 2 加入 `Search` 后，revision 1 request snapshot 不变化；只有新 boundary 得到新 snapshot。
3. 注入 model-visible `Ghost` schema，不注册 handler；dispatch 抛出 `visible tool has no executable handler`，不降级成任意动态调用。
4. Deferred `Search` 已注册但未 discover 时不发 schema；discover 后才进入 projection。

## H1-in-progress 合入

Decision：`merge`

新增：

- `mini-agent-harness/typescript/capabilityProjection.ts` 与 6 项测试；
- `mini-agent-harness/python/capability_projection.py` 与 6 项测试；
- H1 contract 的 catalog/projector/snapshot/registry/system-context 不变量；
- H1 regression 中两项双语言 capability 检查。

H1 的 `CapabilitySnapshot` 与独立实验保持同一可观测边界：除 catalog revision 和 boundary 外，也保存产生本次 projection 的 mode、provider 与 model，避免后续请求日志只能看见“哪些 schema 可见”，却无法解释“按什么维度投影”。

累计回归：

```powershell
cd "D:\agent\Claude code最新\mini-agent-harness"
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-h1-regression.ps1
```

实际结果：H1-in-progress 10/10 检查通过，其中包含 S0 15/15；M05 RuntimeSurface、M06 Configuration、M07 RuntimeContext 和 M08 CapabilityProjection 的 TypeScript/Python 行为均通过；TypeScript strict 通过。

## 图示与教学验收

- `draft.md` 的 14/14 Mermaid 图已用 Mermaid CLI 实际渲染为 SVG；
- 本地工具池与 delta attachment 两张横向图在视觉检查后改为纵向布局，缩放到教材正文宽度时仍可读；
- 独立教学闸门使用新会话 `c5fefc03-6651-4bfb-8b1f-c1c6c06ecaae`，结果为 `PASS / 0`；
- 审查进程自然退出，无权限拒绝和应用层超时。

## 兼容与边界

- 源码事实保留 Claude Code command 消费者各自解析、Interactive/Headless 非对称和 session schema cache；Harness 不复制这些偶然形状。
- Harness 的显式 priority、immutable snapshot 与 fail-closed registry 是设计迁移，不冒充 Claude Code 当前公开 API。
- `SystemContextBuilder` 表达 clean-room 语义，不声称统一复刻 Claude Code 两条入口的全部 feature-gated prompt。
- M08 不展开完整 Permission、MCP wire protocol、Plugin marketplace、Agent execution 或 Transcript。
