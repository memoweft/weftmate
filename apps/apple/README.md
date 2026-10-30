# WeftMate Apple 客户端

此目录是 WeftMate 主仓的 Apple 客户端。A0 已将旧独立工作副本截至 `278bc6c` 的 Apple 成果合入主仓；后续开发直接在主仓工作，旧任务卡不作为开工入口。

原生 SwiftUI 工程包括 `WeftMateMac`、`WeftMatePhone` 与手机伴随 `WeftMateWatch`，通过本地包 `Packages/WeftMateCore` 共用 `/personal/v1` 网络接口、模型与凭据存储实现。macOS 14、iOS 17、watchOS 10 是当前工程最低部署设置；当前源码版本为 `0.1.0 / build 11`。

Mac/iPhone 已包含对话附件上传、历史附件预览/保存、明确确认不确定本地消息后接管、账户与原会话读取、按账户保存草稿和离线缓存、明确选择模型后续聊、记忆页面、对话内执行时间线、来源/停止、审批与信息问答，以及 UTF-8 文本成果预览/保存/分享。Watch 通过 iPhone 原生连接显示当前进度、审批与最近回复，前台/刷新观察到任务完成时触感反馈；远程推送与真机配对验证尚未完成。源码接入和离线测试通过不等于真实后端或设备验收。

## iPhone 作为电脑窗口（APPLE-1-WINDOW）

iPhone 只加密保存原话、附件、日期、草稿、模型配置和原话交收据，不再提炼、纠正、遗忘或置顶自己的记忆。旧容器首次读取会原地升级：丢弃轻量记忆正文与提炼开关，保留旧遗忘所需的来源 ID 和正文摘要作为禁止重交记录；原话和已交收据保留。屏蔽也作用于旧加密发件箱中尚未上交的原话，升级不会上传旧轻量正文。

记忆页展示当前账号、当前电脑的获准副本和来源，空副本就显示空状态。手机模型可在原话交接尚未完成或选择稍后交时读取副本；账号切换或电脑移除不会恢复手机自记。电脑在线时，“修改或忘掉电脑记忆”进入现有电脑接口；电脑不可达时只读获准副本。未连接过电脑也可用已配置模型聊天，排队、停止、原话同步、提醒来源和电脑任务入口保持可用。

最终手机候选使用独立的 `WeftMatePhoneWindowTest` 目标和 Scheme（构建方案），身份固定为 `com.weftmate.apple.windowtest`，显示名为“WeftMate 苹果测试”，不嵌入 Watch，启用只读 HealthKit、后台送达与健康后台注册。它在 Debug、Release 与隔离配置中保持同一测试身份。原三端另保留 `DebugWindowTest`、`WindowTestRelease` 配置，Mac/Watch 保留对应的 WindowTest Scheme；调试配置名保留 Debug，使 Xcode 同时按 Debug 构建共享 Swift 包。Watch 的隔离身份为 `com.weftmate.apple.windowtest.watch`，伴随绑定匹配。

Windows 可运行 `python apps/apple/Scripts/generate_project.py` 和 `python -m unittest discover -s apps/apple/Tests -p 'test_*window*.py'`。Swift 与原生界面结果须在 Mac 实测；源码和项目生成成功不代表已编译通过。整合后的候选统一按下方 APPLE-5 的 `run_phone_window_checks.py` 步骤串行检查，状态阶段默认执行全部 24 组状态检查，修复时才用 --check 定点复测。

核心阶段运行 `swift test --package-path apps/apple/Packages/WeftMateCore --jobs 2`；状态阶段注册新的 `PhoneWindowModelChecks`，并运行 `PhoneStandaloneModelChecks`、`PhoneReminderModelChecks`、附件和模型服务回归。前者用真实合成 HTTP/SSE（服务器推送流）计数，跨过原 20 秒停顿、换会话和重新激活，断言只有显式聊天请求；同时覆盖未交完即可读副本、部分收据、大量交接稍后再交、账号/电脑隔离与授权变更。旧容器迁移用例直接构造旧加密文件，核对原话、日期、草稿、模型和收据保留，且旧正文不再落盘。

记忆页的 `PhoneWindowUITests/testMemoryRoutes` 覆盖无副本、有副本、电脑不可达，以及本地编辑入口消失；整合后与安装套件在同一批无界面 UI 测试运行，截图保存到 `window.xcresult`。采用 `-jobs 4 -parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1`，不开 `Simulator.app`；批后 `shutdown all` 并休息 3 分钟，发现新 `gpuRestart` 报告再等 10 分钟。新应用崩溃报告或无法读取诊断目录会分别记录；完整 Core 闭环、真机签名和后台行为分别验收。

## 常规构建与打开

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

`make test-core` 执行共享包 Swift 单元测试；`make test-state` 编译并运行 `Tests/*Checks.swift` 的全部 24 组状态检查，使用合成账户、受控 HTTP 和独立临时目录，不访问日用数据、后端或系统钥匙串。每次的编译/执行日志与 `results.json` 保存到受忽略的 `Build/StateChecks/apple-state-*`。需要源码外的证据目录时运行 `python3 Scripts/run_state_checks.py --artifacts <目录>`；`--core-build <隔离的 SwiftPM scratch 目录>` 可复用已构建的核心对象。`make test-mac` / `make test-phone` 属于 UI 验证，真实服务用例另需隔离 fixture。

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

## 按需登录与设备管理（APPLE-2 / AUTH-1）

iPhone 与作为远程客户端的 Mac 首次打开进入本机笔记，无需账户或密码。使用电脑／服务器功能时才弹出可关闭的登录页；支持邮箱＋密码（新设备追加邮箱码）和邮箱＋验证码。邮箱核对后自动连接电脑并进入对话，电脑没开或没联网时保留登录并提供重试。Mac 仍是远程客户端，本包没有把 Mac 做成个人宿主。

登录过期会保留已缓存内容与草稿，只在联网操作时要求重新登录；身份不匹配仍拒绝并清除当前身份。设备设置展示登录设备、首次登录和最近使用，可确认后立即下线。前台检测到新设备时显示能打开设备列表的应用内通知；Watch 沿用 iPhone 的摘要、审批及提醒桥接，没有独立登录页。

原生 App 内沿用 Authorization Code＋PKCE S256＋DPoP／刷新轮换。首次连接在 CA／域名验证后自动核对 `hostTrust` 签名与接收身份，再保存证书固定和安装公钥；已有固定值变化拒绝覆盖。主流程不再使用批准、可信交付码、扫码配对或等待配对页面。旧 SDK 接口只为兼容保留。

合成云端、文件邮件、电脑、模拟器重放与截图见 [APPLE-2 验收证据](Tests/Evidence/APPLE-2/README.md)。系统推送、后台唤醒、真机及生产中继没有在本包新增或部署。

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

## iPhone 与 Watch 真实设备的最后准备

### 独立 iPhone 测试候选（APPLE-5）

生成器另外提供 `WeftMatePhoneWindowTest` 和对应 UI 测试目标。候选固定为 `com.weftmate.apple.windowtest`，主屏幕显示“WeftMate 苹果测试”；使用独立应用容器、固定的测试 Keychain service、应用偏好域与本机状态目录。普通手动重开仍使用这些测试存储，不需要保留 Xcode 启动参数。原 Phone、Mac、Watch 目标仍分别构建。

只有 Debug 模拟器自动测试显式传入 `--ui-testing --ui-testing-namespace <独立名称>` 时，候选才使用该命名空间隔离合成账号、偏好和草稿；同名重启恢复，不同名称互不读取。实体 iPhone 与普通 Xcode／主屏幕启动继续使用固定候选存储，覆盖安装不改其数据域。

此目标支持手机聊天、同步和健康读取：保留独立存储，不嵌入 Watch，也不启动 WatchConnectivity。使用 HealthKit 与 background-delivery entitlement，注册健康后台任务并启用 fetch；首次主动进入健康页时请求只读授权（toShare 为空），登录或启动时不请求健康授权。提醒的前台与本机通知逻辑仍在，提醒后台刷新仍不注册。`Config/Local.xcconfig` 沿用受忽略的本机团队配置；不要把团队或凭据写进生成器。云登录继续使用已登记的回调 URI。

Windows 可先验证并生成项目，连续生成两次应无差异：

```sh
python3 -m unittest discover -s apps/apple/Tests -p 'test_*window*.py' -v
node --test apps/apple/Tests/phone_window_model_server.test.mjs
python3 apps/apple/Scripts/generate_project.py
```

Mac 确认只有本次执行会话后，在 `apps/apple` 中运行下面各步。`EVIDENCE` 指向源码外的私有证据目录，`PHONE_ID` 使用本次选定的实际 iPhone 模拟器 UUID：

```sh
python3 Scripts/run_phone_window_checks.py --phase preflight --artifacts "$EVIDENCE"
python3 Scripts/run_phone_window_checks.py --phase core --artifacts "$EVIDENCE"
python3 Scripts/run_phone_window_checks.py --phase state --artifacts "$EVIDENCE"
python3 Scripts/run_phone_window_checks.py --phase build --artifacts "$EVIDENCE"
python3 Scripts/run_phone_window_checks.py --phase ui --device "$PHONE_ID" --artifacts "$EVIDENCE"
```

状态阶段不传 `--check` 时执行全部已注册检查；`--check` 用于定点复测。UI 批次一起选择候选的 `PhoneWindowInstallUITests` 和 APPLE-1 的 `PhoneWindowUITests`；后者尚未集成时脚本拒绝最终 UI 验证，合入后须重新生成工程。至少执行这两组的四条测试，跳过或缺计数均不算通过。模拟器 UI 包使用本机 ad-hoc 签名以运行真实钥匙串，并在批次开始时仅重置所选模拟器中的合成测试候选容器；真机覆盖安装不做这项重置。安装套件验证真实聊天控制器的排队、停止、队列依次执行、普通无参数重开、前后台恢复和本人登录入口；仅 HTTP/SSE 回复时序使用合成替身。它不证明真实电脑的记忆形成、纠正或遗忘。

装机后可用 `--window-manual-login --window-install-id <本次随机 UUID>` 启动独立候选，待本机状态恢复后打开真实登录表单，账号密码由本人输入。该参数只在独立测试目标中生效，并且每个进程只打开一次；普通重开保持本机工作区入口。登录页实际出现时，在应用缓存的 `WindowInstall/login-visible.json` 记录本次 UUID、bundle ID 和出现标记，供 Mac 核对；文件不含表单、账户或聊天内容。

脚本每次建独立证据和构建目录，记录提交、工作区状态、命令、退出码、XCTest 计数摘要、截图结果包与新增崩溃报告。Swift 测试及每条状态检查限 20 分钟，构建和 UI 批次各限 30 分钟；结束收本次进程组。UI 批后关闭全部模拟器，等待 3 分钟；本批新 `gpuRestart` 则等 10 分钟，不打开 Simulator.app。诊断目录不可读记为未知。

Mac 上用本人的免费 Personal Team 实际签名，核对描述文件包含 HealthKit 与后台送达，再安装到已信任且开启开发者模式的 iPhone；签名失败须保留 Xcode 原始错误并写回 PR，确认不能签健康后才安装无健康降级版。登录服务器为 https://api.weftmate.com，由本人输入账号密码和确认健康授权。Apple 说明 Personal Team 的安装描述文件有效期为 7 天，到期需用同一团队重新构建安装；本项目不自动续签。Apple 官方能力表将 HealthKit 列为免费 Apple Developer 账号可用；本机仍以实际签名与描述文件核验为准。续签时用同一台 Mac、同一 Apple ID 和 WeftMatePhoneWindowTest Scheme 再 Run 覆盖安装，实际核对容器测试文件保留；不卸载、不清理原数据。参见 [Apple 免费设备测试说明](https://developer.apple.com/help/account/basics/about-your-developer-account)及[支持的 iOS 能力](https://developer.apple.com/help/account/reference/supported-capabilities-ios)。

### 原 Phone 与 Watch 目标

在 Xcode 设置的 Apple Accounts 中确认本人账户可用；Phone 和 Watch 两个 target 的 Signing & Capabilities 选择同一个已有团队并保留 Automatically manage signing。将解锁的 iPhone 连接到 Mac，在设备提示中信任这台电脑；Watch 使用与该手机的真实配对。按设备提示开启 Developer Mode，然后在 Scheme 的运行目标中选择真实 iPhone 或 Watch，执行 Run。Xcode 此时创建所需开发签名与描述文件；尚未完成这一步时，不提供未签名 IPA 下载。个人设备开发试用可以采用 Personal Team；TestFlight 和公开发行需要另行核实对应开发者资格。本工程不自动注册收费账号或修改本人团队选择。

[Apple 真实设备运行说明](https://developer.apple.com/documentation/Xcode/running-your-app-on-simulated-or-physical-devices)、[签名和团队流程](https://help.apple.com/xcode/mac/current/en.lproj/dev60b6fbbc7.html)。

本说明不替代实际联调或用户验收。

## IC-2 图标

应用和功能图标的唯一来源为仓库根 `design/icons/`。`npm run icons:generate` 现在也生成 Apple 资产；在 Mac 仅刷新苹果端可执行 `node scripts/generate-icons.mjs --apple-only`，无需改其他平台生成物。Apple 生成器复用现有 Electron SVG 渲染器，不另加图像库。

- `Resources/MacIcons.xcassets`：16、32、128、256、512 pt 的 1× / 2× AppIcon，浅底 C4。
- `Resources/PhoneIcons.xcassets`：1024 px 浅底、深底、灰阶着色 AppIcon；默认图标无透明通道，系统负责裁圆角。
- `Resources/WatchIcons.xcassets`：1024 px 浅底 C4，系统生成缩略图并裁圆。
- `Resources/Icons.xcassets`：功能图标模板、16 px 光学线宽版本、跟随深浅外观的彩色品牌标记，以及单色 C4。`WeftIcon` / `WeftLabel` 继承文字颜色，保留原有可访问性文本与动作；尺寸随 Dynamic Type 缩放。

分享入口复用 `open`（打开系统分享面板），退出登录复用 `back`（返回登录），选中标记复用 `allow`。不再维护 SF Symbols 映射或手绘旧品牌。macOS 当前没有自定义菜单栏 / 托盘或通知附件图标；新增这类单色位置应使用 `wm-brand-monochrome` 模板，不从 AppIcon 手工裁图。操作系统自己绘制的导航、展开控件与系统分享面板保留系统行为。

三端构建、浅 / 深色 iOS 界面、主屏幕及 Watch 取证见 [IC-2 证据](Tests/Evidence/IC-2/README.md)。Watch 仅 Debug 模拟器同时带 `--ui-testing --ic2-icons-fixture` 时显示合成审批卡；不启动手机连接，不模拟可达或实际批准，Release 不含此入口。

## APPLE-9 模型服务与多台电脑

iPhone 设置使用“模型服务”：填一个地址和密钥，自动查询聊天模型并选择默认，查询不到可以手填。输入区项目星芒直接打开模型菜单，按服务分组，换模作用于下一条并保存新对话默认；连电脑使用 MODEL-1 新路径，旧电脑404/405保持旧读取。手机旧库先在原 ThisDeviceOnly Keychain 留备份，再合并同地址同密钥的型号，聊天和附件仍按账号加密。

支持 multiHost 且确有多台电脑时，原生列表合并在线电脑对话，电脑菜单、审批和当前动态标来源，设备页可以改名和移除。加密副本按电脑保留、移除只清目标；原命令和原文交接固定原电脑。跨电脑动态/通知汇总、S7事项取消回执页、非当前离线电脑的只读页没有在本包完成，不能当作已有功能。

相关测试和截图见 [APPLE-9 证据](Tests/Evidence/APPLE-9/README.md)。本包无头启动模拟器2次，第二次期间系统重启1次；初批14张原图保留，修正版缺图交本人真机确认，不再启动模拟器。

## A8 对话流

iPhone / Mac 已按 D35 / UI-P4 接入单行工具进展、输入区审批条、即时消息与原请求重试、贴底与回到底部、同一发送 / 停止按钮及真实上下文圆环。此节替代上面 A3 历史说明中的桌面默认展开、完成自动改变展开状态与对话流审批卡：两端默认收起，用户展开状态在事件更新中保留，失败步默认展开。加载 / 排队 / 思考只采用宿主阶段，首次文字 / 工具后隐藏；纯文字不再显示旧任务控制块。

A8 运行中发送固定排队，输入区移除插话 / 新任务选择；D36 设置接线按派发边界留下一包。旧电脑模型菜单保留绑定模型入口；支持 MODEL-1 的电脑按上方 APPLE-9 服务菜单选择下一条型号。麦克风按钮聚焦输入并提示使用系统听写，不增加录音权限。

相关单测、隔离原生场景、截图与验证边界见 [A8 证据](Tests/Evidence/A8/README.md)。UI 测试使用 `run_a5_ui.py --phase a8-light` / `a8-dark`，Mac 自身窗口使用 `run_a8_mac.py`；构建串行 `-jobs 2`，只启动一个隔离 iPhone，测试后立即关闭全部模拟器，不启动 Watch 模拟器。

## 本机运行记录

三端共用 `WeftMateCore/RunLog.swift`，按天保存白名单 JSONL，启动标记落盘，后台回收和可疑前台异常结束分开。iPhone / Mac 在设置 → 关于 → 运行记录查看、预览并复制诊断摘要；分享先预览文件，再由本人打开系统分享面板或访达。手机页可切换手表，通过已有 WatchConnectivity 本机配对通道接收有上限的记录，离线保留并重连补送。

保留 7 天；手机 / Mac 日志目录总上限 2 MiB（含启动标记与手机手表收件箱），Watch 256 KiB；分享临时快照单独保留最多一份、最多 2 MiB。目录和分享快照均排除备份，不上传或接第三方服务。iPhone / Mac MetricKit 只保留类型、时段、数字诊断码、泛化原因和最多 8 个自家模块偏移，不保存原始负载。模拟器用注入投影测试，真实系统诊断需真机；延迟送达可能覆盖多轮，上一轮运行仅作候选关联。Swift fatalError / SIGKILL / 断电不能可靠运行处理器，以落盘标记和延迟诊断补线索。Mac 系统报告目录无权读取时记 unavailable，不把它当作零崩溃；没有为此新增沙盒权限。

字段与合成证据见 [DIAG-3](Tests/Evidence/DIAG-3/README.md)。双重 Debug 夹具 `--ui-testing --diag3-fixture --apple-contract-fixture` 直接复用设置关于页，namespace 隔离日志；没有账号创建、口令登录或模型请求。Mac 使用 App 内 AX 运行器，不重试 XCUITest automation mode。
