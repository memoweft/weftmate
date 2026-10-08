# DS-1b Apple 设计令牌接入：外观不变

从最新 `main` 的 `28b068d` 建立 `wp/ds-1b-apple-tokens`。三端 Xcode 工程直接编译 `design/tokens/generated/apple/DesignTokens.swift`；A4c 原生调色板、系统语义字号、间距、行间距、圆角、字距、按压参数和既有动效统一由 `design/tokens/tokens.json` 生成。Watch 只替换颜色 / 层级样式引用。

Apple 独有的 A4c 颜色与系统文字样式写入母版 `apple` 分组；共享间距 / 圆角 / 字号 / 时长继续复用 `shared`。动态颜色沿用原有 NSColor / UIColor 提供器和 RGB / 255 转换，字体沿用系统语义字号与 Dynamic Type，动效沿用 180 / 200 ms 的 ease-in-out。没有自定义阴影，系统控件效果继续由系统提供。窗口 / 栏宽、视口断点、图标光学尺寸、比例和业务计时保留布局 / 图标 / 业务语义。完整接线约定见 [令牌说明](../../../../../design/tokens/README.md)。

## 逐张原生截图对比

同一台隔离 iPhone 17 / iOS 26.3.1 模拟器、1206 × 2622 原始截图、系统字号 `large`、固定状态栏 9:41。场景复用 A4a / A4c 本机合成服务，随机 namespace 隔离账户 / 草稿；没有个人消息、真实文件、日用账号或模型调用。改前为 `28b068d` 的原始 UI 源码，改后为本包 UI；深色静置重拍时，临时恢复原始 UI 源码在相同工程与 DerivedData 编译，再恢复本包源码，未调整业务数据或样式取值。

**16 对截图全部为 0 差异像素、0 通道差值。** 比较完整画面，没有遮罩、容差、对齐或缩放，也没有修改截图。机器报告见 [comparison.json](comparison.json)，复现工具见 [compare_design_token_screenshots.swift](../../compare_design_token_screenshots.swift)。

| 场景 | 浅色改前 / 改后 | 深色改前 / 改后 | 差异像素（浅 / 深） |
|---|---|---|---|
| 会话列表 | [改前](before-light-list.png) / [改后](after-light-list.png) | [改前](before-dark-list.png) / [改后](after-dark-list.png) | 0 / 0 |
| 运行中 | [改前](before-light-running.png) / [改后](after-light-running.png) | [改前](before-dark-running.png) / [改后](after-dark-running.png) | 0 / 0 |
| 审批 | [改前](before-light-approval.png) / [改后](after-light-approval.png) | [改前](before-dark-approval.png) / [改后](after-dark-approval.png) | 0 / 0 |
| 输出与来源 | [改前](before-light-outputs-sources.png) / [改后](after-light-outputs-sources.png) | [改前](before-dark-outputs-sources.png) / [改后](after-dark-outputs-sources.png) | 0 / 0 |
| 完成 | [改前](before-light-completed.png) / [改后](after-light-completed.png) | [改前](before-dark-completed.png) / [改后](after-dark-completed.png) | 0 / 0 |
| 来源详情 | [改前](before-light-source.png) / [改后](after-light-source.png) | [改前](before-dark-source.png) / [改后](after-dark-source.png) | 0 / 0 |
| 成果预览 | [改前](before-light-output.png) / [改后](after-light-output.png) | [改前](before-dark-output.png) / [改后](after-dark-output.png) | 0 / 0 |
| 键盘与输入区 | [改前](before-light-keyboard.png) / [改后](after-light-keyboard.png) | [改前](before-dark-keyboard.png) / [改后](after-dark-keyboard.png) | 0 / 0 |

首次拍摄 14/16 对为零差异；深色列表的系统玻璃绘制有 179,522 个像素差异（最大通道差 7），深色键盘的文字编辑标记有 3,534 个像素差异（最大通道差 149）。原图和数值保留在 [initial/](initial/comparison.json)。给 XCTest 截图方法加入 2 秒静置后，用相同方法重拍原始 UI 与本包 UI，深色八对均逐像素一致。断言和场景保持原样；没有通过遮掉区域、修改图片或放宽比较来消除差异。

外观偏好：[深色覆盖](appearance-dark-override.png)、[浅色覆盖](appearance-light-override.png)、[跟随系统](appearance-system.png)。系统为深色时切换浅色即时生效；深色选择重启后保留。

大字号补验（`accessibility-medium`）：[运行中](accessibility-running.png)、[滚动到第五项的模式菜单](accessibility-modes.png)、[审批](accessibility-approval.png)、[键盘安全区](accessibility-keyboard.png)。保留系统字体缩放、模式独立一行、菜单滚动与输入区边界。

## 验证与边界

本机 Xcode 26.3（17C529）、Intel Mac；watchOS 26.2 / Apple Watch Series 11（46 mm）模拟器目标。详细摘要见 [verification.json](verification.json)。

- macOS / iOS / watchOS Debug 构建通过；三个目标均编译同一生成源文件。
- 相关 Swift 单测：`DesignTokenChecks` 24/24（12 个颜色分别在原生浅深外观下与母版 RGB 核对）；`AppleDraftStateChecks` 7/7；`MessageMarkdownChecks` 6/6。隔离数据目录，零外部 HTTP / 模型请求。
- iOS 原生 XCTest：浅色、深色、外观选择保存与跟随系统、大字号共 4/4。列表、执行块、审批三个按钮、资源打开与返回、草稿和键盘安全区均保留原有断言。
- 令牌 Node 检查 3/3；`node scripts/generate-tokens.mjs --check` 通过；令牌与 Xcode 工程重复生成逐字节无变化；桌面 / 手机 Web / Android 生成物没有变化。
- 第一次编译交接文件发现其空的 Swift 字典输出为 `[]`，修复生成器为 `[:]` 后三端通过。原始构建日志、xcresult 与临时原始源码备份保留在受忽略的 `Build/`。
- Mac `AXIsProcessTrusted=false`，没有申请辅助功能权限；Mac 仅声明构建与原生调色板检查。未宣称 Mac GUI 验收。
- Watch 仅构建和颜色引用变更；没有真机、真实 iPhone 连接、审批或触感验收。没有真实宿主 / 模型、跨设备外观同步、部署或发布；客户端 API 契约无变更。
- 完整测试交由 [PR #65 CI](https://github.com/memoweft/weftmate/pull/65/checks)；最终结果以当前提交的 PR checks 为准。

## 复现

仓库根运行：

```sh
node scripts/generate-tokens.mjs
node scripts/generate-tokens.mjs --check
node --test tests/design-tokens.test.ts
python3 apps/apple/Scripts/generate_project.py
```

在 `apps/apple` 启动独立合成服务，再在另一终端执行相关检查：

```sh
python3 Tests/a4a_fake_server.py --port 18764
python3 Tests/a4c_fake_server.py --port 18766

TMPDIR=/private/tmp python3 Scripts/run_state_checks.py \
  --check DesignTokenChecks --check AppleDraftStateChecks \
  --check MessageMarkdownChecks --artifacts Build/DS1b-State
make build-mac
make build-phone
make build-watch
```

使用隔离模拟器的 `PHONE_ID`，按浅 / 深分别选择 `testLightAppearance` / `testDarkAppearance`；外观偏好测试在系统深色下执行，大字号测试先设 `content_size accessibility-medium`，结束恢复 `large`。共享 DerivedData 顺序执行：

```sh
xcrun simctl status_bar "$PHONE_ID" override --time '9:41' \
  --batteryState charged --batteryLevel 100
xcrun simctl ui "$PHONE_ID" appearance dark
xcodebuild -project WeftMate.xcodeproj -scheme WeftMatePhone \
  -configuration Debug -destination "platform=iOS Simulator,id=$PHONE_ID" \
  -derivedDataPath Build/DerivedData -parallel-testing-enabled NO \
  -only-testing:WeftMatePhoneUITests/A4cAppearanceUITests/testDarkAppearance test

swiftc -O Tests/compare_design_token_screenshots.swift -o Build/ds1b-compare
Build/ds1b-compare Tests/Evidence/DS-1b
```

截图是 XCTest 的 `keepAlways` 附件，经 `xcrun xcresulttool export attachments` 导出，仅按场景重命名，没有转换或重绘。结束后停止本包服务、恢复模拟器字号 / 外观并清除状态栏覆盖。
