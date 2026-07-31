# M20 教学闸门与 Codex 裁决

状态：teaching-reviewed

审查会话：见 teaching-session-id.txt

~~~text
GATE: TEACHING
VERDICT: PASS
MATERIAL_ISSUES: 0
~~~

## 通过理由

独立 Claude Code/DeepSeek Max 教学审查只读取了 2.md、标杆规则和 M20 正文，并确认：

- 正文从一个不可信 tool_use 出发，连续走过 lookup、双层 validation、PreHook、Permission、取消闸门、handler、PostHook 与 paired result，不是函数和文件拼装；
- Tool ABI 与 raw/parsed/observable/call input 的 owner 可以独立重建；
- Hook 的 deny > ask > allow 安全聚合与 updatedInput/reason/source 的完成顺序 provenance 边界被准确分开；
- Hook allow 不会被误写成最高授权，policy、tool rule、requires-interaction 与 safety check 的 owner 清楚；
- rewrite 后没有统一双重再验证的快照弱保证醒目，但没有被夸张成已经证实的漏洞；
- interactive resolve-once 与 headless PermissionRequest Hook/auto-deny 没有混淆，classifier feature gate 也未被错误泛化；
- allow 到副作用的取消窗口能被画出，并与 handler cooperative cancellation 分离；
- preventContinuation、PostHook stop、rollback 与 compensation 保持不同时间语义；
- paired result 的进程内协议保证没有偷换成外部副作用 exactly-once；
- Permission 与 Sandbox 是正交边界，完整 isolation 留给 M25；
- H4-1 具有预测、运行、反证、破坏和修复闭环，且 clean-room 强保证未倒灌成 Claude Code 事实；
- Spring ports、LangGraph state channels、policy/execution plane 与 finalizer 从 owner 和 revision 自然推出；
- 8 道资深 Agent 岗面试题均结论先行，能在两分钟内承接源码、失败边界与系统设计。

## Codex 裁决

无实质 Issue，不需要教学复审。

审查者保留三个非阻断观察：Promise race 初学者可能需要回顾 M15；动手任务较多但已明确另计；quadrantChart 依赖 Mermaid 渲染器。前两项不修改正文，第三项通过实际 Mermaid CLI 渲染验证处理。
