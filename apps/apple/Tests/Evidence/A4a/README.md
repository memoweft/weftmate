# A4a Apple 审批模式验收

macOS / iOS 共用原生 SwiftUI 控件，客户端只调用 CLIENT_API 3.7 的 `/personal/v1` 接口。合成账号、回环服务和隔离测试 namespace；不执行真实 shell、不读写日用数据、不发送内容或付费。以下截图来自真实 iOS App 的模拟器 XCTest。

| 验证 | 结果 |
|---|---|
| 定向 Swift 测试 | 20/20：原审批/提问回归 13 项、新模式/scope/旧记录/风险摘要/计划 intent 6 项、Watch 反馈 1 项 |
| TaskInteractionChecks | 10/10：分类 scope 在断线和重新打开后保留，重试请求字节与 requestId 不变，旧状态不覆盖 resolved |
| iOS XCTest | 2/2：五种模式、菜单说明/勾选、全部允许风险提示及取消/确认、另一对话隔离、账户默认不覆盖已有对话、重启恢复；三按钮各只 POST 一次，scope / 拒绝不带 scope 正确，风险和处理后一行记录可见 |
| macOS / iOS / watchOS Debug | 三目标构建通过，Xcode 26.3 / Intel Mac；iOS 26.3 与 watchOS 26.2 模拟器 |
| 额外 macOS XCTest | runner 在执行用例前失败：`Timed out while enabling automation mode.`；未申请新权限，不能宣称 Mac 界面交互已验收 |

五种模式按对话由宿主保存；账户默认只影响新对话。菜单数字快捷键仅在 Mac 菜单打开时生效。全部允许确认明确提示删除/覆盖、系统修改、安装、发送/发布和付款可能直接执行且无法撤销。分类授权仅本对话；审批不含风险类别时，「总是允许此类」禁用，允许一次/拒绝仍可用。

`answered` 只表示「决定已登记」，`resolved` 才显示「已允许 / 已拒绝」。接口没有独立撤销字段，因此按风险类别提示可能无法撤销或撤销方式未知，不承诺操作可逆。计划确认支持 M1-2 结构化 intent，仍经信息回答接口，不赋予危险操作权限。

Watch 仍只有允许/拒绝；iPhone 将允许显式编码为 `scope: once`。新审批字段可读取并投影为原 Watch 摘要，不复制宿主凭据；Watch 不重试手机保留的分类授权请求。真实 Watch 配对/触感、真实宿主/DSH/模型/云中继未在本包验收。

## 截图

| 场景 | 图片 |
|---|---|
| 五种模式、说明、当前勾选 | [ios-01-mode-menu.png](ios-01-mode-menu.png) |
| 全部允许的具体风险和明确确认 | [ios-02-allow-all-warning.png](ios-02-allow-all-warning.png) |
| 账户默认模式 | [ios-03-account-default.png](ios-03-account-default.png) |
| 三按钮、风险类别和授权范围 | [ios-04-approval-three-buttons.png](ios-04-approval-three-buttons.png) |
| 删除/覆盖与可能无法撤销提示 | [ios-05-delete-risk.png](ios-05-delete-risk.png) |
| 原位置收起为可读决定记录 | [ios-06-processed-rows.png](ios-06-processed-rows.png) |

## 复现

在 `apps/apple` 下执行，只跑相关测试。选择现有隔离模拟器，将其 ID 填入 `PHONE_ID` / `WATCH_ID`；无需新建环境。XCTest 每项先清空回环合成服务状态，App 使用新的隔离 namespace。

```sh
swift test --package-path Packages/WeftMateCore \
  --filter 'AppleApprovalModeTests|ApprovalQuestionSDKTests|watchFeedback'
python3 Scripts/run_state_checks.py --check TaskInteractionChecks \
  --artifacts Build/A4a-State --core-build Packages/WeftMateCore/.build
python3 Tests/a4a_fake_server.py --port 18764
```

另一个终端：

```sh
xcodebuild -project WeftMate.xcodeproj -scheme WeftMatePhone \
  -configuration Debug -destination "platform=iOS Simulator,id=$PHONE_ID" \
  -derivedDataPath Build/DerivedData -resultBundlePath Build/A4a-UI.xcresult \
  -only-testing:WeftMatePhoneUITests/A4aApprovalUITests \
  -parallel-testing-enabled NO test
make build-mac
make build-phone PHONE_ID="$PHONE_ID"
make build-watch WATCH_ID="$WATCH_ID"
```

Debug 只有同时带 `--ui-testing --a4a-local-server` 才启用本包回环 HTTP 合成登录；Release 不启用。原始 xcresult、测试日志、辅助功能树和本机路径留在受忽略的 `Build/`，只提交合成截图与不含个人信息的验证摘要。完整测试交 PR CI。
