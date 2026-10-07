# S1c Apple 云账号与内容设备验收

开发只跑相关测试；三目标构建与 CI 结果在 STATE/PR 中记录。

```sh
# 在仓库根目录（Node 24），依赖缺失时仅在 services/cloud npm ci --ignore-scripts
swift test --package-path apps/apple/Packages/WeftMateCore --filter 'Cloud(Auth|Token)Tests'
node apps/apple/Tests/s1c_cloud_fixture.mjs
# 第二个终端：实际 cloud main + SQLite + file mail + 隔离宿主，另有隔离 TLS fixture
WEFTMATE_S1C_LIVE=1 swift test --package-path apps/apple/Packages/WeftMateCore --filter 'Cloud(Live|TLS)Tests'
xcodebuild -project apps/apple/WeftMate.xcodeproj -scheme WeftMatePhone \
  -destination 'platform=iOS Simulator,id=<当前可用隔离模拟器>' \
  -derivedDataPath apps/apple/Build/DerivedData \
  -only-testing:WeftMatePhoneUITests/S1cCloudUITests test
python3 apps/apple/Scripts/run_state_checks.py --artifacts apps/apple/Build/S1cState \
  --check AppleContractStateChecks
```

fixture 使用 `/tmp/wm-s1c-apple-*` 私有目录、example.com 测试邮箱、合成密码；退出时关闭宿主/云子进程，不接触日用数据或系统 CA。ready JSON/数据库/Keychain/二维码挑战/XCTest 原始包不提交。默认 driver 回环 18765，TLS 回环 18766/18767；若被占用先结束本包遗留 fixture，不重建环境。运行结束 Ctrl-C。Live suite 与 iOS suite 分别启动一个新 fixture，避免重复运行共用测试账号触发服务本来已有的邮件退避；不要同时运行它们。

浏览器驱动自动走现有 7.1 JSON 交互与 file outbox（注册、验证码、新云设备确认、原生公钥登记），返回原授权码 callback；Swift 执行真实 PKCE、JWKS/ID token 验签、refresh 轮换、DPoP 与宿主交换。iOS 用 CoreImage 生成标准桌面 URL QR PNG、Vision/CoreImage 解码注入；第三条 XCTest 用真实 ASWebAuthenticationSession、云 HTML 公钥隐藏字段、邮箱/密码/邮件验证码、原回调返回应用到达 pending；前两条测试验证 pending 不显示对话、另一本地会话批准后重试进入对话，以及一次性 pairing redeem。二维码测试走显式 Debug/UI testing 的直连回环宿主，不声称经过生产中继。Release 不编入浏览器驱动、QR URL 注入或测试 CA anchor。

TLS fixture 使用实际宿主生成的 P-256 内容 key，测试 CA 只传给测试 URLSession，不修改系统信任：正确 pin 接受；错误 pin、同域同 CA 的其他 key、错误域名、不受信 CA 拒绝。Swift 状态测试另验坏 state/重复 code、PKCE S256、nonce/issuer/audience/expiry/未知 kid 拒绝、DPoP 重试新 proof、pending 无内容凭据、owner/host 核对、refresh 持久恢复、允许/拒绝 Cookie/CSRF。

**生产缺口**：S1c-Web 7.7 已补原生 deviceId/JWK bootstrap，Apple 授权 URL 已接入；云仍没有注册/找回浏览器页，S2 discover 不提供账号宿主枚举，已有设备批准没有原生可信 pin 转交接口。首次不提供配对材料的云登录仍需云轨道补这些能力。本包仅改 Apple/docs，没有伪造这些接口，也不信云目录替换宿主 pin。模拟器系统认证浏览器已验；真机 Secure Enclave、相机、生产部署与中继未验。
