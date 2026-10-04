# WeftMate Apple 客户端

此目录属于源码快照 `844429c32a866c53145b9a8ba00fc3ca1e653779` 上的 Apple 工作历史。源码 ZIP 没有原仓库 Git 历史；本机后续提交不能称作原提交的 HEAD。

原生 SwiftUI 工程包括 `WeftMateMac`、`WeftMatePhone` 与手机伴随 `WeftMateWatch`，通过本地包 `Packages/WeftMateCore` 共用正式网络接口、模型与账户凭据。macOS 14、iOS 17、watchOS 10 是当前工程最低部署设置；实际构建和运行环境以任务卡记录为准。

## 构建与打开

在本目录执行：

```sh
open WeftMate.xcodeproj
make build-mac
make build-phone
make build-watch
make test-core
make test-mac
make test-phone
```

工程和共享 Scheme 已提交，普通构建不用先生成。添加 Swift 源码后执行 `make project` 同步项目文件；生成器仅使用 Python 标准库，不下载依赖。默认 iPhone 是已安装 iOS 26.3 的 iPhone 17，Watch 是 watchOS 26.2 的 Series 11（46mm）。通过 `PHONE_ID=<UUID>` 和 `WATCH_ID=<UUID>` 指定其他可用模拟器，使用 `xcrun simctl list devices available` 取得 UUID。

`make run-mac`、`make run-phone`、`make run-watch` 构建、安装并启动对应候选。模拟器首次启动需要等待系统初始化；脚本等待实际启动结果。Mac App 只申请沙盒网络客户端权限，真实系统操作按后续正式能力逐项接入。

## 真实服务与凭据

默认服务为 `https://home.weftmate.com:8443/`，网络层沿用 `/personal/v1`。服务器设置采用实际地址；TLS 验证保持系统默认。服务器不可达时应显示失败及恢复入口，不将空列表视为读取成功。

普通 UI 测试验证原生登录入口，真实登录/原会话测试在没有隔离测试账户时明确跳过。执行真实 UI 测试前，由后端或原生注册流程建立测试账户和已有会话，将 `username`、`password` 和可选 `conversationTitle` 写入源码目录之外的私有 JSON，权限设为 600，然后执行：

```sh
python3 Scripts/run_private_ui_test.py \
  --scheme WeftMateMac \
  --destination 'platform=macOS' \
  --credentials /private/path/test-account.json \
  --artifacts /private/path/apple-validation
```

手机测试把 Scheme 改为 `WeftMatePhone`、destination 改为 `platform=iOS Simulator,id=<UUID>`。脚本在私有目录生成 xctestrun 并注入测试环境，密码不会进入源码或命令行。UI 使用 `--ui-testing` 以隔离测试会话启动。测试结果、xctestrun、账号文件均属私有运行材料，不加入源码包。

## 真机安装

需要用户自己的 Apple 开发团队和设备签名。将 `Config/Local.xcconfig.example` 复制为未跟踪的 `Config/Local.xcconfig` 并填写团队 ID，或在 Xcode 的 Signing & Capabilities 选择团队。手机伴随 Watch 的 bundle 标识和依赖已配置；Watch 独立账户、后台通知及实际手表联网验收仍按后续里程碑推进。

当前运行证据、服务接口缺口和本人试用操作统一写在 `docs/tasks/APPLE_CLIENTS_01.md`，本说明不替代实际联调或用户验收。
