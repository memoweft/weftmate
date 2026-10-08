# H3 设备端健康指标验证（2026-10-08）

本目录只有隔离 iPhone 17 / iOS 26.3.1 模拟器中的合成样本截图与脱敏统计，不含本人健康记录、账号、密码、Cookie、宿主私有存储或原始 HealthKit 样本。H3 在 `wp/h3-health-metrics` 完成；合入 main 的 DS-1b 设计令牌接线保持。

| 验证 | 结果 / 范围 |
|---|---|
| Swift 相关单测 | 22/22：H1 10 项 + H3 12 项。正常、无基线 / 缺数据、夜班、相同绝对时间跨时区、23/25 小时夏令时、重复睡眠阶段、活动排除压力、采样区间、起床部分小时、小睡、查询失败、关闭输入与旧 H1 解码。 |
| H2 宿主相关单测 | 10/10：真实 HTTP、账号隔离、幂等替换、删除围栏、持久化、字段校验、小时范围、云权限不被旧 H1 opt-in 放宽、12 KiB。 |
| watchOS Debug | `WeftMateWatch` 单 scheme、generic watchOS Simulator、`-jobs 2` build 通过，不启动 Watch 模拟器。 |
| iOS Debug | `WeftMatePhone` build-for-testing 通过，包含其 Watch 依赖；串行执行。 |
| iOS XCTest | `testH3HealthKitCalculationUploadAndHealthPage` 1/1，无跳过：实际 HealthKit 授权 → 写入 59 天合成睡眠 / HRV / HR / RHR / 呼吸 / 步数 / 能量 / workout → 设备计算 → 隔离账号注册 → H2 HTTP 上传 → 健康页最新值 / 小时趋势 / 7 与 30 天范围。 |
| 宿主落盘复核 | 自动检查隔离健康文件实际保存 30 个日摘要，均含算法版本，均禁止云读取；每个上传体 ≤12 KiB，最新日五项都有值。合成恢复度70、睡眠480分钟、7/28天负荷比1。详细脱敏计数见 [validation.json](validation.json)。 |
| 图像复核 | 授权、五项最新值、小时轴、7 / 30 天趋势均可读；小时和日期轴显式使用摘要时区。首次截图暴露系统时区轴问题，已修正并以最终版本重新取证。 |

## 截图

- [HealthKit 合成样本授权](h3-healthkit-synthetic-authorization.png)
- [五项最新指标](h3-health-latest.png)
- [电量 / 压力小时趋势](h3-health-hourly-trend.png)
- [7 天趋势](h3-health-7-day-trends.png)
- [30 天趋势](h3-health-30-day-trends.png)

## 复现

只运行相关单测；完整套件由 PR CI 执行。

```sh
swift test --package-path apps/apple/Packages/WeftMateCore --jobs 2 --filter 'h3|health'
TMPDIR=/private/tmp node --test tests/personal-health.test.ts
xcodebuild -project apps/apple/WeftMate.xcodeproj -scheme WeftMateWatch -configuration Debug -destination 'generic/platform=watchOS Simulator' -derivedDataPath apps/apple/Build/H3Watch -jobs 2 build
```

建立一个专用合成数据 iPhone 模拟器（`xcrun simctl create`），以其 ID 依次执行下列命令。不要同时启动 Watch 或其他模拟器；不要并发 xcodebuild。模拟器不需要打开 Simulator.app。

```sh
xcodebuild -project apps/apple/WeftMate.xcodeproj -scheme WeftMatePhone -configuration Debug -destination 'platform=iOS Simulator,id=<专用ID>' -derivedDataPath apps/apple/Build/H3 -jobs 2 build-for-testing
python3 apps/apple/Tests/run_h3_ui.py --xctestrun apps/apple/Build/H3/Build/Products/WeftMatePhone_iphonesimulator26.2-x86_64.xctestrun --simulator <专用ID> --result apps/apple/Build/H3-New.xcresult --evidence apps/apple/Tests/Evidence/H3
xcrun simctl delete <专用ID>
```

xctestrun 文件名取实际 `Build/H3/Build/Products/` 生成值；每次使用新的 result 路径。runner 自动启动真实 personal-access / H2，创建 `/private/tmp` 下的隔离私有目录、注入临时 loopback origin，以禁止并行的 XCTest 运行；完成界面操作后立即 `xcrun simctl shutdown all`，再检查真实落盘及导出截图，最后关闭宿主并删除自己的临时根。HealthKit 写入器仅编译进 Debug iOS 模拟器，真实设备 / Release 不包含写入代码；正常手机和 Watch 仍只请求读取授权。

## 边界

这些结果不代表真实 iPhone / Watch、WatchConnectivity 健康同步、后台每小时保证运行、持续传感器采样、Core delivered、实际 AI 健康建议或生产部署验收。隔离宿主使用真实 H2 存储和 HTTP，后端是无模型的合成空实现，observed 保持 queued。AI 建议、小组件 / 表盘和自评另包。计算是项目明确公式的陪伴估算，参考与差异见 [COMPANION 第 4b 节](../../../../../docs/COMPANION.md)，接口见 [CLIENT_API 第 6.4 节](../../../../../docs/CLIENT_API.md)。
