# A4b Apple 记忆标签与输出来源面板

macOS / iOS 共用原生 SwiftUI 实现。助手回复的标签只取 CLIENT_API 3.4 的 `assistant.message.data.memoryUsed`，空数组或旧宿主省略字段时不显示；点击列出该回复每条记忆的摘要，可展开当前来源原话。来源读取复用 3.9 的账号权限接口，已忘掉 / 不可读的来源显示提示，不从历史摘要恢复原话。

标题栏「输出与来源」通过 3.16 资源列表按 `nextSeq` 正向分页，合并同一调用的开始 / 完成，优先保留内容快照，同名输出只列最新版本。输出内容 / 来源分组列出；来源先显示使用次数和每次调用的一行描述，再按需读取原始内容，提供截断提示、复制和失败重试。成果卡、步骤来源入口和记忆标签共用同一个面板。

macOS 支持多标签、独立关闭、添加、拖宽、放大 / 还原和整体收起后重开；成果可保存、分享、用默认程序打开和在文件夹中显示。iOS 全屏打开，返回保留对话位置和草稿。切换对话、接通后的宿主会话或账户时，资源窗口按对应身份重新建立，避免跨会话保留标签。Watch UI 未修改。

| 验证 | 结果 |
|---|---|
| 定向 Swift | 20/20：新增记忆字段 / 资源分页 / 使用去重 / 最新同名输出 / 来源路由 / 账户切换 3 项，加原时间线 / 记忆 SDK / 成果下载回归 17 项 |
| 时间线与面板状态 | `AppleTimelineStateChecks`：22,000 条历史尾页、向前 / 向后水位、离线缓存、迟到回调；标签去重、独立关闭、收起重开、末标签关闭和账户隔离 |
| macOS / iOS / watchOS Debug | 三目标通过，Xcode 26.3 / Intel；iOS 26.3.1、watchOS 26.2 模拟器 |
| iOS XCTest | 2/2 通过，合成数据；记忆原话 / 不可读提示、两组资源列表、两次调用 / 按需原文、成果卡共用面板、返回位置与草稿 |
| Mac 界面自动化 | 本机直接检查 `AXIsProcessTrusted=false`；未申请辅助功能权限，未声称 Mac 界面交互验收完成 |

截图来自真实 iOS App 的模拟器 XCTest，合成账号、回环服务与独立 namespace。没有日用数据、真实模型 / MemoWeft 服务、真机 / Watch 配对或生产云验收。原始 xcresult、完整日志、辅助功能树与临时文件仅保留在受忽略 `Build/`。

## 截图

| 场景 | 图片 |
|---|---|
| 每条记忆的简短摘要 | [ios-01-memory-summaries.png](ios-01-memory-summaries.png) |
| 当前来源原话 | [ios-02-memory-original.png](ios-02-memory-original.png) |
| 已忘掉 / 不可读的来源 | [ios-03-memory-unavailable.png](ios-03-memory-unavailable.png) |
| 返回原位置与草稿 | [ios-04-return-position-draft.png](ios-04-return-position-draft.png) |
| 输出内容 / 来源两组 | [ios-05-output-source-list.png](ios-05-output-source-list.png) |
| 去重后的两次调用与逐次摘要 | [ios-06-two-readable-uses.png](ios-06-two-readable-uses.png) |
| 原始内容、截断与复制 | [ios-07-raw-content.png](ios-07-raw-content.png) |
| 成果卡打开共用面板 | [ios-08-artifact-shared-panel.png](ios-08-artifact-shared-panel.png) |

## 复现

在 `apps/apple` 执行，使用已有隔离模拟器。只跑本包相关测试，完整门禁交 PR CI。

```sh
swift test --package-path Packages/WeftMateCore \
  --filter 'ConversationResourcesTests|timeline|MemorySDK'
python3 Scripts/run_state_checks.py --check AppleTimelineStateChecks \
  --artifacts Build/A4b-State --core-build Packages/WeftMateCore/.build
python3 Tests/a4b_fake_server.py --port 18765
```

另一终端：

```sh
xcodebuild -project WeftMate.xcodeproj -scheme WeftMatePhone \
  -configuration Debug -destination "platform=iOS Simulator,id=$PHONE_ID" \
  -derivedDataPath Build/DerivedData -resultBundlePath Build/A4b-UI.xcresult \
  -only-testing:WeftMatePhoneUITests/A4bResourcesUITests \
  -parallel-testing-enabled NO test
make build-mac
make build-phone PHONE_ID="$PHONE_ID"
make build-watch WATCH_ID="$WATCH_ID"
```

Debug 必须同时带 `--ui-testing --a4b-local-server` 才启用本包回环 HTTP 合成登录；Release 不启用。一次模拟器启动曾返回 `NSMachErrorDomain -308 (ipc/mig server died)`，重启现有隔离模拟器后重验，没有重建测试环境或申请新权限。
