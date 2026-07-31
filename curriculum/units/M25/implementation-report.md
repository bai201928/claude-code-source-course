# M25 实现与实验报告

状态：`release-candidate`

## 闸门

```text
FACT_A: REVISE / 7
FACT_B: PASS / 0
TEACHING: PASS / 0
```

FACT_A 的实质校准已全部进入正文：excluded command isolation downgrade、weaker isolation、Native Windows 严格 policy、noninteractive remote policy、secret 三边界、publisher authenticity 与 TOCTOU。FACT_A 把“默认未启用”称为 silent failure 的表述被反驳；FACT_B 接受区分后的结论。

## Harness H7-1

Decision：`merge + defer + reject`。

Merge：TypeScript/Python revisioned `PolicyEngine`、worker identity、filesystem/network/process argv constraint、trusted-boundary secret reference resolution、extension provenance exact match、policy-refresh 复查、required-Sandbox fail closed、effect 前 cancellation 与 metadata-only `SecurityReport`。

Defer：真实 OS/container Sandbox adapter、native Windows isolation、kernel/network enforcement、Vault/KMS adapter、policy distribution/lease、worker attestation、PKI/signature verification、SBOM/transparency log 与 directory-FD/no-follow file service。

Reject：Permission allow 冒充资源隔离、Sandbox unavailable 自动 fallback、允许 executable 自动放行任意 argv、secret value 进入 model request/report、digest 冒充 publisher signature、应用层 path check 宣称完全 TOCTOU-proof。

## 实验结果

```text
TypeScript SecurityBoundary: 10/10
Python SecurityBoundary: 10/10
TypeScript integrated: 124/124
Python integrated: 96/96
Strict typecheck: PASS
H2/H1/S0 cumulative: PASS
Integrated demo: PASS
Mermaid: 18/18
```

聚焦实验覆盖 optimistic policy revision、stale request、permission-allow/sandbox-deny、required Sandbox unavailable、network/process argv separation、secret-only trusted envelope、missing secret、secret resolve 期间 policy refresh、extension provenance 与 effect 前 cancellation。

H7-1 是作品集级安全控制面和 port contract，不声称实现了 Claude Code 的外部 Sandbox runtime 或生产隔离平台。
