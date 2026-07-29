# M06 实现与实验报告

状态：`implemented`

## 独立行为契约

TypeScript 与 Python clean-room 实现遵守同一组配置契约：

- canonical order 固定为 user/project/local/flag/policy，flag/policy 始终存在；
- snapshot-compatible order 复现当前快照显式 `--setting-sources` 的 Set 插入顺序；
- Resolver 接受显式有序来源，不把来源选择和合并藏在全局状态中；
- policy provider first-valid/non-empty-wins，与主来源 merge 分离；
- 对象递归、标量后来源覆盖、数组连接并按 SameValueZero 语义去重；
- invalid source 整体退出并保留 error；
- CLI flag file 与 SDK inline 同属 flagSettings，inline 在同来源内后合并；
- scalar leaf 与 array item provenance；
- pre-trust 与 trusted environment projection 分离，safe provider switch 与 endpoint redirect 分离；
- flag/policy 在 Harness 内只读；
- revisioned snapshot 不被新 revision 或外部输入原地修改。

## M06 独立实验

TypeScript：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M06\code\typescript"
node configuration.test.ts
node demo.ts
powershell -NoProfile -ExecutionPolicy Bypass -File .\typecheck.ps1
```

实际结果：9/9 行为测试通过，demo 显示 canonical 空选择为 `flag -> policy`、快照兼容空选择为 `policy -> flag`，strict typecheck 通过。

Python：

```powershell
cd "D:\agent\Claude code最新\curriculum\units\M06\code\python"
python -m unittest -v test_configuration.py
python demo.py
```

实际结果：9/9 `unittest` 通过，demo 与 TypeScript 在 source order、policy provider、effective value、provenance、trust env 和 errors 上一致。

## H1-in-progress 合入

Decision：`merge`

新增：

- `mini-agent-harness/typescript/configuration.ts` 与 `configuration.test.ts`；
- `mini-agent-harness/python/configuration.py` 与 `test_configuration.py`；
- H1 contract 的配置快照不变量；
- H1 regression 中两项双语言配置检查。

累计回归：

```powershell
cd "D:\agent\Claude code最新\mini-agent-harness"
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-h1-regression.ps1
```

实际结果：H1-in-progress 6/6 检查通过，其中包含 S0 15/15；RuntimeSurface TypeScript 8/8、Python 7/7；Configuration TypeScript/Python 各 9/9；TypeScript strict 通过。

## 图示验证

`draft.md` 的 12/12 Mermaid 图已用 Mermaid CLI 实际渲染为 SVG。输出位于 `review-workspace/mermaid/`，只作可重建审查产物，不进入候选正文。

## 兼容与边界

- 当前源码的 explicit source order 差异属于快照事实；Harness canonical order 属于设计迁移。
- leaf/item provenance、deep-frozen revision snapshot 不冒充 Claude Code 现有 API。
- 实验不读取真实用户设置、不修改 `process.env`、不调用真实模型、不测试私有源码。
- M06 不展开完整 remote policy identity/security/ETag/polling control plane，也不提前实现 M07 AppState bootstrap owner。
- H1 仍为 `H1-in-progress`，将在 M07-M09 继续演进。

