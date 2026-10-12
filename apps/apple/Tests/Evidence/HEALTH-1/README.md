# HEALTH-1：每天的健康汇总

设置 → 常规 → 回顾与洞察 → 健康数据 → 接上，随后在系统授权页选择读取项目并允许。也可在动态的周回顾下点「接上」；点「不用」后此账户在本机不再出现提示。首次启动、登录和打开设置均不申请授权。「已接上」表示本人完成了接入操作，不声称系统已授予每项读取权限；Apple 不公开读取拒绝状态。

## 汇总口径

| 字段 | 口径 |
|---|---|
| steps | HealthKit 原生累计统计，不自行累计不同来源的逐条样本；没有测量为 null，实测零为 0。 |
| sleepMinutes | 只计 asleep 的区间并集；不同来源与连续阶段去重，在床／清醒区间只用于连接整晚阶段而不增加睡眠分钟；归到最终醒来的账户当地日期。 |
| restingHeartRateBpm | 当地自然日静息心率测量的系统平均值，缺测为 null；不读普通心率或曲线。 |
| exerciseMinutes | HealthKit 原生运动分钟累计统计，缺测为 null。 |
| workouts | 按当地自然日交集分配有效运动时长（保留暂停后的实际 duration），同类型汇总为步行／跑步／骑行／游泳／力量训练／其它；无测量为空数组。 |

时间使用电脑通知设置返回的账户时区，日界用 Calendar 加日处理夏令时。睡眠／运动分钟按 DATA-1 上限 1440 分钟送出；不使用固定 86400 秒作为本地日长。最近七天包含今天；今天会被新汇总替换。只有完整 DATA-1 字段离开手机，不发送逐条样本、时间戳、位置、来源设备或心率曲线。

内容与成功回执比较：变更才送，成功后才确认；失败保存待办，下次前台／系统回调再处理，不弹提示或循环网络重试。读取／送出中的前台与观察回调会合并为一次后续处理，不丢触发。关闭立即停止读取与后台注册，保存 unavailable 清除待办，并用 GET 最近摘要发现保留范围内历史健康分区；清除优先于重新开启后的新数据。存储按电脑地址与账户隔离、文件保护、权限 0600、排除系统备份。运行记录只写送出天数、成功／失败及错误类别。

## 可重放的验证

`python3 apps/apple/Scripts/generate_project.py` 后用 `WeftMatePhone` scheme 的 `build-for-testing` 构建；然后逐台运行：

```sh
python3 apps/apple/Tests/run_health1_ui.py --xctestrun <构建产生的 xctestrun> --simulator <一次性 iPhone ID> --theme light --result <隔离 xcresult> --evidence apps/apple/Tests/Evidence/HEALTH-1
# 关掉该模拟器后，换新的隔离模拟器与 --theme dark。
swift test --package-path apps/apple/Packages/WeftMateCore --jobs 2
node apps/apple/Scripts/check_ui_copy.mjs
xcrun simctl shutdown all
```

只有两个独立的测试造数应用含写入代码，作为 UI 测试目标依赖构建，不是 iPhone 正式应用的依赖；不同 bundle 的合成睡眠来源重叠，三天各 480 分钟（不得相加成 720）。正式功能的授权调用 `toShare: []`。夹具复用 APPLE-2 的实际云服务／文件邮件／个人电脑服务及真实认证，均为本机随机端口与新合成账户；合成电脑后端没有真实模型。测试注入一条合成周回顾到实际动态存储，不把它称作真实模型分析；健康 PUT 校验与历史 GET 接收没有替换。503 模拟离线仅影响测试服务的每日摘要与设置接口，不修改系统网络设置。截图为 XCTest 整屏原图，包括系统状态栏，颜色只由 App 参数改变。

## 签名与设备边界

仓库 Base.xcconfig 的 DEVELOPMENT_TEAM 为空，本机没有 Local.xcconfig 或本项目描述文件。generic/platform=iOS 的 Release 实际构建停在 Phone／既有 Watch 缺开发团队的签名错误，没有尝试读取任何真机健康数据。模拟器构建和系统授权不证明免费签名真机已通过。

[Apple 当前能力表](https://developer.apple.com/help/account/reference/supported-capabilities-ios)将 HealthKit 和 Background modes 列为免费 Apple Developer 账户支持；[HealthKit 后台交付](https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:))还要求 background-delivery entitlement，本包只给 iPhone 新建对应配置，不改 Watch 既有配置。代码尝试每小时后台健康交付与系统后台刷新，系统拒绝或不安排时安静退回前台。[Apple 明确说明](https://developer.apple.com/documentation/healthkit/executing-observer-queries)模拟器不支持 HealthKit 后台观察交付；本包以回到前台送出为模拟器保底，不将 API 注册成功当作后台唤醒证据。锁屏／被系统结束后的真实后台唤醒未验收；免费团队的描述文件与真机后台频率须本人之后确认。

Mac 原生端没有健康库，本包不改其健康读取行为，也不改手表代码。Apple Watch 数据由系统进入 iPhone 的健康库。

## 电脑端配合边界

当前 GET /daily-summaries 只显示已生成的完整日摘要，今天先收到的 healthDays 分区及凌晨三点前昨天的数据需等电脑按其规则生成摘要才能出现在 GET。正常送出以 PUT 回执确认，测试以更早的合成日期核对 GET；不改电脑端。

清除覆盖手机记录的送出／待送日期，以及 GET 能列出的历史健康日期。若重装手机丢失本机交付状态、另一个手机只写了今天且尚未生成日摘要，现有 GET 无法列出该日期；需要电脑端将待生成日期的健康汇总提供给客户端，才能扩展这种跨安装清除。本包不增接口。

开发验证发现并修复了夹具直接监听 HTTP data 事件导致流提前流动、实际 readJson 收到空体的竞态；最终用异步迭代器旁路观察，延迟认证回归保留完整请求字节。没有改电脑端、降低健康校验或移除七天清除断言。

完整 Swift 包发现两项 APPLE-2 既有测试问题并修复：信任夹具的 iat／exp 改用同一次取时，准确遵守 120 秒签名期限；401 后按现行契约保留只读身份，并额外断言再次发送仍无命令 POST。没有修改生产认证逻辑、放宽信任期限或删除断言。

## 最终本地结果

- iPhone 浅色／深色主路各 1/1，零失败／零跳过；浅色从设置接入，深色从周回顾接入；默认设置／不自动授权回归 1/1。
- 每种颜色七天首次送出与七天关闭清除共 14 个请求，全部 HTTP 200；内容不变零额外 PUT，三天合成值通过真实 GET 核对，未授予运动分钟读取时为 null。
- Swift 完整包 439/439、24 组；Health-1 固定口径 9 项均在其中，APPLE-2 定向修复 3/3；只读／造数目标／文案／延迟请求流边界 5/5。
- 十张 1206×2622 浅深整屏原图包括还没接上、已接上、系统授权、周回顾提示和关闭后；来源、尺寸、SHA-256、像素颜色验证与 OCR 文案见 manifest／appearance／screenshot-text。运行记录 privacy 文件只包含天数、结果、错误类别（及已有记录序号），没有健康数值。
- 模拟器与测试服务均已退出，正式云端、真实电脑、真机、真实模型与部署均未使用。免费团队真机签名与真实后台交付是独立待验边界。

## PR #243 回调修复复验

系统结果回调改用显式 nonisolated 工厂生成 @Sendable 闭包，样本与统计回调只恢复 continuation，观察者回调不访问界面状态；界面更新在 MainActor 任务内进行。一次观察回调由一个任务的 defer 完成系统交付，错误／关闭／取消等返回路径只有一个完成位置。三处检查入口及工厂的精确函数体、哈希和审核理由见 callback-review.md／callback-review-bodies.json；原检查脚本与旧审核项未修改。

修复后 CRASH-1 59入口／0失败，根目录回调隔离测试5/5，HEALTH-1 边界6/6（含工厂函数体变化检测），Swift 完整包439/439（24组），iPhone 浅深主路2/2均0失败／0跳过。每种颜色仍只有7次送出和7次清除，14个 HTTP 200；仅更新周回顾主／次按钮样式，截图重录，其它界面与健康口径不动。
