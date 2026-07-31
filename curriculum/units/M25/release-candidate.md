# M25 Release Candidate

正式候选正文为 `draft.md`。

状态：`release-candidate`，等待 S5/M24-M27 原子发布。

验收摘要：FACT_B `PASS / 0`；FACT_A 的七项安全校准均已裁决并进入正文；TEACHING `PASS / 0`；18/18 Mermaid；TypeScript/Python H7-1 各 `10/10`；累计 TypeScript `124/124`、Python `96/96`、strict typecheck、H2/H1/S0 与 demo 全部通过。

H7-1 合入 revisioned policy、worker/capability/secret/provenance fail-closed envelope 和 metadata-only report；真实 OS Sandbox、Vault、signature verification 和分布式 policy service 明确 defer。阶段审计前不创建 `final.md`，不单独提交或 push。
