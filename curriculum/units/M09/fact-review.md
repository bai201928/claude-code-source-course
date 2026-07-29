# M09 事实闸门记录

状态：`fact-reviewed`

事实会话：`a92fde3b-4b52-4924-ae93-7b006a2481b0`

审查模型：Claude Code CLI 经 CC SWITCH 调用 DeepSeek Max。FACT_A 与最终 FACT_B 均自然退出；FACT_B 首次运行的父 PowerShell 提前断开，但 Claude 子进程继续并自然完成，随后在同一会话中只重发既有结论。模型调用未设置应用层超时，无权限拒绝。

## FACT_A

```text
GATE: FACT_A
VERDICT: PASS
MATERIAL_ISSUES: 0
```

盲审独立确认了 signal 安装、turn cancel、SessionEnd、process shutdown、cleanup registry、Transcript flush、预算和 bypass 路径。Codex 没有因 `PASS` 直接采纳全部文字，而是回到源码与运行实验裁决。

Codex 裁决：

```text
Issue: M09-A-01
Decision: accepted
Reason: cleanupRegistry.ts 只有 Set + Promise.all；sessionStorage.ts 在首次 getProject() 时惰性注册 flush，不能证明它是 registry 第一项或拥有优先级。
Change: 正文只说 transcript flush 位于 hooks/analytics 之前的 cleanup stage；明确同层 handler 并发、完成顺序不保证。
```

```text
Issue: M09-A-02
Decision: accepted
Reason: isShuttingDown() 的真实运行调用点在 sessionStorage.ts 与 print.ts；定向搜索没有发现 main.tsx 调用。
Change: 删除“main.tsx 用它阻止新 command”的说法，只保留 remote persistence suppression 与 print finally 分支。
```

```text
Issue: M09-A-03
Decision: accepted
Reason: tengu_cache_eviction_hint payload 只有固定 scope=session_end 与 last_request_id；shutdown reason 只传给 executeSessionEndHooks。
Change: 正文、图和面试表达不再把 reason 画进 cache event。
```

```text
Issue: M09-A-04
Decision: accepted
Reason: REPL onCancel 是 Ink/按键级 turn cancellation；外部 OS SIGINT 由 process signal handler 处理。Headless print 另有先 abort 再 shutdown 的组合 handler。
Change: 三条路径分图讲解，避免把 Ctrl+C 字样当成唯一语义。
```

```text
Issue: M09-A-05
Decision: accepted
Reason: /resume 显式提供 AppState access；/clear 取决于调用参数；普通 /exit、signal、renderAndRun 与 Headless shutdown 通常未传 options。
Change: SessionEnd 的 reason/timeout 共享，但状态可见性按 call site 分开表述。
```

```text
Issue: M09-A-06
Decision: accepted as wording correction
Reason: gracefulShutdownSync 把 catch 链赋给 pendingShutdown，并非字面上 void 掉 Promise；但调用者仍不 await。
Change: 使用“同步启动并保存异步关机 Promise，不同步完成清理”的精确表述。
```

对当前 `cleanupRegistry.ts` 形状的运行实验观察到：

```json
["slow:start","fail:start","registry:rejected","after-await","slow:done"]
```

这直接证明一个 handler reject 会让 await 早结束，但不会取消已启动的慢 peer。

## FACT_B

同一会话对照后结果：

```text
GATE: FACT_B
VERDICT: PASS
MATERIAL_ISSUES: 0
```

FACT_B 确认：

- 四层生命周期模型与源码一致；
- `gracefulShutdownSync` 是同步外壳，不是同步清理；
- first caller、阶段顺序和预算关系准确；
- registry 无 phase/priority，reject/timeout 不取消 loser；
- transcript flush 没有 registry 内专属优先级；
- `/clear`、`/resume`、process exit 的 AppState access 不能概括为等价；
- cache eviction hint 不携带 shutdown reason；
- LifecycleCoordinator 的三层清理是明确标记的 Harness 设计迁移。

FACT_B 声称 FACT_A 没有写过 `main.tsx` 使用 `isShuttingDown()`，与 FACT_A 原始文本不符；这属于审查者对自己旧文本的回忆错误。Codex 已用直接搜索裁决真实 call site，且最终事实结论正确，因此不形成新的教材问题。

## 结论

M09 事实范围已闭合。正文必须始终区分 turn cancellation、logical SessionEnd、process graceful shutdown 与 abrupt termination；不得把注释里的“关键”翻译成 registry 不存在的 priority，也不得把等待预算说成物理取消保证。
