# A5 Apple 功能对齐与审稿证据

iPhone / Mac 复用正式 `/personal/v1`：默认 `intent:steer`、显式新任务排队、按原生回执关联队列、取消 / 编辑重排、停止保留后续目标；审批与工具来源摘要在前，原始参数折叠在详情；同名输出保留最新与已读取旧版；归档 / 恢复、确认删除及默认保留 / 可勾遗忘；用量合计 / 日 / 对话 / 模型排行、月度与临时上限。网络与状态放在 Swift 模型 / SDK，呈现使用 AppleTokens 与 design/icons。

同步最新 main 后，FIX-3 契约按客户端时区归入月 / 日，账号上限以最后上报时区的当前月判定；Apple 用量页查询和管理设置也上报本机时区。未知用量与未定价单独显示，不估算费用。

## 可重复验证

构建和 Swift 检查串行运行，所有 xcodebuild 使用 `-jobs 2`。iPhone 使用本包新建的隔离模拟器；任何时刻只启动这一个，测试结束立即 `xcrun simctl shutdown all`，不启动 Watch 模拟器。完整根测试交 PR CI。

```sh
swift test --package-path apps/apple/Packages/WeftMateCore --jobs 2 --filter 'a5|ConversationResourcesTests|SharedConversation|TimelineTests|TaskReadSDKTests|TaskCommandPageSDKTests'
python3 apps/apple/Scripts/run_state_checks.py --artifacts apps/apple/Build/A5-State --core-build apps/apple/Packages/WeftMateCore/.build --check AppleSendStateChecks
xcodebuild -project apps/apple/WeftMate.xcodeproj -scheme WeftMatePhone -configuration Debug -destination 'platform=iOS Simulator,id=<本包隔离 iPhone>' -derivedDataPath apps/apple/Build/A5 -jobs 2 -parallel-testing-enabled NO CODE_SIGN_IDENTITY=- build-for-testing
python3 apps/apple/Tests/run_a5_ui.py --xctestrun apps/apple/Build/A5/Build/Products/WeftMatePhone_iphonesimulator26.2-x86_64.xctestrun --simulator <本包隔离 iPhone> --result <新的 xcresult 路径> --evidence apps/apple/Tests/Evidence/A5 --phase light
python3 apps/apple/Tests/run_a5_ui.py --xctestrun apps/apple/Build/A5/Build/Products/WeftMatePhone_iphonesimulator26.2-x86_64.xctestrun --simulator <本包隔离 iPhone> --result <新的 xcresult 路径> --evidence apps/apple/Tests/Evidence/A5 --phase dark
xcodebuild -project apps/apple/WeftMate.xcodeproj -scheme WeftMateMac -configuration Debug -destination 'platform=macOS' -derivedDataPath apps/apple/Build/A5 -jobs 2 build
```

`python3 apps/apple/Tests/verify_a5_host.py` 可独立重验插话根绑定、顺序排队、202 取消 / 409 竞争、停止保留队列、归档恢复、默认 / 勾选删除与合成工作目录清除。

UI runner 启动真实 `services/cloud/src/main.mjs`、SQLite / file 邮件和 `createPersonalAccessService` 隔离宿主，随机回环端口 / 私有临时目录。App 内完成注册、邮件验证码、PKCE / DPoP、已有设备批准后进入对话。用量来自真实宿主账本，归档与删除调用生产 HTTP 处理器；勾选遗忘时验证宿主确实调用 `delete_evidence`，并核对合成工作目录删除。

发现并修复的实际接线问题：普通 `/sessions` 曾不返回已绑定 `modelProfileId`，Apple 因无法确认原模型而拒绝发送；宿主只补这个既有字段，并加 HTTP 回归断言。任务控制不再绑在无关的 `desktopOpenApp` 能力上；按当前回执选根任务、原生水位推进时刷新元数据，取消事件不隐藏当前停止按钮。原生开始 / 结束也接入发送回执跟踪，插话标签保留在原消息旁。

**运行时边界**：本机没有固定 DSH 的编译产物。`a5_synthetic_backend.mjs` 以合成模型 / inbox 日志提供运行状态，使用生产 `createDshSessionAdapter` 投影和真实宿主审批 / 控制 / 用量 / 会话处理器。UI 验证证明原生请求、界面状态与宿主结果一致；它不证明真实 DSH 引擎、shell 副作用或 MemoWeft Core 持久遗忘已经在本机验收。遗忘接口后的 Core 管理器也是合成夹具，默认删除不调用、勾选删除调用的区别单独断言。不把这个边界写成真实模型 / Core / 生产或真机成功。

## 审稿截图

本包派发时是八场景共 32 张；同步的 DS-2b 已新增 `usage` 与 `session-menu`，因此补齐最新十场景，目标共 40 张。各图按 `review-<平台>-<场景>-<浅深>-<UTC时间>.png` 命名，带同名 JSON，保留实际捕获源码的完整提交、时间、主题与合成来源。

iPhone 图片来自 `XCUIApplication.screenshot()`；Mac 图片来自实际运行的原生 App 自身窗口捕获，Debug 启动参数只选择生产视图 / 外观并捕获本进程窗口。无需辅助功能 / 屏幕录制授权，不截其他应用。登录页为 D29 新登录页。所有截图只使用合成账号与内容，不含密码、验证码、配对材料、私人邮箱或电脑绝对路径。

Watch 浅 / 深审批截图跳过：遵守不启动 Watch 模拟器的限制，不把 Mac 离屏仿制或历史图改标成当次 Watch 证据。真机、生产云 / 中继、真实 DSH / Core 和长期稳定性留实际环境验收。
