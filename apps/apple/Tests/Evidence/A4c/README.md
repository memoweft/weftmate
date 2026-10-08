# A4c Apple 外观统一

从最新 `main` 的 `b71df5b` 建立 `wp/a4c-apple-visual`。对照 `docs/UI_SPEC.md`、`design/icons/README.md` 与桌面 UI-1 / UI-1b / UI-1c、手机 UI-2、IC-1 截图，使用同一套中性表面、细边框与克制的状态色。C4 品牌和统一功能图标沿用 IC-2 资产，没有修改母版或生成物。

所有新截图来自原生 iOS App 的 XCTest，使用 A4a 与 A4c 本机合成服务和随机隔离 namespace；没有日用账号、个人消息、真实文件、模型调用或付费请求。运行 / 完成场景为合成时间线，审批决定仍由原有 A4a 回归检查。

## 变化

- 浅色以白色与暖灰为主，深色以中性深灰为主；主按钮为高对比实心，其余动作使用细边框。少量绿色用于运行状态，错误沿用红色。
- 助手正文直接排版，用户消息为右侧中性气泡；执行块不再套填色大框。审批与输入区保留轻边框，按钮触摸区域至少 44 pt。
- 输入占位统一为「向 WeftMate 说说你的目标」。去掉常驻本机草稿说明与「模型 ·」前缀；保留模型名称、失败恢复与确需处理的离线状态。
- iPhone 首屏直接展示会话列表；小纬入口留在账户菜单。Mac 保留左侧栏、居中且限宽的对话与按需右侧资源面板，选中对话使用深色实心，移除常驻宿主名称。
- 设置提供浅色 / 深色 / 跟随系统，偏好保存到本设备；设置弹层能立即切换外观。现有 API 没有外观同步接口，本包未新增接口或宣称跨设备同步。
- 修复账户菜单的真实访问性问题：自定义图标包装使 UIKit 菜单标题节点缺失，改为原生 `Label` 消费同一套模板资产。
- Watch 仅调整中性按钮颜色与短文案，原进度 / 审批 / 最近回复结构保留。

## 前后对照

改前截图复制自已合入 `main` 的 IC-2 证据；改后使用同一 A4a 审批及 A4b 资源数据，A4c 另补运行 / 完成步骤与列表状态。

| 场景 | 改前 | 改后 |
|---|---|---|
| 会话列表 | [旧列表](before-light-list.png) | [新列表](light-list.png) |
| 浅色审批 | [蓝色胶囊按钮](before-light-approval.png) | [实心主按钮与描边动作](light-approval.png) |
| 深色审批 | [旧深蓝色](before-dark-approval.png) | [中性深色](dark-approval.png) |
| 完成与输入区 | [常驻草稿说明](before-light-completed.png) | [简洁输入区](light-completed.png) |
| 输出与来源 | [旧资源页](before-light-outputs-sources.png) | [中性资源页](light-outputs-sources.png) |

## 原生截图

| 场景 | 浅色 | 深色 |
|---|---|---|
| 会话列表 / 运行状态点 | [浅色](light-list.png) | [深色](dark-list.png) |
| 运行中 / 用户气泡 / 助手正文 | [浅色](light-running.png) | [深色](dark-running.png) |
| 审批卡 / 三个动作 | [浅色](light-approval.png) | [深色](dark-approval.png) |
| 完成 / 记忆标签 / 收起步骤 | [浅色](light-completed.png) | [深色](dark-completed.png) |
| 输出与来源列表 | [浅色](light-outputs-sources.png) | [深色](dark-outputs-sources.png) |
| 来源摘要 | [浅色](light-source.png) | [深色](dark-source.png) |
| 成果预览 | [浅色](light-output.png) | [深色](dark-output.png) |
| 系统键盘与固定输入区 | [浅色](light-keyboard.png) | [深色](dark-keyboard.png) |

外观切换：[深色覆盖](appearance-dark-override.png)、[浅色覆盖](appearance-light-override.png)、[跟随系统](appearance-system.png)。系统外观为深色时，设置弹层的浅色覆盖仍立即显示浅色；重启后检查深色选择保留。

动态字体与 Watch 证据、最终结果见 [验证报告](verification.json)。

## 验证与边界

本机 Xcode 26.3，Intel Mac；iPhone 17 / iOS 26.3 隔离模拟器、Apple Watch Series 11（46 mm）/ watchOS 26.2。

- 相关 Swift 检查：`AppleDraftStateChecks` 7/7；隔离目录、零外部模型请求。
- 原审批回归：`A4aApprovalUITests/testThreeApprovalButtonsRiskAndHumanResolvedRows` 1/1，允许一次 / 本对话总是允许此类 / 拒绝和处理后摘要。
- iOS 原生截图：浅色、深色、外观选择保留和跟随系统；检查资源页返回后的草稿与键盘安全区。动态字体另以 `accessibility-medium` 运行同一条原生场景，验证输入区按钮没有越出窗口。
- macOS / iOS / watchOS Debug 构建；Mac `AXIsProcessTrusted=false`，没有申请辅助功能授权，Mac 仅声明构建验证与静态布局检查。实际产物位于受忽略的 `Build/DerivedData/Build/Products/Debug/WeftMateMac.app`。
- Watch 合成待审批截图的按钮保持禁用；没有伪造 iPhone 连接、审批成功或触感验收。
- 完整测试交 PR CI；没有本地跑全量。真机、真实宿主 / 模型与跨设备主题同步、生产发布均未在本包验收。客户端 API 契约无变更。

原始构建日志、访问性树、失败轮次和 xcresult 留在受忽略的 `apps/apple/Build/`。提交的文件只包含复核后的合成截图和脱敏验证摘要。

## 复现

在 `apps/apple` 分别启动：

```sh
python3 Tests/a4a_fake_server.py --port 18764
python3 Tests/a4c_fake_server.py --port 18766
```

使用隔离模拟器运行：

```sh
PHONE_ID=4C04FD6C-6F16-4E6D-AF86-69759830D9E8
xcrun simctl ui "$PHONE_ID" appearance light
xcodebuild -project WeftMate.xcodeproj -scheme WeftMatePhone \
  -configuration Debug -destination "platform=iOS Simulator,id=$PHONE_ID" \
  -derivedDataPath Build/DerivedData -parallel-testing-enabled NO \
  -only-testing:WeftMatePhoneUITests/A4cAppearanceUITests/testLightAppearance test
# 深色改为 simctl appearance dark，并只选 testDarkAppearance。
# 外观选择测试只选 testAppearanceChoicePersistsAndFollowsSystem。
# 大字号设 content_size accessibility-medium，并只选 testAccessibilityAppearance；结束恢复 large。
TMPDIR=/private/tmp python3 Scripts/run_state_checks.py \
  --check AppleDraftStateChecks --artifacts Build/A4c-State
make build-mac
make build-phone
make build-watch
```

构建共用 DerivedData 时顺序执行；iOS 与 Watch 的 XCTest 使用各自既有 DerivedData。退出测试服务后恢复模拟器外观与字号。
