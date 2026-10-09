# A11 · Apple 项目 / 文件夹与执行账号状态

Mac 与 iPhone 接 D37 / PJ-1 的公开项目对象、说明 / 权限、项目内新建对话、项目会话分组和「移至项目」。普通侧栏分组排除项目会话，置顶不把对话移出项目；移动 / 移出 / 移除后的宿主提示在原对话显示。项目路径不进入公开模型或缓存，iPhone 与远程 Mac 不显示路径。颜色、字体、间距与图标沿用 AppleTokens / design/icons。

## 宿主身份与 Mac 文件夹选择

`GET /projects.canManage` 仅表示当前账号拥有管理权限，不能证明连接的是当前 Mac。回环地址也可能由开发转发连接远程 Windows，不能当成本机身份证明。本包要求 **canManage + 已认证 session.hostId 与嵌入宿主传入的可信 localHostID 相同** 才显示新建 / 设置，并通过真实 NSOpenPanel 选择本机文件夹；不匹配或缺少可信身份时采用 Windows 手机端规则，仅显示项目名和对话，说明「在电脑上创建」。正常 Mac 客户端当前没有嵌入宿主身份，始终采用远程模式。

这是现有产品边界：PJ-1 的文件夹检查器目前只支持 Windows，`/personal/v1` 未提供 Mac 本机宿主证明，也没有 Mac 执行宿主。A11 没有扩大到 M3 的 Mac 执行宿主实现。NSOpenPanel 与管理界面、客户端 POST / PATCH / DELETE 已实现；实际 Mac 本机目录登记仍需后续宿主支持。Debug 原生验收显式传合成 localHostID，不把它称为生产 Mac 宿主验收。

新建项目说明 / 权限默认可写，未给新字段的旧项目按只读显示。项目设置保留读取时的 expectedRevision，409 不自动覆盖另一端修改，显示与 Windows 一致的提示；移除确认明确「只移除项目登记，不删除文件夹里的任何文件」，对话保留。

## 回执与受限会话

项目新对话请求先写既有 LocalConversationStore，再提交 `/projects/{id}/sessions`；同一 projectId / 账号 / 宿主下未确认的新建使用原 requestId / 模型，通过 `/commands/by-request/{requestId}` 恢复。超时 / 重启不另建重复会话；发送沿用原命令回执与匹配 receiptId 的会话记录。

FX-9 的 `status.executionAccount:false` 或会话 `taskAvailable:false` 隐藏任务控制、执行审批和审批模式，跳过任务列表 / 详情与执行审批轮询。会话记录与发送回执仍正常读取。缺字段保留旧宿主行为。说明逐字对齐 Windows：「这台电脑已有执行账号。当前账号仅可聊天，不能操作电脑或读取原账号资料；请在电脑退出后登录原账号。」

## 验证方法与边界

`a11_fixture.mjs` 使用随机回环端口、临时目录、合成账号 / 内容；项目 HTTP 认证、CSRF、注册、修订设置、移动、删除与持久存储使用真实宿主代码。Windows 根目录检查在该测试进程内以显式合成适配器替代，DSH / 模型为既有确定性合成后端；受限 session 投影以 `taskAvailable:false` 替代。没有改生产检查器，没有请求真实模型，没有操作日用数据。

Mac 使用 A10 的自动登录、临时凭据、自有 AppKit 控件操作与自有窗口捕获，不申请辅助功能 / 屏幕录制权限。系统 NSOpenPanel 由真实原生按钮打开并取消；系统文件选择服务不向本 App 控件树公开确认按钮，因此验收显式注入隔离合成文件夹的选择回调，再由真实原生创建 / 设置 / 移除按钮操作。该回调替身在报告中单独标记，不将其称为系统选择确认验收。iPhone 使用签名 Debug App 与 XCUITest，一次一台模拟器、xcodebuild -jobs 2、关闭并清理后再跑下一主题。PNG 是原生原图，未裁剪或改图；validation.json 记录 SHA-256。

| 验证 | 结果 | 证据 |
|---|---|---|
| 定向 Swift Core | 13 / 13：8 项项目 / 修订 / 移动 / 受限 / 回执恢复，5 项会话菜单回归 | validation-focused.json |
| 实际 AppleAppModel 状态检查 | 1 / 1；无本地回执 / 模型时仍可读任务，受限会话关闭任务入口 / 停止动作 | validation-focused.json |
| iPhone 浅 / 深 XCUITest | 2 / 2，零失败、零跳过；项目列表 / 折叠 / 新建对话发送 / 移动与提示 / 受限说明与继续聊天；14 图 | iphone-light/validation.json / iphone-dark/validation.json |
| Mac 管理界面浅 / 深 | 2 / 2；真实系统选择框开 / 取消 + 显式合成选择回调，默认名称、原生创建、项目新对话发送、原生子菜单移动、设置 / 权限 / 移除、合成文件与对话保留、受限说明；24 图 | mac-light/validation.json / mac-dark/validation.json |
| 远程 Mac 浅 / 深 | 2 / 2；canManage:true + 回环地址仍不显示本机管理，说明「在电脑上创建」；列表 / 新对话发送 / 原生子菜单移动 / 受限；14 图 | mac-remote-light/validation.json / mac-remote-dark/validation.json |
| 请求记录 | 六轮受限任务 / 执行审批请求均为 0，项目发送各恰好一笔；管理轮 POST / PATCH / DELETE 各一笔，实际创建参数携带项目说明和可写权限 | 各 validation.json |
| 构建与清理 | Mac Debug、iPhone build-for-testing（含 Watch 伴随二进制）通过；xcodebuild 串行 -jobs 2；一台隔离 iPhone、每轮立即 shutdown all，无 Watch 模拟器 | validation-focused.json |

共 52 张原生原图与 SHA-256，六轮使用同一个 UI / Core 源码摘要；各 validation.json 记录实际二进制指纹。开发阶段捕获器在连续点击、系统选择确认、SwiftUI 子控件标识与嵌套 List 更新上失败，均在最终完整流程前处理；失败未计为通过。Mac 项目区最终采用与既有分组一致的独立 Section，折叠 / 添加后项目行不会消失。原生子菜单通过本进程 NSMenu tracking 通知与原菜单 action 操作，不依赖系统辅助功能权限。

代表截图：[Mac 新建](mac-light/project-create.png)、[深色设置](mac-dark/project-settings.png)、[移除确认](mac-light/project-remove.png)、[移除后保留对话](mac-dark/project-removed.png)、[远程 Mac](mac-remote-light/projects-list.png)、[iPhone 深色项目列表](iphone-dark/a11-iphone-projects-list-dark.png)、[iPhone 受限说明](iphone-dark/a11-iphone-restricted-session-dark.png)。

真实 Windows 目录 / DSH / 模型的执行边界已有 [PJ-1](../../../../../tests/evidence/pj-1/README.md) 与 [FX-9](../../../../../tests/evidence/fx-9/README.md) 证据；本包不将合成目录检查或受限投影视作真实跨账号隔离 / Windows 文件执行验收。真机、Watch 实时交互、生产中继、发布与部署另验。

## 重跑

```sh
python3 apps/apple/Scripts/generate_project.py
swift test --package-path apps/apple/Packages/WeftMateCore --jobs 2 --filter 'a11|a7'
python3 apps/apple/Scripts/run_state_checks.py --artifacts apps/apple/Build/A11-State --core-build apps/apple/Packages/WeftMateCore/.build --check AppleTaskEntryChecks
xcodebuild -project apps/apple/WeftMate.xcodeproj -scheme WeftMateMac -configuration Debug -destination platform=macOS -derivedDataPath apps/apple/Build/A11 -jobs 2 build
swiftc -parse-as-library apps/apple/Tests/A5MacCapture.swift -o apps/apple/Build/A11MacCapture
python3 apps/apple/Tests/run_a11.py --platform mac --theme light --app apps/apple/Build/A11/Build/Products/Debug/WeftMateMac.app/Contents/MacOS/WeftMateMac --capture apps/apple/Build/A11MacCapture --evidence apps/apple/Build/A11-Rerun/mac-light
```

Mac 深色改 `--theme dark`，远程身份追加 `--remote`。iPhone 先单独 build-for-testing，再用 `run_a11.py --platform iphone --theme light|dark --xctestrun <生成文件> --simulator <隔离 UUID> --result <新的 xcresult> --evidence <新的目录>`。全部测试后 `xcrun simctl shutdown all`。
