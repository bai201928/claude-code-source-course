# FACT_B 最终收口

继续同一 M06 FACT 会话。你在 `FACT_B_ORDER` 中给出 `REVISE / 1`，Codex 已完成修正和实验。请只对照下列最终边界，不扩散源码阅读。

## 已修正的教材事实

1. 默认 bootstrap state 与 `SETTING_SOURCES` 的顺序是 `user -> project -> local -> flag -> policy`。
2. 当前快照显式 `--setting-sources` 时不重新排序：保留用户列出的 ordinary source 顺序，再按 `policy -> flag` 追加 mandatory sources。
3. 因而：
   - `user,project,local` 得到 `user -> project -> local -> policy -> flag`；
   - `local,user` 得到 `local -> user -> policy -> flag`；
   - 空列表得到 `policy -> flag`。
4. 教材不再无条件声称 policy 总是最终覆盖，也不再把 `--setting-sources` 描述为绝不会改变优先级的纯过滤器。
5. 这是当前快照的有条件行为和版本边界，不建议用户利用，也不修改只读源码。

## 已实现的 clean-room/H1 契约

- `deriveSnapshotCompatibleOrder()` 精确复现上述 Set 插入行为，用于教学观察和兼容测试；
- `deriveCanonicalOrder()` 固定保留 policy 为最高层，是 H1 默认企业设计；
- `ConfigurationResolver` 接收显式有序来源，不在内部猜测顺序；
- first-valid/non-empty policy provider selection 与主来源 merge 分开；
- 对象递归、标量后层覆盖、数组连接去重；
- scalar leaf 与 array item provenance；
- invalid whole source rejection；
- flag/policy read-only guard；
- pre-trust 与 trusted environment projection；
- revisioned frozen snapshot，新版本不修改旧 snapshot；
- RuntimeCore 外围解析配置，不直接读取 argv/files/process.env。

实际结果：M06 TypeScript 9/9、Python 9/9、TypeScript strict 通过；H1-in-progress 6/6 检查通过并保留 S0 15/15、表面层 TypeScript 8/8、Python 7/7。

## 裁决要求

确认 `FACT_B_ORDER` 的 material issue 是否已经被教材边界和实验契约完整修正。只报告仍会影响事实、实验有效性或 Harness 契约的问题。输出必须以：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```

开始。若已闭合，明确写 `No material issues`。
