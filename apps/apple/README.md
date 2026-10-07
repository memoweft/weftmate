# WeftMate Apple 客户端

此目录是 WeftMate 主仓的 Apple 客户端。A0 已将旧独立工作副本截至 `278bc6c` 的 Apple 成果合入主仓；后续开发直接在主仓工作，旧任务卡不作为开工入口。

原生 SwiftUI 工程包括 `WeftMateMac`、`WeftMatePhone` 与手机伴随 `WeftMateWatch`，通过本地包 `Packages/WeftMateCore` 共用 `/personal/v1` 网络接口、模型与凭据存储实现。macOS 14、iOS 17、watchOS 10 是当前工程最低部署设置；当前源码版本为 `0.1.0 / build 11`。

Mac/iPhone 已包含对话附件上传、历史附件预览/保存、明确确认不确定本地消息后接管、账户与原会话读取、按账户保存草稿和离线缓存、明确选择模型后续聊、记忆页面、对话内执行时间线、来源/停止、审批与信息问答，以及 UTF-8 文本成果预览/保存/分享。Watch 通过 iPhone 原生连接显示当前进度、审批与最近回复，前台/刷新观察到任务完成时触感反馈；远程推送与真机配对验证尚未完成。源码接入和离线测试通过不等于真实后端或设备验收。

## 构建与打开

在本目录执行：

```sh
open WeftMate.xcodeproj
make build-mac
make build-phone
make build-watch
make test-core
make test-state
make test-mac
make test-phone
```

工程和共享 Scheme 已提交，普通构建不用先生成。添加 Swift 源码后执行 `make project` 同步项目文件；生成器仅使用 Python 标准库，不下载依赖。默认 iPhone 是已安装 iOS 26.3 的 iPhone 17，Watch 是 watchOS 26.2 的 Series 11（46mm）。通过 `PHONE_ID=<UUID>` 和 `WATCH_ID=<UUID>` 指定其他可用模拟器，使用 `xcrun simctl list devices available` 取得 UUID。

`make test-core` 执行共享包 Swift 单元测试；`make test-state` 编译并运行 `Tests/*Checks.swift` 的十一组状态检查，使用合成账户、受控 HTTP 和独立临时目录，不访问日用数据、后端或系统钥匙串。每次的编译/执行日志与 `results.json` 保存到受忽略的 `Build/StateChecks/apple-state-*`。需要源码外的证据目录时运行 `python3 Scripts/run_state_checks.py --artifacts <目录>`；`--core-build <隔离的 SwiftPM scratch 目录>` 可复用已构建的核心对象。`make test-mac` / `make test-phone` 属于 UI 验证，真实服务用例另需隔离 fixture。

`make run-mac`、`make run-phone`、`make run-watch` 构建、安装并启动对应候选。模拟器首次启动需要等待系统初始化；脚本等待实际启动结果。Mac App 使用沙盒网络客户端权限，以及用户在系统文件窗口选定位置的读写权限，用于保存已校验的成果。真实系统操作按后续正式能力逐项接入。

## A3 对话时间线

打开会话只读最近 100 条公开事件；滚到顶部或点击「读取更早的记录」使用 `beforeSeq`。实时增量使用独立的 `afterSeq` 水位，空页也推进水位，上翻响应不改变它。无从 -1 全量扫描、20,000 条上限或 historyLimit 错误。原同步记录与 DSH 事件保留各自 seq 空间，已接管的同步消息按回执去重。

macOS 运行块默认展开，iPhone 步骤默认收起；完成后自动收成步骤数/用时摘要。步骤第二层展开才请求原始命令/输出，可复制。审批和提问沿用持久请求与原生消费确认，卡片在开始位置更新；提问按 turn 和 observedSeq 关联最新一次调用。成果核对账号/会话绑定及完整大小/SHA-256 后打开桌面侧面板或手机全屏，可保存和分享；当前服务端成果仍限 128 KiB UTF-8 文本。停止和来源位于对应用户消息下，不再有独立任务页面；停止登记与实际停止状态分开显示。缺少步骤开始时间时显示待确认，支持带毫秒的 RFC3339 时间戳。

事件缓存按账号、宿主和会话隔离，仅保存公开投影，不缓存原始工具输出。离线重开只展示缓存尾页，再向上翻已访问的分页；未访问的历史须联网读取。旧文字缓存仍可显示尾部记录，不能恢复缺失的执行详情或提供离线审批。

Watch 不传宿主 Cookie/CSRF：通过 WatchConnectivity 向 iPhone 请求公开摘要，手机用既有审批接口和持久提交记录登记决定。前台/刷新时核对活动会话，手机 App 可达时才能审批；尚无远程推送，触感只在 Watch 前台或刷新时生效，首次读取旧完成记录不震动；后台收到的完成在下一次前台刷新提醒，旧快照不会重复震动。跨设备真机配对仍待验证。

合成 iOS XCTest、截图与可复现命令见 [A3 验证证据](Tests/Evidence/A3/README.md)。Mac 当前辅助功能检查未授权，未请求授权或修改 TCC。

## A2 发送与附件

消息按 8,192 个 UTF-16 单元和实际编码 JSON 的 12 KiB 上限检查；记忆纠正按 4,000 UTF-16 / 12 KiB JSON 检查。超限提示在输入区，草稿保留，不提交必然失败的请求。设备名按 UTF-16 计数。接管遇到 `LOCAL_TURN_UNCONFIRMED` 时，只有用户点击「确认并继续」才登记并发送带 `acknowledgeUncertainLocalTurn:true` 的原请求；普通接管不发送该字段。

输入区「+」可选文件/图片或系统照片，最多 4 个；Mac 支持拖入文件和菜单粘贴图片/文件。原件沿用服务端单个 1 GiB 上限，上传/下载通过文件传输，不把大文件全量放入 JSON 或内存。图片生成 JPEG 显示版；服务端支持的图片/文本按 5 MiB 图片、16 KiB 合计文本、10 MiB 合计输入准备模型内容，其余格式仍保留原件。上传失败后所选文件保留；相同发送尝试使用原附件 ID、messageId、requestId。上传回执丢失后修改文字或增减文件时，保留原件的 messageId 绑定，为新命令使用新的 requestId。附件引用在上传完成后写入可重放的发送请求，允许仅发附件。尚未发送的文件选择只保留在当前 app 会话，重启/离线持久化属于后续工作。

历史附件点开后，Mac 在右侧面板、iPhone 在全屏页预览，可保存或分享原文件。原件核对大小及 SHA-256；旧历史图片通过会话图片接口读取。图片在预览区直接显示；文本预览至多 128 KiB，其余格式使用系统 Quick Look，保存原件仍保留完整内容。预览支持不代表模型可读取任意格式。同步历史可读取/缓存 8 个附件，发送命令仍最多 4 个。

当前 `/sessions` 不返回 `origin`。A2 结合 `/status` 中仅宿主所有者可用的 `desktopOpenApp.available` 和实时 `sendAvailable` 确认 personal-remote 对话内任务控制范围；shared-chat 没有该桌面能力，不请求 `/tasks`。服务不可用或权限范围无法确认时隐藏来源与停止控制；是否支持任务控制仍与能否续聊分别判断。

离线界面验收可只运行 `WeftMateUITests/testA2AttachmentHistoryComposerAndPreview`。该测试使用双重 Debug 开关 `--ui-testing --apple-contract-fixture`、内存凭据与专用测试 namespace，不走 URLSession，也不连接默认服务；截图保存在 XCTest 结果包内。该夹具自动登录内存测试账号，跳过系统密码保存及键盘焦点环节，只验证附件界面。

Mac XCTest 初始化不成功时，已有辅助功能授权的宿主可运行 `swift Scripts/run_mac_ax_test.swift --a2-synthetic --debug-app <Debug app> --artifacts <新证据目录>` 完成同一隔离流程；没有授权时会退出，不申请权限。

## Mac 检查更新

Mac 标准 App 菜单的“检查更新…”在登录前即可打开独立更新窗口；登录后的设置页进入同一窗口。检查读取官网公开版本清单，与个人服务器和登录状态独立，按真实安装版本、构建号和运行架构判断。读取失败或暂无匹配包时保留真实说明。

有新版时，“下载新版 DMG”在浏览器打开已校验的官网安装包地址；其他设备从官网页面查看对应安装入口。下载后由本人手动安装，不自动覆盖、卸载或清除资料。官网发布与本机临时签名、公证和跨版本 Keychain 保留是不同验证项；本机试用包未公证，跨签名升级保留尚需实际验证。

## 云账号与新设备授权（S1c-Apple）

登录页和账号菜单新增「用 WeftMate 账号登录」，保留用户名/密码直连电脑。系统认证浏览器用 Code + PKCE S256，设备 P-256 优先 Secure Enclave，软件后备和刷新令牌均在 ThisDeviceOnly Keychain。未批准设备显示等待、重试/取消；已登录前台提示待批准设备并允许/拒绝。iPhone 支持相机与图片二维码，Mac 使用另一设备批准或粘贴电脑配对信息。配对固定宿主 SPKI，云目录只提供路由，HTTPS 仍校验 CA/域名。

此版本的原生协议接线已经实现；已接 S1c-Web 7.7 公钥 bootstrap、标准二维码 URL 与 wm1 复制码；云注册/找回页面、宿主枚举与已批准设备的可信 pin 转交仍缺。首次无配对材料的云登录尚不能端到端使用。运行、隔离测试与这些依赖见 [S1c 验收说明](Tests/S1c-README.md)。Watch 沿用既有手机桥接。

## 真实服务与凭据

默认服务为 `https://home.weftmate.com:8443/`，网络层沿用 `/personal/v1`。服务器设置采用实际地址；TLS 验证保持系统默认。服务器不可达时应显示失败及恢复入口，不将空列表视为读取成功。

普通 UI 测试验证原生登录入口，真实登录/原会话测试在没有隔离测试账户和原消息时明确跳过。真实 UI 测试直接采用共享包 `AppleAcceptance` 生成的私有 JSON：必需 `server`、`username`、`password`、`conversationID`、`marker`，可选 `conversationTitle`。账户与原消息由隔离联调流程建立，不触发模型或工具请求。文件保存在源码目录之外，权限为 600，私有证据目录为 700，然后执行：

```sh
python3 Scripts/run_private_ui_test.py \
  --scheme WeftMateMac \
  --destination 'platform=macOS' \
  --credentials /private/path/test-account.json \
  --artifacts /private/path/apple-validation
```

手机测试把 Scheme 改为 `WeftMatePhone`、destination 改为 `platform=iOS Simulator,id=<UUID>`。脚本为每次运行建立独立证据目录，生成权限 600 的 xctestrun 并注入测试环境；密码不会进入源码或命令行，控制台及文本日志会隐藏密码。UI 使用 `--ui-testing` 和独立 `--ui-testing-namespace`；同一用例重启复用此 namespace，验证 Keychain 恢复及服务器设备 ID 保持。用例核对原会话 ID、标题、原消息正文、当前设备、重启恢复和退出；存在 `<credentials路径>.second-account.json` 时，再执行 A→B→A 的账户隔离。缺少第二账户时只记录该扩展未执行。测试结果、xctestrun、账号文件均属私有运行材料，不加入源码包。

Mac 的 XCTest Runner 初始化失败时，可以在当前宿主**已经获准辅助功能访问**的条件下，运行有限的真实原生 AX 验收。脚本只操作它自己启动的 WeftMate 窗口，不申请权限、修改 TCC、启用代理或操作其他应用；它读取同一份 0600 隔离 fixture，完成原 ID／标题／正文、当前设备、重启恢复、A→B→A 及退出后重启。运行前由开发者确认普通 URLSession 已可达；这是 AX 界面证据，不能记为 XCTest 通过：

```sh
swift Scripts/run_mac_ax_test.swift \
  --debug-app /private/path/DerivedData/Build/Products/Debug/WeftMateMac.app \
  --credentials /private/path/test-account.json \
  --artifacts /private/path/new-mac-ax-validation \
  --namespace mac-daily-test
```

必须使用 Debug 的独立测试命名空间；Release 不支持此测试入口，脚本会在启动和联网前拒绝它，以免使用日常账户存储。每次使用新证据目录，密码不进入命令行／文本日志，截图只取当前测试应用窗口。既有辅助功能或屏幕截图许可不可用时明确失败，不自动修改系统安全设置。

仅修导航布局时，脚本可加 `--test navigation-layout`：只登录一次、读取原消息、核对导航标题/返回/刷新不被开发提示遮挡、保留应用截图并退出，不重复完整账户回归。真实登录测试遇到系统的保存密码提示时，为隔离密码选择“以后”。

### 有界局域网开发联调

公网路径不可达而现有局域网 HTTPS 服务可达时，可以启动仅用 Python 标准库的临时 CONNECT relay：

```sh
python3 Scripts/development_tls_relay.py
```

脚本只监听 `127.0.0.1` 临时端口，输出 `proxyPort` 和 PID，最多运行 15 分钟。唯一允许的目标为 `home.weftmate.com:8443`，透明转发至既有 `192.168.31.91:443`；拒绝其他目标，不列目录、不解密 TLS、不记录请求头或数据。客户端仍使用原 URL、SNI、Host 和正常系统证书验证。Ctrl-C、终止 PID 或到期会关闭监听和活动连接，不改全局代理、DNS、hosts 或 TUN。

先对正式只读状态执行正常 TLS 的探测，再使用 `AppleAcceptance --probe --development-proxy-port <端口>`；确认原生探测成功后才执行已授权隔离注册。真实 UI 脚本加入同一个 `--development-proxy-port <端口>`。该参数只在 Debug 开发构建生效；界面明确显示“局域网开发联调”。停止 relay 后恢复普通连接。局域网联调成功不能记录为公网、真机或 Watch 后台联网通过。

## 真机安装

需要用户自己的 Apple 开发团队和设备签名。将 `Config/Local.xcconfig.example` 复制为未跟踪的 `Config/Local.xcconfig` 并填写团队 ID，或在 Xcode 的 Signing & Capabilities 选择团队。手机伴随 Watch 的 bundle 标识和依赖已配置；Watch 独立账户、后台通知及实际手表联网验收仍按后续里程碑推进。

### Mac 本机试用交付

无需付费开发者账号的本机候选使用 Xcode 的 ad-hoc 签名，保持 `com.weftmate.apple.weftmatemac` 身份和沙盒网络权限。以下脚本按运行它的 Mac 的架构构建 Release，创建 DMG、只读挂载校验，再复制到全新的试用目录校验签名；不自动启动或覆盖现有应用：

```sh
python3 Scripts/package_mac_trial.py --artifacts /private/path/apple-delivery
```

输出包括 `.dmg`、`TrialInstall/WeftMateMac.app`、构建与签名日志以及 `manifest.json`。每次使用独立目录，保留旧候选。DMG 中的安装说明要求本人手动安装或覆盖。本地签名未公证，不能当作公众分发或其他 Mac 的免提示安装版本。安装目录变更不清理资料，但跨版本 Keychain 访问仍需真实验证：ad-hoc 的签名要求绑定代码哈希，bundle ID 相同不足以证明凭据保留。

当前源码按服务器和账户保存草稿、已读取的会话缓存与不可变请求记录。界面分别显示保存状态、缓存读取时间和服务端回执；未知请求重开时先查询原身份，用户明确继续才复用原内容。主仓源码合并不会自动发布或更新官网安装包。

### iPhone 与 Watch 真实设备的最后准备

在 Xcode 设置的 Apple Accounts 中确认本人账户可用；Phone 和 Watch 两个 target 的 Signing & Capabilities 选择同一个已有团队并保留 Automatically manage signing。将解锁的 iPhone 连接到 Mac，在设备提示中信任这台电脑；Watch 使用与该手机的真实配对。按设备提示开启 Developer Mode，然后在 Scheme 的运行目标中选择真实 iPhone 或 Watch，执行 Run。Xcode 此时创建所需开发签名与描述文件；尚未完成这一步时，不提供未签名 IPA 下载。个人设备开发试用可以采用 Personal Team；TestFlight 和公开发行需要另行核实对应开发者资格。本工程不自动注册收费账号或修改本人团队选择。

[Apple 真实设备运行说明](https://developer.apple.com/documentation/Xcode/running-your-app-on-simulated-or-physical-devices)、[签名和团队流程](https://help.apple.com/xcode/mac/current/en.lproj/dev60b6fbbc7.html)。

当前工作包与进度见主仓 `docs/PLAN.md` 和 `docs/STATE.md`；本说明不替代实际联调或用户验收。
