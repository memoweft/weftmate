# HEALTH-1 回调隔离修复

CRASH-1 的三个新增入口逐体核对后才登记；检查脚本与原有允许项未修改。当前 Swift 不支持在闭包字面量直接写 nonisolated，因此用显式 nonisolated 工厂返回 @Sendable 回调，避免继承周围模型的 MainActor。工厂精确源码和 SHA-256 见 callback-review-bodies.json。

| 入口 | 逐体核对 |
|---|---|
| DailyHealthModel.observe | 注册在 MainActor，回调由 nonisolated makeObserverUpdate 生成；回调只将弱模型引用交给 Task @MainActor，在该任务里才读取 enabled 并调用 activate，且等待任务完成。无主线程隔离属性在回调本体直接访问。 |
| DailyHealthReader.HKSampleQuery | 查询注册在 MainActor，结果回调由 nonisolated samples 工厂生成且明确 @Sendable；只捕获 checked continuation，错误／结果互斥恢复，无 self/store/UI 访问。 |
| DailyHealthReader.observe | 观察者数组与 store 操作留在 MainActor；SDK 回调由 nonisolated observer 工厂生成且明确 @Sendable，只提取 error 是否为空并创建不可变完成回调 owner；一个任务一个 defer 完成位置，错误、关闭、取消等更新返回路径均只调用一次。回调不读 UI 属性；UI 变化由上层显式 MainActor 任务负责。 |
| HKStatisticsQuery 同类回调 | 同时改由 nonisolated statistic 工厂生成 @Sendable 回调，只捕获 checked continuation、不可变 HKUnit／options；使用框架结果或错误恢复，不访问模型。Swift complete concurrency 构建通过。 |

周回顾接上使用现有 PrimaryActionStyle(fillsWidth:false)，不用使用 OutlineActionStyle，保留44pt触控目标和原文案／标识；其它界面不动。

额外边界测试比较回调工厂的规范化精确源码与审核快照／SHA-256，兼容 Windows CRLF；工厂函数体变化必须重新审核，不能只沿用注册调用处的允许项。
