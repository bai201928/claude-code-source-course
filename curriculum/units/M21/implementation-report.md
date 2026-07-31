# M21 实现与实验报告

状态：release-candidate

## 事实与教学闸门

```text
FACT_A: REVISE / 5（五项均为提示要求反证的错误命题，不是 Codex 结论缺陷）
FACT_B: PASS / 0
TEACHING: PASS / 0
```

FACT_B 同会话确认 Skill 全文读取与正文延迟投影、realpath 去重与 first-match、Plugin namespace 边界、source policy/schema/path/cache 与 authenticity 的区别、多组件刷新非全局事务，以及卸载不追溯修改 in-flight execution。

## Harness H4-2

Decision：merge + defer + reject。

Merge：双语言 `ExtensionRegistry`、完整 source identity、namespace/model alias 分离、revisioned full bundle replacement、显式 conflict result、trust/signature policy port、immutable snapshot、卸载后的 new-acquire gate、已获 execution lease 合作式 drain、CapabilityCatalog adapter 与 metadata-only trace。

Defer：真实 Git/NPM fetch、Sigstore/X.509/PGP、transparency log、durable marketplace DB、跨实例 generation rollout、Hook/MCP/LSP adapter、emergency revoke 与 UI。

Reject：first/last-wins 静默冲突、namespace 充当供应链主键、version/cache 等同签名、卸载原地修改旧 snapshot、旧 snapshot 无限开新执行、普通 trace 写入 signature/body/secret。

## 聚焦验证

```text
TypeScript ExtensionRegistry: 8/8
Python ExtensionRegistry: 8/8
TypeScript strict typecheck: PASS
Mermaid: 14/14
```

覆盖完整来源身份、显式冲突与失败不改 revision、stale writer、旧 snapshot 不变、卸载成员资格、old-snapshot new-acquire 拒绝、in-flight lease drain、trust fail-closed、CapabilityCatalog adapter 与 metadata-only trace。

累计回归结果在 S4 阶段发布前再次统一记录；M21 不单独创建 `final.md`。
