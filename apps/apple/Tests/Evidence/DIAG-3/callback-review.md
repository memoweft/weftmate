# DIAG-3 回调隔离自查

静态 CRASH-1 清单覆盖 56 个匹配入口；新增或修改的 WC 回调与 detached 闭包均已逐体核对，允许表保留精确哈希和理由。

- Phone WC 回调为 nonisolated，只先读取 Data / String 值；reply closure 用 Sendable owner 封装，显式 Task @MainActor 更新界面。日志写入等待 RunLog actor 完成后才回复 accepted。
- Watch WC delegate 为 nonisolated，拷贝可发送的 bool / Data 后显式进入 MainActor。审批沿用 WatchMessageDelivery 的 actor 交付。日志发送的 SDK reply / error 回调只捕获 Sendable checked continuation，返回 boolean；不访问 Watch UI。
- MetricKit subscriber 是无 UI 状态的 NSObject，didReceive 为 nonisolated。先同步提取类型、数字字段、日期和 Data，再把 Sendable 值交给 RunLog actor；原始 SDK payload 不跨到 UI，不写入文件。
- NSSetUncaughtExceptionHandler 是 C 回调，只调用 nonisolated、带锁的 emergency sink；不访问 UI、exception reason、userInfo 或原始栈。Swift fatalError 不宣称可捕获。
- Mac NSApplicationDelegate 按 AppKit 的 MainActor 契约运行；退出落盘在 RunLog actor，完成后在 Main run loop 的 modalPanel / default / eventTracking 模式回复；该回调由 Main run loop 保证主线程。目录盘点在 detached utility task，不读取报告正文、不访问 UI。
- 文件预览 detached 闭包只捕获 URL，返回 Data，MainActor await 后才设置预览及分享状态。
- 生命周期与设置/诊断按钮使用 SwiftUI 的既有 main-actor 交付方式；没有 GeometryReader、偏好回调或自定义 Shape / Layout。

初轮构建期间修改共用结构导致混合产物风险，模拟器实际新增 3 份 iPhone 报告；失败证据保留。最终验证须在固定源码重建的产物上完成，后续新增数量另算，不能把整个工作包称为新增 0。
