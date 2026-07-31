# M18 FACT_B 对照审查任务

继续当前 FACT_A 的同一会话。请对照下列 Codex 初步结论，指出仍会影响教材、实验或 H3-3 的实质错误；不要修改文件。

## Codex 初步结论

- eager discovery 按 Managed、User、root-to-CWD Project/Local、可选 additional dirs；无条件 Rules eager，conditional Rules 路径触发；
- `getUserContext()` 把 CLAUDE.md 变成 userContext，而不是 default system prompt；custom prompt 替换 default/systemContext，但 userContext 仍构造；append 在 custom/default 之后；
-普通 system prompt sections memoized，危险 section 每轮重算，clear/compact reset；
- nested instruction 通过 trigger path、allowed working path、三阶段 traversal 生成 `nested_memory` attachment；
- non-evicting loaded set 防重复，readFileState 同时承担变化检测与 transformed-content edit safety；
- attachment user-input phase 先于 nested phase，Promise.all 保持数组顺序，getter error 经 `maybe()` 隔离；
- InstructionsLoaded hook 是 fire-and-forget observer；
- external Project/Local includes 未批准时不进入 context，User includes 可外部；
- dynamic attachment 是每轮 Query message projection，不是 instruction filesystem owner；
- H3-3 将使用 scoped/revisioned immutable instruction snapshot，不复制所有 feature path。

特别核对：parent/include 输出顺序、rules readdir 顺序是否稳定、custom prompt 与 CLAUDE.md、timeout 是否真正 abort getter、interactive/headless snapshot 时点、compact reload reason。

输出必须以三行开头：

```text
GATE: FACT_B
VERDICT: PASS | REVISE | BLOCK
MATERIAL_ISSUES: <number>
```
