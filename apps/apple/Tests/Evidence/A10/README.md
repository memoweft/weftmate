# A10 · QA-1 Apple 修复与原生验收自动化

修复 QA1-07、iPhone「关于」遍历失败和 BL-12；Mac 登录后验收新增不需要系统辅助功能授权的完整运行路径。所有账号、邮件、对话、模型、命令、文件和执行日志均为合成。宿主和 cloud main 使用真实代码、随机回环端口和隔离目录；DSH 执行与模型是确定性合成后端。

## 修改与诊断

- **设置摘要**：已归档显示实际数量，零条显示「无」；未知分类返回空摘要，不能再落入应用版本号。顺带修正本地登录时的设备摘要，读取本地设备列表，云登录仍读取云设备列表。独立 Swift 检查覆盖全部 13 个注册分类、三种外观、归档 0 / 1 / 2、本地账号与设备、未知分类；注册表新增分类而未登记摘要会使检查失败。
- **iPhone 关于**：iOS 26 底部悬浮搜索栏可能盖住仍被 XCTest 判为 hittable 的分类行。分类定位改为在列表内部拖动，只点导航栏和搜索栏之间完整可见的行中心，并立即检查目标页面标识。浅深两项均遍历手机全部 11 分类，含已归档数量、「关于」、返回位置保持；保留设备改名、设置搜索和对话用量深链检查。
- **Mac 捕获**：旧工具只检查有无 PNG，未确认登录和目标页面；设置窗口的识别又依赖主窗口固定标题，进入对话后标题实际变成对话名。启动前沿用仓库 Mac AX 验收器的 Debug 二进制预检，拒绝会忽略隔离测试参数的 Release 程序；现在拒绝未登录 / 缺少目标页面的捕获，失败输出明确阶段和已脱敏原因；窗口按本 App 的原生页面标识识别，错误不再统一折叠成 Cocoa 256。
- **无新增权限的 Mac 路径**：Debug 捕获进程启用本 App 自身的 AppKit 自动化数据，遍历自有控件树和窗口；合并 AppKit / SwiftUI 节点时去重，避免重复遍历导致迟滞。SwiftUI 旧 AppKit 桥采用其明确声明的 AXPress 动作，关闭设置和发送都检查实际结果。没有 AXUIElement 远程操作、全局输入、TCC 修改或系统授权请求。设置分类通过现有 settingsRoute 选择，随后核对实际原生页面；发送触发实际原生按钮，再由真实宿主报告核对仅一笔 queue 消息。
- **凭据模式**：A10 默认使用显式的临时凭据存储，只在 Debug + UI 测试 + 捕获 + 本地合成登录 + 字面 HTTP 回环地址同时成立时启用；认证仍调用真实 /personal/v1 接口。正式 Keychain / 登录 / 恢复行为保留。A5 / A9 可加 `--ephemeral-credentials`，A10 可加 `--keychain` 使用现有签名 App 的钥匙串会话。
- **BL-12**：Mac 删除菜单标签内的自定义箭头，保留系统菜单位于模型名后的一个箭头。iPhone「查看使用的来源」「复制」使用既有描边按钮样式与 44pt 点击高度，文字和动作保持原有语义。

原 QA-1 登录页未记录本地自动认证错误，不能从历史 PNG 判定是否是 Keychain 或正式登录缺陷。本轮在当前会话用旧 A9 二进制与新二进制均能正常登录，未复现正式认证错误；修复的是已证实的验收识别 / 诊断缺陷，并提供不依赖 Keychain 交互权限的合成验收路径。新增诊断会在下轮明确区分认证失败与页面 / 捕获失败，不能把登录页冒充主界面。

## 验证

| 验证 | 结果 | 证据 |
|---|---|---|
| Core 设置定向 Swift 测试 | 8 / 8 | validation-focused.json |
| 设置摘要独立 Swift 检查 | 13 分类及状态分支通过 | validation-focused.json |
| iPhone 全设置浅 / 深 | 2 / 2，零失败、零跳过；含归档、关于、改名、搜索、用量深链 | validation-a6-light.json / validation-a6-dark.json |
| iPhone 详情与发送浅 / 深 | 2 / 2，零失败、零跳过；参数 / 输出、描边按钮、二级原始数据、queue / steer 宿主回执、重启保持、失败正文 | validation-a9-after-light.json / validation-a9-after-dark.json |
| Mac 完整浅 / 深 | 2 / 2；每次登录、已加载的主界面、13 设置分类、关闭设置、原生发送、真实宿主恰好一笔 queue 回执、审批条；每主题 16 张自有窗口原图 | mac-light/validation.json / mac-dark/validation.json |
| 旧 A9 运行器 | 浅深 12 场景捕获成功，已增加认证与页面检查 | legacy-a9/ |
| 旧 A5 运行器 | 正常 Keychain 模式进入关于并只捕获设置窗口 | legacy-a5/ |
| 错误二进制 / 未认证捕获反例 | 启动前拒绝错误二进制，未认证时明确失败；均不生成 PNG | validation-negative.json |
| 捕获器行为测试 | Node 4 / 4 | validation-focused.json |

合入最新 main 的 PJ-1 后，Apple 源码保持相同，使用更新后的真实宿主再跑 Mac 浅深完整流程 2/2 和 iPhone 全设置浅色 1/1，均通过；结果见 validation-focused.json 的 postMergeIntegration。

最后同步 FX-9 的云授权会话与宿主认证改动后，再补验 Mac 完整浅色 1/1、iPhone 原生云登录与全部设置浅色 1/1；均通过，见 finalHostIntegration。Apple 源码未变化。

Mac Debug 与 iPhone build-for-testing（含 Watch 伴随 Debug 二进制）构建通过。xcodebuild 使用 -jobs 2，正式构建 / XCTest 串行，一次只开一台 iPhone，测试后立即 shutdown all。未启动 Watch 模拟器。开发中曾在 XCTest 准备阶段启动一个 Mac 增量构建，发现后立即终止，正式验收均在前一个 xcodebuild 退出后继续。

PNG 为原生 App 原图，没有裁剪、缩放或修改；Mac 只读取本次启动进程自己的窗口 ID。截图索引、SHA-256 与源码说明见 screenshots.json / validation-focused.json。截图生成时 commit 字段记录基线提交，A10 工作树修改的最终源码提交及实际测试二进制指纹统一记录在 validation-focused.json。

## 重跑

在仓库根执行。证据 / xcresult 应使用新的目录，避免覆盖本次原图。

```sh
python3 apps/apple/Scripts/generate_project.py
swift test --package-path apps/apple/Packages/WeftMateCore --jobs 2 --filter a6
python3 apps/apple/Scripts/run_state_checks.py --artifacts apps/apple/Build/A10-State --check AppleSettingsSummaryChecks
xcodebuild -project apps/apple/WeftMate.xcodeproj -scheme WeftMateMac -configuration Debug -derivedDataPath apps/apple/Build/A10 -jobs 2 build
swiftc -parse-as-library apps/apple/Tests/A5MacCapture.swift -o apps/apple/Build/A10MacCapture
python3 apps/apple/Tests/run_a10_mac.py --app apps/apple/Build/A10/Build/Products/Debug/WeftMateMac.app/Contents/MacOS/WeftMateMac --capture apps/apple/Build/A10MacCapture --evidence apps/apple/Build/A10-Rerun
```

iPhone 用一个已有隔离模拟器 build-for-testing；然后用 `run_a5_ui.py` 的 `--phase a6-light` / `a6-dark` 执行完整设置，`a9-after-light` / `a9-after-dark` 执行详情 / 发送。参数为 `--xctestrun <构建的 xctestrun> --simulator <隔离 UUID> --result <新 xcresult> --evidence <新目录>`，脚本每次只启动该模拟器，并在 finally 关闭全部模拟器、停止隔离服务和删除本次临时数据。完成后再次执行 `xcrun simctl shutdown all`。

## 关键截图

- Mac [已加载主界面与一个模型箭头](mac-light/main.png)、[关于](mac-light/settings-about.png)、[发送前](mac-light/send-ready.png)、[发送回执后的审批条](mac-light/approval.png)；[深色审批条](mac-dark/approval.png)。
- iPhone 设置首页、归档、关于、详情浅深原图按场景名位于本目录，完整文件名和校验值见 [截图索引](screenshots.json)。

## 边界

无 /personal/v1 契约变化，没有新增系统权限、日用数据操作、发布、部署或自动合并。Mac 的自动登录是隔离本地合成账号路径，不把它称为 Mac 云注册 / 找回或跨签名 Keychain 持久化验收。iPhone 完整设置测试走原生云注册、验证码、配对与设备批准。真实 DSH 工具 / 付费模型、生产中继、真机与 Watch 实时审批 / 触感 / 后台推送均不在本包验收结论中。
