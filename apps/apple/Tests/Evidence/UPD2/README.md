# UPD-2 · Apple 更新口子验收

本包只配置接口与构建口子，没有正式发布源 / 发布身份。iPhone / Mac 关于页显示 App 版本与 build、认证宿主三层版本 / 状态和平台最低版本提示。宿主既有 `/personal/v1/status` 增加只读字段；没有远程安装或重启入口。

Mac 采用任务明确允许的最小方案：验证 UPD-1 JSON 清单的整体 Ed25519 签名，发现新版后打开下载页。Sparkle 2.8.0 的沙盒安装需要 Installer XPC 与 Mach lookup 临时例外权限，而且 delta 失败会退回完整包；本包未引入这些权限 / 安装器 / SPM 依赖。依据与后续条件见 [发布说明](../../../../../scripts/release/README.md)。本次不是 XML appcast、差分下载或安装 / 重启演示。

## 已通过

| 验证 | 结果 |
|---|---|
| Swift `upd2 / a6 / PublicUpdates` 定向测试 | 31/31；其中 UPD-2 10 项，含 SemVer / build 数值比较、最低版本与旧宿主兼容、未配置源、签名篡改 / 错钥 / 无签名拒绝、渠道 / 平台 / 到期 / 链接拒绝、UPD-1 canonical JSON、拒绝不兼容登录、要求回退后恢复操作 |
| Node 发布签名 / 现有清单 / 宿主 core 相关 | 21/21；真实隔离 HTTP 状态接口覆盖认证、实时三层版本、平台最低要求与来源 / 路径 / 安装动作不泄露；发布脚本只从环境路径读取临时私钥 |
| `npm run typecheck`、`git diff --check` | 通过 |
| macOS Debug 构建 | 通过；成品 Info.plist 确认来源和公钥为空、channel 为 `stable`，自定义构建设置实际进入 App |
| iOS Debug 构建及最终源码原生 UI | 2/2，0 跳过；关于页版本 / build、三层版本与 TestFlight / App Store 兼容提示 |
| 真实 Mac App 与本地临时 Ed25519 来源 | 0.1.0/build11 → 检测 0.2.0/build12，显示下载页按钮；篡改已签名 build 后显示签名拒绝且无新版下载按钮；未配置 / 兼容提示均取证 |

Mac 来源由 `Scripts/upd2_fixture.mjs` 在回环临时端口提供。每次启动随机生成私钥，只存在进程内存，从未落盘 / 输出 / 入仓；Swift 使用同一 UPD-1 canonical 格式验证 Node 实际签发的清单。没有提供或下载安装包，没有更新执行代码，没有重启或打断任务。仓库的公钥构建占位为空，正式密钥由 UPD-3 提供。

Mac XCTest runner 在本机不能启用 UI 自动化（`Timed out while enabling automation mode`；Accessibility 未授权），该次未运行 UI 用例。没有请求或新增系统授权；改用 A6 已有的 App 自身窗口捕获。四张 Mac 图来自真实显示的原生设置窗口；Debug 测试调用同一个 `MacUpdateModel.check()` 并记录经过脱敏的检测状态。iPhone 两项从设置菜单进入列表，滚动避开系统搜索栏后打开关于页；最终 2/2 通过，不修改验收断言。

## 截图

| 场景 | 截图 |
|---|---|
| Mac 未配置更新源 / App 与三层版本 | [mac-unconfigured.png](mac-unconfigured.png) |
| Mac v2 验签通过与下载页入口 | [mac-v2-detected.png](mac-v2-detected.png) |
| Mac 签名篡改拒绝 | [mac-signature-rejected.png](mac-signature-rejected.png) |
| Mac 最低原生版本提示 | [mac-compatibility.png](mac-compatibility.png) |
| iPhone App 版本 / build、所连宿主各层版本与更新渠道 | [iphone-versions.png](iphone-versions.png) |
| iPhone 需要更新 / TestFlight / App Store 提示 | [iphone-compatibility.png](iphone-compatibility.png) |

只用合成账号、隔离存储和示例域名。关于页的宿主数据使用现有 Debug 合成 HTTPTransport；真实宿主 HTTP 字段由 Node 相关测试单独验证，不把它宣称为真实 DSH / 生产宿主 / 真机端到端验收。所有 xcodebuild 串行、`-jobs 2`，关闭并行 UI；只启动本包创建的一个 iPhone 模拟器，每轮 UI 后 `xcrun simctl shutdown all`，没有 Watch 模拟器。

## 复现

```sh
cd apps/apple/Packages/WeftMateCore
swift test -j 2 --filter 'upd2|a6|publicUpdate|PublicUpdate'
# 回仓库根目录
TMPDIR=/private/tmp node --test tests/apple-update-release.test.ts tests/update-manifest.test.ts tests/personal-access-core.test.ts
npm run typecheck
node apps/apple/Scripts/upd2_fixture.mjs
```

Mac Debug 构建后：`swiftc -parse-as-library apps/apple/Tests/UPD2MacCapture.swift -o <private-temp>/capture`，再运行该 helper：`capture <built-app>/Contents/MacOS/WeftMateMac <evidence.png>`。配置场景加 `--upd2-feed <fixture-feed> --upd2-public-key <fixture-public-key>`；错误签名场景用来源同端口的 `/bad.json`，最低版本场景加 `--upd2-incompatible`。这些替换必须同时具备 Debug、`--ui-testing` 与回环来源，Release 不含替换入口。

iPhone 使用串行 `xcodebuild -jobs 2 -parallel-testing-enabled NO -collect-test-diagnostics never -only-testing:WeftMatePhoneUITests/UPD2UITests test`，目标指定唯一隔离 iPhone。用 `xcrun xcresulttool export attachments` 导出两项成功用例的附件，结束关闭模拟器。完整结果包和构建日志留在仓库外；公开 `validation.json` 只存摘要、截图哈希与源码摘要。

未验证正式发布、Developer ID 签名 / 公证、Sparkle delta 安装、真实设备或 App Store / TestFlight 发布。PR 交 Claude 审查，不自动合并或部署。
