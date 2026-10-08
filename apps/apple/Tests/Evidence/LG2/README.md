# LG-2 Apple 登录与设备

本包按 CLIENT_API 7.8 / 7.9 接线。App 内账号页使用 Code + PKCE S256 + DPoP；设备 P-256 密钥优先 Secure Enclave，软件回退与刷新族放 Keychain。注册、验证码、密码票据只存内存。云目录只选择宿主，pin 来自当面二维码或已有可信设备交付；标准 CA / 域名验证后再固定 SPKI。

`lg2_cloud_fixture.mjs` 启动真实 `services/cloud/src/main.mjs` 子进程（file 邮件、随机端口、临时目录）和真实隔离个人宿主。云与宿主后端均为正式实现；宿主的模型/DSH 回调不执行任务，本包只验证账号与内容授权。电脑批准由脚本以云自动绑定的电脑身份调用正式接口。测试邮箱只用 example.com；密码每次在 Node 进程生成，经临时回环测试通道交给 XCTest，不写配置、截图或仓库。模拟器二维码图片经过实际 Apple QR 解码器，不证明真机相机扫描。

UI 与功能分层：`AuthView` / `AccountSettingsView` / `CloudDevicesView` 负责显示与输入；`CloudLoginModel` 负责功能状态；`CloudAccountClient` 负责固定云端网络、独立交互 Cookie、验签与轮换。视图使用 AppleTokens 和 design/icons 生成的 C4 / 图标资源。Watch 不增加登录页，继续跟随 iPhone。

复验命令（串行、最多一个 iPhone 模拟器；不要启动 Watch）：

```sh
swift test --package-path apps/apple/Packages/WeftMateCore --jobs 2 --filter 'AppAccountTests|HostTrustDeliveryTests|Cloud(Auth|Token)'
xcodebuild -project apps/apple/WeftMate.xcodeproj -scheme WeftMateMac -configuration Debug -destination 'platform=macOS' -derivedDataPath apps/apple/Build/LG2 -jobs 2 CODE_SIGNING_ALLOWED=NO build
xcodebuild -project apps/apple/WeftMate.xcodeproj -scheme WeftMatePhone -configuration Debug -destination 'platform=iOS Simulator,id=<独立 iPhone ID>' -derivedDataPath apps/apple/Build/LG2 -jobs 2 -parallel-testing-enabled NO CODE_SIGN_IDENTITY=- build-for-testing
python3 apps/apple/Tests/run_lg2_ui.py --xctestrun <生成的 xctestrun> --simulator <独立 iPhone ID> --result <新 xcresult 路径> --evidence apps/apple/Tests/Evidence/LG2
```

runner 在 UI 测试退出后立即 `simctl shutdown all`，随后导出只有合成账号的指定截图；finally 清临时云/宿主目录。每次复验使用新模拟器或擦除此专用模拟器，不使用日用数据。

已知规格差异：UI_SPEC 6b 要求至少 8 位密码，CLIENT_API 7.1 和当前云 `validPassword` 实际要求 15–128 位。Apple 保留 8 位的客户端初检；服务拒绝短密码时明确展示服务要求。本包不改服务器正式契约，8–14 位可用性需服务器轨道统一。生产云客户端登记、生产中继、真机 Secure Enclave 和相机仍需设备/部署验收。

本地结果：相关 Swift **16/16**（包括参数化回调 / 签名 / key 绑定校验）、两组真实 iPhone XCUITest **2/2，0 失败、0 跳过**；细分见 `validation-account.json` / `validation-lifecycle.json`，汇总见 `validation.json`。两组分别使用全新真实云进程和宿主，正式邮件限速保持；避免把注册、多设备确认、找回与换绑强行挤进同一个限速窗口。前轮真实失败（模拟器签名 / Keychain、provider 恢复 Cookie 路径、列表多按钮联动、长表单反馈 / 键盘）已定位并修复，保留全部行为断言；新增后覆盖已合并 S1e 7.9 的设置项，不留 LG-2b 占位。

截图不包含密码、验证码、配对材料或真实用户信息；等待页取得材料后只显示「已取得电脑配对信息」。默认 XCTest 会将 typeText 输入前缀记入活动，runner 输出脱敏；临时 xcresult 在导出指定截图与汇总后清理，不进 Git。Debug 模拟器通过本地签名访问真正 Keychain，并仅对回环 `127.0.0.1` 放行测试 HTTP；Release 使用另一个 Info.plist，HTTPS / CA / pin 约束保留。依据 [Apple 的 ATS 定点例外文档](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSAppTransportSecurity/NSExceptionDomains)。

完整测试只交 PR CI；真实生产 TLS / 相机和硬件 Enclave 不由本机 HTTP 模拟器流程替代。

Mac 最终 Debug 构建通过，`mac-login.png` 是运行中的实际原生窗口（系统深色）捕获，已目视核对邮箱 / 密码 / 显示 / 登录 / 找回 / 注册。外部截图被系统拒绝；仅在 `--ui-testing --lg2-capture` 下，由 App 打开自己的 Window 菜单项并捕获本进程窗口，通过 stdout 管道交给 `LG2MacCapture.swift`，不申请屏幕录制 / 辅助功能、不读取其他应用窗口。普通启动和 Release 不走取证分支。临时本机状态与此次测试 Keychain 命名空间在 helper 退出时清理。复验先串行编译 `LG2MacCapture.swift`，传入 Debug 可执行文件与 PNG 输出路径。

草稿独立检查 **7/7**：正常退出与重启保留、账号分离 / 旧回调 epoch、最新编辑 flush、保存失败保留旧版本、损坏加载阻断编辑、UTF-8 限制和离线缓存身份。本包复用该保存后清身份的退出路径；检查未发外部 HTTP / 模型请求。
