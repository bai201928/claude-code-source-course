# M03 实现与实验报告

状态：`implemented`

TypeScript 与 Python 均验证 5 个运行契约：事件循环中的当前栈/调度回调/timer 基本顺序、child stdout/stderr 增量读取、正常退出后再形成结果、外部取消与 timeout 分流且等待进程退出确认、ResourceScope 逆序幂等清理。

运行结果：TypeScript 5/5、Python 5/5，两个 demo 正常。TypeScript 核心实现通过 strict typecheck。Windows 上 Node child 取消表现为 `exitCode:null, signal:SIGTERM`，Python subprocess 返回平台退出码；两版契约比较的是“取消请求先于 exit confirmation”，不强行统一平台 code。

H0 初步裁决为 `merge`：加入保留 reason 的 CancellationScope、幂等 ResourceScope 和可替换 Clock/ProcessPort 契约。真实 tree-kill、POSIX process group 与 Windows Job Object 由平台 adapter 承担，不进入通用领域状态。

证据分类：Claude Code Shell/Bash 生命周期为快照事实；双语言子进程测试为 clean-room 运行验证；H0 与企业资源域为设计迁移。
