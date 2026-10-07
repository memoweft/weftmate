# A3 Apple 时间线验收

2026-10-07，隔离 iPhone 17 / iOS 26.3 模拟器。图片全部来自合成会话，不含日用账号、个人路径、邮箱、局域网地址或真实模型输出。

| 验证 | 结果 |
|---|---|
| Swift 包测试 | 260 项通过 |
| `make test-state` | 11 组全部通过，含实际 AppleAppModel 的尾页、before/after 水位、迟到响应、离线尾页/上翻检查，以及审批轮询期间的可回应状态 |
| macOS / iOS / watchOS `xcodebuild` | 三目标 Debug 构建通过 |
| iOS XCTest | A3 完整时间线场景及 A2 附件回归，2/2 通过 |
| 长会话 | 22,000 条合成旧记录；打开尾页，`beforeSeq=21906` 上翻；没有 `afterSeq=-1` 请求；上翻前后同一文字记录的 y 位置差约 32pt（断言容差 48pt） |
| 原始步骤详情 | 展开第二层后才 GET `/events/22004/detail`；收起/展开可复制 |
| 审批 / 提问 | 允许一次、选择回答并提交；各一次 POST；原生解决事件更新原位置 |
| 成果 | 完整 UTF-8 文件大小/SHA-256 校验后全屏预览；保存/分享入口可见 |
| Mac GUI | `AXIsProcessTrusted()` 返回 false；未请求授权或修改 TCC。Mac AX 脚本仅静态类型检查通过 |
| Watch | 三目标构建及完成/审批去重触感投影单测通过；未验收真实 iPhone–Watch 配对或触感硬件 |

HTTP 请求摘要见 [verification.json](verification.json)。测试结果包和完整日志保留在受忽略的 `Build/`，不提交包含本机路径的 xcresult 或原始日志。

## 截图

| 场景 | 图片 |
|---|---|
| 长会话尾页，iPhone 步骤默认收起 | [01-tail-collapsed.png](01-tail-collapsed.png) |
| 执行块及原始命令/输出展开 | [02-execution-detail.png](02-execution-detail.png) |
| 对话内审批 | [03-approval.png](03-approval.png) |
| 提问与选项 | [04-question.png](04-question.png) |
| 完成后收起摘要、成果卡 | [05-completed-artifact.png](05-completed-artifact.png) |
| 成果全屏预览、保存和分享 | [06-artifact-preview.png](06-artifact-preview.png) |
| 上翻更早的 21806–21816 记录，输入区保持底部 | [07-older-page.png](07-older-page.png) |

## 复现

从 `apps/apple` 执行。先用 `xcrun simctl list devices available` 选择隔离的 iOS 模拟器并设置 `PHONE_ID`；另开终端运行仅监听回环的假服务。每次重跑先重启假服务以清空合成审批/回答状态。测试 namespace 每次自动生成，不读日用 Keychain 或存储。

```sh
swift test --package-path Packages/WeftMateCore
make test-state
python3 Tests/a3_fake_server.py --port 18763
```

另一终端：

```sh
xcodebuild -project WeftMate.xcodeproj -scheme WeftMatePhone \
  -configuration Debug -destination "platform=iOS Simulator,id=$PHONE_ID" \
  -derivedDataPath Build/A3 -resultBundlePath Build/A3-UI.xcresult \
  -only-testing:WeftMatePhoneUITests/A3TimelineUITests \
  -only-testing:WeftMatePhoneUITests/WeftMateUITests/testA2AttachmentHistoryComposerAndPreview \
  -parallel-testing-enabled NO test
```

合成服务只实现本场景需要的 `/personal/v1`，不代表真实 DSH、宿主、云中继或模型验收。Debug 的回环 HTTP 只在同时传入 `--ui-testing --a3-local-server` 时使用；Release 仍要求 HTTPS。

Watch 通过 iPhone WatchConnectivity 取摘要/登记审批，宿主 Cookie/CSRF 不传到手表。手机 App 可达时才可审批；推送尚未接通，仅 Watch 前台/刷新观察到新完成时触感提醒，首次读取旧完成记录不震动；后台收到的完成在下一次前台刷新提醒，旧快照不会重复震动。「总是允许此类」、排队取消和 D9 插话调度等待后续服务端契约。
