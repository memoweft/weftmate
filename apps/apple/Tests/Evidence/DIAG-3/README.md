# DIAG-3 苹果运行记录

三端共享 `WeftMateCore/RunLog.swift`。设置 → 关于 → 运行记录显示本机运行历史；手机同页可切换手表。没有服务器路由、宿主协议或账号权限变化，没有真实模型请求。

[字段、隐私与保留策略](fields.md)。所有示例均通过实际 RunLog actor 从合成运行生成：正常结束、强制结束、注入 MetricKit 投影、Watch 审批失败及手机接收去重。原始 SDK 诊断负载不保存。

- Swift 包最终复验：Swift Testing 426 项 + XCTest 5 项，共 431 项通过；运行记录新增 20 项包含轮转 / 大小清理、全类脱敏、强制结束、后台回收、时钟回拨、磁盘失败、MetricKit 投影、Watch 通道失败 / 重放 / 同秒事件去重。
- macOS Xcode：在本地 package workspace 的 `WeftMateCore-Package` scheme 跑 431 项通过；App 的 build-for-testing 通过。没有尝试 Mac XCUITest automation mode；页面走 App 内现有 AX 运行器。
- iPhone：DIAG3 四项 + 原附件流程一项，5/5 通过。状态截图是 XCUIScreen 的 1206 × 2622 整屏，保留系统状态栏和底部指示条。
- Watch：既有配对的强制结束 / 重启标记测试 1/1 通过；既有配对两端原生 App 的实际诊断传送通过，手机收到了 Watch 的 app.start / app.state，见 paired-transfer.json。
- Node 文案 / 令牌 / 回调测试 14/14；令牌生成检查通过；最终敏感回调精确哈希清单与理由见 `callback-review.md`。

Mac 系统报告开工基线 8 份。初轮构建期间修改共用结构，产物混用两版快照布局，新增 3 份 iPhone SIGSEGV 报告，见 `initial-failed-run.json`；固定源码重建后验证恢复。期间没有新增 Mac / Watch 报告；最终盘点见 `crash-check.json`。不能把整个包说成零新增。既有 Mac 崩溃对话框保持打开，没有更改系统授权 / 自动化 / 安全设置。系统报告目录沙盒不可读时记录 unavailable，绝不记成零报告。

Mac 正常退出先在后台落盘，再通过主 run loop 的 modalPanel / default / eventTracking 模式回复 terminateLater，避免退出等待期间 MainActor Task 无法恢复。iOS 系统终止回调只做 best effort；后台系统回收靠持久标记判断。正常列表使用今天 / 昨天 / 月日和小时分钟；只有主动展开的原始 JSON 预览保留 ISO 时间以便审查将要分享的内容。

性能记录：`performance-before.json` / `performance-after.json` 是修改前后旧窗口捕获流程；最终后测在其它 Mac 场景结束后重跑：启动至窗口捕获中位数 10915.50 → 10376.75 ms，未见变慢；包含固定稳定等待和截图，不是纯首帧。`performance.json` 是同一最终二进制禁用 / 启用日志的五轮控制对比；`iphone-performance.json` 是三轮 XCTest 对比，包含 XCTest 开销。没有纯首帧或真机耗时结论。日志写入、清理及常规退出落盘都在 RunLog actor / detached worker，主线程不做文件 I/O；仅未捕获 Objective-C 异常的紧急路径同步尽力留下固定元数据。

本机日志不备份、不上传、不进仓库。公开目录只有合成样例、原生合成截图与脱敏验证结果；原始构建日志 / xcresult 内的本机路径仅留在受忽略的 Build 或临时目录。更新文案放在 `docs/changelog/apple-run-log.pending.md`，由合并者统一追加当前 JSON 并生成各端资产，本包遵守不修改 src / 安卓 / 手机界面的边界。
