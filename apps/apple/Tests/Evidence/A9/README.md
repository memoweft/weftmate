# A9 · Apple 详情与进展精修、运行中消息设置

本包对齐 D35 / D36、UI_SPEC 6c 与 UI-P5。账号、对话、文件、命令、模型、日志和审批全部合成。实际运行原生 App 与隔离 cloud main / 个人宿主；合成后端生产确定性 DSH 公开日志，不使用日用数据、付费模型或生产服务。

## 修改

- 步骤详情在功能层解析现有 TimelineDetail：参数显示「路径 / 命令 / 查询等名称：值」，嵌套工具结果只显示正文；错误单列并采用警示色。输出使用等宽字体，默认最多 8 行 / 1200 字符，长输出可展开全文。复制保留完整可读参数 / 输出 / 错误；原始响应保持原样，仅在二级「查看原始数据」中显示并可单独复制。截断数据明确说明，不把无法解析的包装 JSON 当正文。
- 「查看使用的来源」移入每一步的详情，采用 Windows 同一文案与位置，不再悬在组列表上方。
- Mac / iPhone 组进展与等待阶段采用正文同阶 AppleTokens 字号，次要灰字；组箭头紧跟文字，整行可点，保留展开状态和失败默认展开。附件菜单直接由「+」打开，Mac 隐藏系统菜单附加箭头。
- 发送 / 停止共用 PrimaryActionStyle 并显式使用同一主题 tint。深色主题的强调色由 AppleTokens 指定；验证对比两种按钮状态的实际像素，未手改生成令牌或图标。
- 常规登记「回复进行中时发送的消息」：默认「排队」，说明「等当前回复结束后作为下一条处理。」；「引导」，说明「插入当前回复，引导它调整方向。」偏好沿用本设备账户作用域，不增加同步接口；运行中按钮 / 键盘提交读取同一偏好，进入既有 queue / steer 命令路径。空闲发送保持普通下一轮，已提交请求继续复用原体 / 原编号，不被后续设置改变。
- Watch 的对话部分只显示审批与完成提示，移除步骤进度与最近回复；手机不再向 Watch 传回复正文。审批采用与输入区相同的工具 + 对象标题、批准 / 拒绝。H3 独立健康入口保留，未改其数据或计算。触感沿用既有首次历史不提醒、同一完成只提醒一次的状态机。
- 修复进展摘要与详情并发读取时，视图任务取消可能丢弃共享响应、让失败详情一直转圈的问题；共享进行中的读取，结果只缓存于当前执行组模型，不持久化原始输出。

## 对照截图

`before/` 为主干 `9d305928a0b726d4fc0eafa8e688b30f360e918b` 的原生二进制，注入同一 A9 合成场景 / 测试；`after/` 的每张 JSON 记录实际源码提交、UTC 时间、平台、主题及合成声明。PNG 为真实 App 截图，未裁剪、缩放、遮罩或加工；Mac 只捕获本次启动 App 自己的窗口，不读取其他应用。最终逐图索引与颜色采样见本目录验证 JSON。

浅 / 深改前均包含 iPhone 与 Mac 的进展、停止、常规设置、详情 / 错误。iPhone 改后另包含原始数据二级展开、排队 / 引导选择与对应发送；Mac 改后另包含读取 notes.md 的详情及发送按钮。Watch 最后单独启动一个模拟器取一张审批 / 完成图，用完关闭。

## 验证与重跑

Swift 定向 13/13；发送 12 项、审批 11 项、详情共享读取 1 项状态检查全部通过；令牌 4/4、证据 4/4 与令牌生成一致性通过。iPhone 最终浅深 2/2，均零跳过；Mac Debug 与 iOS / Watch 伴随 Debug 构建通过，发送 / 停止浅深四组像素断言通过。本地只跑定向检查，不跑完整单测。完整仓库测试由本 PR 配置的 CI 执行并核对最终提交；当前 PR 的 Node 矩阵仅 Ubuntu，Windows 在合入 main 后运行，macOS 周期 / 手动运行，Apple 原生验证在本机完成。

```sh
python3 apps/apple/Scripts/generate_project.py
swift test --package-path apps/apple/Packages/WeftMateCore --jobs 2 --filter 'A9PolishTests|ConversationFlowTests|watchFeedback'
python3 apps/apple/Scripts/run_state_checks.py --artifacts apps/apple/Build/A9-State --check AppleSendStateChecks --check TaskInteractionChecks --check ToolProgressChecks
node --test tests/design-tokens.test.ts tests/integration/review-capture-evidence.mjs
node scripts/generate-tokens.mjs --check
```

WeftMatePhone 的 Debug build-for-testing 使用一个隔离 iPhone，xcodebuild 为 `-jobs 2`。`run_a5_ui.py --phase a9-after-light / a9-after-dark` 执行 A9PolishUITests，断言可读参数 / 输出、默认不暴露传输元数据、二级原始展开、两种设置实际进入宿主模式、重开设置与 App 重启保持，以及失败默认展开且能读到错误正文。每个最终结果必须 1 成功 / 0 失败 / 0 跳过，完成立即 shutdown all。

Mac Debug 使用 `run_a9_mac.py --phase after` 和 `A5MacCapture.swift`；可重跑的参数为 `--app <本包 Debug 可执行文件> --capture <已编译 A5MacCapture> --evidence <新的证据目录>`。颜色检查使用 `swiftc -O apps/apple/Tests/A9ScreenshotChecks.swift -o <临时程序>`，参数依次为 `design/tokens/tokens.json`、light / dark、对应发送 / 停止截图；按 PNG 自带的颜色空间编码源令牌，要求每张图中至少一个 8×8 方块完全等于该强调色，不改图、不设容差。iPhone 的 PNG 为 sRGB，Mac 自身窗口 PNG 为 Generic RGB；采样 JSON 同时记录源令牌 RGB、PNG 编码 RGB 和颜色空间。

首轮改后浅色发现失败详情读取取消竞态，补受控并发 / 取消检查后修复。另一轮在重启后的系统菜单动画中点击不可点按项，测试改为等待 enabled / hittable，全部行为断言保留。有一次构建在失败测试收尾进程完全退出前短暂重叠，之后以进程退出为串行边界；每次只启动一个模拟器，最终均关闭。

## 边界

无 /personal/v1 契约变更，无新增权限、生产部署、发布包、日用升级或用户数据删除。验证是真实隔离 HTTP、原生呈现与合成执行日志，未宣称真实 DSH 工具执行、付费模型推理或跨设备真机验收。Watch 截图为独立合成快照；真实 iPhone 配对、触感 / 后台推送和审批远端回执另验。

## 截图快速入口

共 49 张 PNG：改前 iPhone 8 / Mac 8；改后 iPhone 20 / Mac 12 / Watch 1。完整索引与 SHA-256 见 [screenshots.json](screenshots.json)，结果见 [validation-focused.json](validation-focused.json)。

| 场景 | iPhone 浅色 | iPhone 深色 | Mac 浅色 | Mac 深色 |
|---|---|---|---|---|
| Detail | [PNG](after/a9-iphone-detail-light-20261009T083623Z.png) | [PNG](after/a9-iphone-detail-dark-20261009T084236Z.png) | [PNG](after/a9-mac-detail-light-20261009T083926Z.png) | [PNG](after/a9-mac-detail-dark-20261009T084042Z.png) |
| Progress | [PNG](after/review-iphone-conversation-light-20261009T083623Z.png) | [PNG](after/review-iphone-conversation-dark-20261009T084236Z.png) | [PNG](after/review-mac-conversation-light-20261009T083844Z.png) | [PNG](after/review-mac-conversation-dark-20261009T084004Z.png) |
| General | [PNG](after/review-iphone-general-light-20261009T083623Z.png) | [PNG](after/review-iphone-general-dark-20261009T084236Z.png) | [PNG](after/review-mac-general-light-20261009T083912Z.png) | [PNG](after/review-mac-general-dark-20261009T084030Z.png) |
| Stop | [PNG](after/review-iphone-composer-context-light-20261009T083623Z.png) | [PNG](after/review-iphone-composer-context-dark-20261009T084236Z.png) | [PNG](after/review-mac-composer-context-light-20261009T083827Z.png) | [PNG](after/review-mac-composer-context-dark-20261009T083951Z.png) |

Watch: [Approval / completion PNG](after/review-watch-approval-dark-20261009T084507Z.png).
