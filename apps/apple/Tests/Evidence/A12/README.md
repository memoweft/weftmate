# A12 · Watch 实时审批与 Mac 原生登录项

本包选择 **Mac 本地随机回环端口的隔离个人宿主**。iPhone 通过真实 `/personal/v1/auth/login` 登录合成账号，使用真实个人 HTTP、账号授权、审批持久存储和 `answered → resolved` 回执；Watch 通过一对真正配对的 iPhone / Apple Watch 模拟器使用 WatchConnectivity。没有直接向手表注入审批回执，没有强制 `isReachable=true`，没有共享 Cookie / CSRF / 密码。

任务规划器使用确定性合成执行器，不调用付费模型或编译 DSH。合成步骤必须在读取真实宿主 `allowed-once` 回执后才删除隔离目录里的真实合成草稿，并读回文件不存在；`rejected` 保留文件、结束该步。它证明手机 → 手表 → 手机 → 宿主的原生审批链路及执行门控，不替代真实 DSH / 模型任务、Windows、真机、生产中继与 APNs 验收。

## 证据与判据

最终 Watch 原生 XCTest **1/1**、零失败 / 零跳过，24.971 秒；真实宿主审批 POST 200 **2 笔**，Watch 登记回执 **2 笔**，批准删除 / 拒绝保留文件均实测，完成成功触感 **1 次**。A12 Swift **8/8**、设置回归 **2/2**、TaskInteractionChecks **11/11**。Mac 真实自身窗口操作与 SMAppService 读回 **1/1**，`notFound → enabled → notRegistered`，三张设置原图；临时签名下注册与注销在本机通过，实际系统注销 / 重启登录未执行。

最终实测结果、两条完整宿主回执、Watch 发消息 / 收回执 / 快照 / 触感记录及截图在 `live/`。`approve-pending`、`approve-ended`、`reject-pending`、`reject-ended` 各有 Watch、iPhone 和宿主事件图。宿主图是同阶段真实事件 JSON 的可读渲染，不冒充 Electron 宿主窗口验收。批准必须真实删除文件、拒绝必须保留文件，宿主各收到一笔审批 POST 200；成功触感必须恰好一次，拒绝不播放成功触感。截图 SHA-256 与原生 XCTest 总数见 `live/validation.json`。

[缺陷与失败轮记录](defects.json)保留首次真实回执导致 Swift 6 主线程断言崩溃，以及第二轮拒绝误播成功触感。失败轮原始 xcresult 与截图留在受忽略的 `Build/`；最终验收只统计最后一轮，不把失败算成通过。另一次运行器在状态快照先到、SDK 回执还未返回时过早结束 App，原生 XCTest 通过但回执审计不全；运行器现等待消息通道恢复可用后收尾，未放宽回执或触感判据。

[Swift 单测与持久回执检查](unit-tests.json)覆盖发送载荷、重复点击、不可达、只重试原决定、旧快照、后台回执 / 错误进入 MainActor、旧完成不震动、拒绝 / 失败不震成功，以及 Mac 开关系统读回、外部更改、requiresApproval、注册失败和未确认状态。TaskInteractionChecks 额外核对“已保存但结果不确定”不能向 Watch 回报登记成功；原请求重试沿用既有持久 requestId。

## 设置清单与免费签名

[设置顺查](settings-audit.json)列三项：Mac 开机自启接入 `SMAppService.mainApp`；移除 Mac / iPhone「共享给其他账号 · 即将支持」空按钮；移除没有原生权限 / 投递实现却声称「由系统管理」的通知设置。明确只读的语言、主题色、版本 / 安全、连接和关闭窗口行为保留。没有新增系统权限 entitlement。

Mac 开关不保存乐观布尔值，每次注册、注销、失败及刷新都读系统真实 `status`；`requiresApproval` 显示等待批准与系统登录项入口，失败保留读回状态并显示系统错误域 / 代码。原生验收使用独立测试 bundle ID `com.weftmate.apple.a12loginitem`，结束注销这个测试登录项，避免更改日用 App 的启动项。实际 UI 与系统 API 读回在 `mac-login-item/`。

`SMAppService.mainApp` 管的是**用户下次登录时启动**，不是登录前的系统服务。参见 Apple [mainApp](https://developer.apple.com/documentation/servicemanagement/smappservice/mainapp)、[register](https://developer.apple.com/documentation/servicemanagement/smappservice/register())。系统可要求在「系统设置 → 通用 → 登录项」批准，App 不绕过它。开发包移动、重签或删除后需重新核对系统登录项。

按 D38，本包仅 iPhone / Watch 模拟器与 Mac 本地临时签名 Debug App，没有申请付费开发者计划、APNs、TestFlight或真机签名。Apple 免费 Personal Team 的真机 provisioning profile 会在签发后七天过期（[Apple 官方说明](https://developer.apple.com/help/account/basics/about-your-developer-account)）；本包不把 Mac 本地临时签名系统读回当成免费真机跨七日、换签名安装或实际注销 / 重启登录后的验收。后台远程推送仍未交付，Watch 完成触感只在活动 App / 前台刷新时生效。

## 重跑

新建一对专用 iOS 26.2 iPhone 17 与 watchOS 26.2 Series 11 模拟器，执行 `xcrun simctl pair <watch> <phone>`。串行构建（每条 `-jobs 2`）：

```sh
python3 apps/apple/Scripts/generate_project.py
swift test --package-path apps/apple/Packages/WeftMateCore --jobs 2 --filter a12
python3 apps/apple/Scripts/run_state_checks.py --artifacts apps/apple/Build/A12-State --core-build apps/apple/Packages/WeftMateCore/.build --check TaskInteractionChecks
xcodebuild -project apps/apple/WeftMate.xcodeproj -scheme WeftMatePhone -configuration Debug -destination 'platform=iOS Simulator,id=<phone>' -derivedDataPath apps/apple/Build/A12 -jobs 2 build
xcodebuild -project apps/apple/WeftMate.xcodeproj -scheme WeftMateWatch -configuration Debug -destination 'platform=watchOS Simulator,id=<watch>' -derivedDataPath apps/apple/Build/A12 -jobs 2 build-for-testing
python3 apps/apple/Tests/run_a12_watch.py --phone <phone> --watch <watch> --products apps/apple/Build/A12/Build/Products --xctestrun <生成的WeftMateWatch.xctestrun> --result <新的xcresult路径> --evidence <新的证据目录>
node apps/apple/Tests/a12_capture_host.mjs <上述证据目录>
```

运行器只启动这对模拟器，并在 finally 关闭 App、隔离宿主和所有模拟器。Mac 构建额外指定 `PRODUCT_BUNDLE_IDENTIFIER=com.weftmate.apple.a12loginitem CODE_SIGN_IDENTITY=-`，然后编译 `swiftc -parse-as-library apps/apple/Tests/A5MacCapture.swift -o apps/apple/Build/A12MacCapture`，执行：

```sh
python3 apps/apple/Tests/run_a12_mac.py --app apps/apple/Build/A12/Build/Products/Debug/WeftMateMac.app/Contents/MacOS/WeftMateMac --capture apps/apple/Build/A12MacCapture --evidence <新的Mac证据目录>
```

Mac 捕获器先尝试自身原生 AXPress；此 Xcode 的 SwiftUI switch 未提供该动作时，仅向本 App 自己的 NSWindow 发鼠标按下 / 抬起事件操作真实开关，不用全局输入，不请求 TCC。初始捕获场景标识错误与 AXPress 不支持未计通过；修正捕获器后完整开 / 关重新实测。

最后 `xcrun simctl shutdown all`，解除本包配对并删除本包设备；不要删除他人的设备。最终清理记录见 `cleanup.json`。
