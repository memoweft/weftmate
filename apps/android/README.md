# WeftMate Android 客户端

IA-4 当前壳 **0.8.13 / code26**：手机主对话复用 IA-3 母版，精确核对六项逻辑对话能力后接入；旧宿主保留会话列表。`chat.message` 使用现有原生请求账本，原件与可读附件按 `chatId` 暂存，原请求查询仍沿原编号；旁聊附件草稿受理后移动。日期选择使用系统选择器，日期键由 `formatToParts` 生成；输入区沿窗口键盘内缩，字号跟随系统 `fontScale`。发布本界面包最低 code26；证据与验证边界见 [IA-4](../../tests/evidence/ia-4/README.md)。TB-4 的底部四页容器先隐藏。

UX-3 当前壳 **0.8.12 / code25**：附件桥增加 `kind:"camera"`，通过系统相机与专用临时图片URI（资源标识）导入现有附件草稿；沿用已有相机权限，文件 / 照片仍用原生选择器。宿主对话推理偏好经 `/sessions/{id}/thinking` 业务桥，模型能力透传到共用输入区。发布此界面包需最低code25；取消 / 切账户 / 切对话结果隔离与原回执保持。构建与适用项证据见 [UX-3](../../tests/evidence/ux-3/README.md)。

LG-1b 当前壳为 **0.8.8 / code21**：登录、注册、找回密码、等待批准和账户 / 设备设置复用 LG-1a 的共享业务。App 内的 `cloud.app.*` bridge（桥接）使用原生网络层的独立 Cookie jar（会话容器），只允许配置云 / 宿主的明确 `/personal/v1` 路由，不跳系统浏览器。`cloud.app.identity` 返回手机型号、`weftmate-android` 与登记的 `com.memoweft.weftmate:/oauth`；`configure` 返回云配置；`key` 只返回 P-256 `publicJwk` / `deviceId`；`sign` 返回 ES256 的 `signature`；`credentials` 返回非敏感展示数据与刷新令牌的不透明句柄；`request` 返回 `status/body/nonce/retryAfter`。私钥留在 Android Keystore（安卓密钥库），可用时优先 StrongBox（独立安全芯片），否则由 Keystore 的实现保存；签名始终在原生层完成。实际刷新令牌经 Keystore AES-GCM（认证加密）保存，WebView（网页视图）只得到随机 `wm-refresh:<uuid>`，旧 `cloud.tokens` 接口不能读取新存储。宿主 Cookie 与真实 CSRF（跨站请求伪造防护）也不进入页面；成功交换后沿用 `cloud.adopt` 的本机账户归属与同步。受信交付码 / 配对码建立 TLS pin（证书公钥固定）后才允许正式宿主内容交换；隔离 HTTP 回环调试仍可验收。

扫码按用户点击请求 `CAMERA` permission（相机权限），设备无相机或用户拒绝时仍可手填配对码。相机为可选硬件；原生仅向 `appassets.androidplatform.net` 内置页面的 `VIDEO_CAPTURE` 请求授予相机，不授予音频采集。页面中的二维码解码由手机 UI 提供。

code21 同时退役旧刷新令牌桥：`cloud.request` 的旧 `/oidc/token` 路径与 `cloud.tokens` 的读取 / 非空写入返回 `NATIVE_LOGIN_UPGRADE_REQUIRED`，只保留 `cloud.tokens` 的空字符串删除入口，避免内置页面经旧接口绕过原生保护。首次升级至 code21 将旧缓存页面的活动 / 回退指针切至新版内置页；缓存文件、本机对话、草稿和记忆保留。后续手机 UI 发布必须声明 `minNativeVersionCode >= 21`，不再激活依赖旧令牌桥的发布包。

LG-1b 的独立验证包为 `com.memoweft.weftmate.mobile.lg1bqa`，通过 Gradle 参数 `-PweftmateApplicationId=com.memoweft.weftmate.mobile.lg1bqa` 构建。`Lg1bWebViewProbeTest` 只在该包及显式 `lg1bProbe=1` 时启动调试，`lg1bHostOrigin` 指向随机端口的隔离宿主，完成文件为 `files/lg1b-probe.done`。`CloudAppSecurityInstrumentedTest` 仅在同包及 `lg1bNativeSecurity=1` 下运行，用独立偏好设置 / 密钥和进程内随机凭据验证不可导出私钥、原生刷新轮换、不透明句柄及退出后清除；不读取本人账户。测试专用 `cloud.app.status` 仅在这个 debug（调试）包可用，返回 `credentialPresent/refreshCount`，不返回秘密。

IC-1 当前壳为 **0.8.5 / code18**：C4 自适应启动图标、单色主题 / 通知图标与统一功能图标已接入；母版在 [design/icons](../../design/icons/README.md)，用 `npm run icons:generate` 生成。没有新增权限或原生接口，手机 UI（网页界面）的最低桥接版本仍为 code17。[真实 MuMu 验证与卸载](../../tests/evidence/ic-1/README.md)。

UI-2 当前壳为 **0.8.4 / code17**：内置与桌面统一的手机会话列表、主题与全屏「输出与来源」，新增精确 `GET /sessions/{sessionId}/resources?afterSeq` 原生连接路由，系统栏改为同一中性色；内置版本显示使用 BuildConfig。没有新增权限或数据库迁移。新版 UI（网页界面）发布最低 code17；本机 JVM（Java 虚拟机）27/27与调试包构建通过。UI-2v 已补齐 **MuMu Android 15 真实安卓壳**的列表、运行、审批、步骤、全屏成果/来源、真实系统输入法与深色验收，产品代码无修正、版本保持 code17；[安卓截图与输入法边界](../../tests/evidence/ui-2v/README.md)。原390×844 Chromium（浏览器引擎）验收保留在 [UI-2](../../tests/evidence/ui-2/README.md)。

UI-2a 当前壳为 **0.8.3 / code16**：内置手机审批模式界面，新增精确 `/settings/approvals` 与 `/sessions/{sessionId}/approval-mode` 业务路由；审批决定可传 `scope: once / conversation-category`，拒绝不带 scope（授权范围）。继续使用原 Cookie（会话凭据）、CSRF（跨站请求伪造防护）和 TLS pin（证书公钥固定）连接，没有新增系统权限。发布新版手机 UI（网页界面）需 `--min-native-version-code 16`；合成截图与本机 JVM（Java 虚拟机）/调试包构建结果见 [UI-2a](../../tests/evidence/ui-2a/README.md)。

0.8.0/code13 采用 hybrid（混合式应用）：`HybridActivity` 用 WebView（网页视图）显示可由个人宿主更新的 Weave 页面，Kotlin（安卓语言）继续保存账户与模型凭据、SQLite（本地数据库）对话和待同步事件，并执行手机模型调用及受限 Android Intent（系统意图）。旧 `MainActivity` 原生 Views（原生视图）页保留作兼容入口。最低 Android 8（API 26），调试包名仍是 `com.memoweft.weftmate.mobile.debug`，更新时沿用原应用数据与签名。

## 能力与边界

- 本机 SQLite 保存会话、消息、回合、工具回执和待同步事件。用户消息先落库，再请求手机自行配置的模型；应用退出后不会自动重发模型请求或手机动作。被中断的回合在下次启动记为 `interrupted`。
- 账户复用宿主的 `/personal/v1/auth/register`、`/auth/login`、`/auth/me` 和 `/status`。不同账户的稳定 `ownerId` 与服务来源共同定义手机本地归属；各账户分别有会话、草稿、通知和模型配置，同一账户可登录多台设备。密码只用于注册、登录或主动改密，不落盘。会话 Cookie、CSRF 值和手机模型 API key 以 AndroidKeyStore 的 AES-GCM 密钥加密保存；本地数据库不保存这些凭据。备份关闭。
- 手机直连模型由用户配置 OpenAI 兼容 `/v1` 地址、模型 ID 与需要时的 API key（接口密钥）；公网使用 HTTPS（加密连接），明确填写的个人局域网本地服务可用 HTTP。密钥按规范化端点隔离并以 AndroidKeyStore（安卓密钥库）的 AES-GCM（认证加密）保存，模型短名称和真实 ID 分开保存。电脑模型从个人账户的真实已配置档读取，经账户代理调用，电脑模型密钥不传到手机。目录核对只证明可列出模型，不冒充真实推理验收。
- 模型回复优先读取 SSE（服务端事件流），只有收到 `[DONE]` 与正常结束原因才记为完成；中途截断、输出上限与内容过滤都保留已有正文并记为未完成。停止保留已经生成的部分正文，回合为 `cancelled`。手机模型循环仍最多六轮、每轮最多三个工具调用；重复已派发动作会终止循环。
- 手机工具只列可启动应用、通过 Android Intent 请求打开指定可启动应用或系统设置。派发不等于已核对目标页面。它没有 ADB、shell 或跨应用无障碍权限。
- 同步只上传本机记录，不向电脑派发动作。`eventId` 与 `clientSeq` 持久稳定；受理回执落库后才清待传状态，拉取页和游标同事务写入。401 停止当前凭据的自动同步，409 保留原事件待处理。`HybridActivity` 在已登录启动与登录成功时安排现有 `SyncJobService`，切号先取消旧 Job（系统后台任务）再为新身份安排，退出或撤销当前设备时取消。每次安排都有独立代次；旧请求返回后须核对代次与完整设备会话凭据，不能取消新账号或同账号新登录的 Job。系统停止执行时会中断工作线程和当前连接，后续上传、回执写入与拉取均有身份守卫。页面显示 JobScheduler（安卓任务调度器）的实际待运行状态。调度失败不影响已成功的登录，本机记录仍保留且可手动同步。系统决定后台 Job 的具体执行时间。
- 已登录账户即使暂时离线，也能继续读取属于该账户的本机对话并用其手机直连模型。退出后只显示登录/注册引导，不把账户 A 的资料变成账户 B 或公共本机空间。旧无主资料原样保留；只有升级前已确认的旧账户可通过明确的关联操作认领，归属不明资料不向新注册账户开放。Web（网页）页面仅收到展示数据，不收到 Cookie、CSRF 或模型 API key。

## 当前界面与更新

会话列表为首页，顶部新对话与搜索，底部设置与账户。进入对话后，标题栏「输出与来源」打开全屏列表与阅读页，返回原对话位置。对话使用本地打包的 markdown-it（Markdown 渲染）、DOMPurify（内容净化）和 highlight.js（代码高亮）；代码块与整条回复调用原生剪贴板，宽表可横向阅读。输入区保留附件、模型、审批模式、系统语音与发送 / 停止，草稿按账户与会话保存。系统语音只把识别结果回填草稿，用户确认后才发送；没有系统识别服务时明确报不可用。

侧栏可进入记忆、能力与扩展、项目与成果、设备、通知和设置。手机回合与动作、电脑命令只用实际状态；尚未接通的模块保留真实状态，不放示例数据。账户页支持多账户注册、登录、资料、头像、改密与各自设备管理；已登录账户网络暂断时仍可用其本机历史与直连模型。主题、通知类别和头像按账户持久保存或与账户资料同步。

首页合并手机与电脑会话，已绑定的手机会话不会重复列出；按各会话真实 `sendAvailable` 决定是否可发送，只读会话仍可查看历史。设置中的原生兼容界面继续保留。

可更新页面源与内置资源均在 [apps/mobile-ui](../mobile-ui/README.md)。APK（安卓安装包）内置离线页面；登录后从当前账户宿主读取版本清单并下载完整资源，在私有目录逐文件核对哈希与容量后才允许切换。SSE 通知和再次进入前台会检查更新。自动更新界面默认开启，当前账户有未发送草稿或仍在回复时仅暂存；空闲后自动应用，设置页还可手动检查、应用或退回上一版。坏包回退到上一可用版或内置版，并记住失败发布身份；同一坏版不会反复下载。页面、样式和前端业务组合可由服务器发布；新增原生权限、工具、数据库迁移或连接层仍需 APK。状态栏、输入法和安全区由 Android 实际窗口处理，不绘制假系统栏。

0.8.0/code13 增加 host 会话普通文件选择与原件保存桥。文件卡从持久历史重建，保存时使用系统文件选择器并流式核对大小与 SHA-256；需要该动作的服务器 UI 必须声明 `minNativeVersionCode=13`，code12 继续使用其兼容页面并通过现有更新入口手动覆盖 APK。

## 构建

在本机开发环境使用 `D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1` 进程局部激活已安装的 JDK 17、Gradle 8.9 和 SDK 35，然后在本目录执行：

```powershell
. D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1
gradle --offline :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest --console=plain
```

产品调试 APK：`app/build/outputs/apk/debug/app-debug.apk`。独立测试 APK：`app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`。个人账户宿主的正式来源要求 HTTPS；调试构建仅可用字面 `localhost` 或 `127.0.0.1` 的 HTTP 宿主做隔离验收。手机模型允许用户显式配置局域网私有地址或 `.local` 的 HTTP `/v1` 服务；公网模型端点仍须 HTTPS。所有 HTTPS 使用系统默认的证书验证，网络客户端拒绝重定向，不把密钥带到其它来源。

## 隔离验证

### 用 MuMu 模拟器验收安卓

本机 ADB（安卓调试桥）：`D:\Software\MuMuPlayer\nx_main\adb.exe`；连接命令 `adb connect 127.0.0.1:7555`，后续明确 `-s 127.0.0.1:7555`。启动隔离个人宿主并创建合成账号，使用 `adb -s 127.0.0.1:7555 reverse tcp:18187 tcp:18187`，安卓壳服务地址填 `http://127.0.0.1:18187`，无需猜 MuMu 网关或开放宿主到局域网。

如果模拟器已有 `com.memoweft.weftmate.mobile.debug`，通过 [UI-2v 初始化脚本](../../tests/evidence/ui-2v/isolate.gradle) 构建为独立 `com.memoweft.weftmate.mobile.ui2vqa`，不覆盖原应用。测试 APK（安卓安装包）内的 `Ui2vWebViewProbeTest` 仅在明确 `ui2vProbe=1` 且目标为这一隔离包时打开 WebView（安卓网页视图）调试；操作仍走产品原生连接层。测试包另含 `Ui2vTestIme`，用于预装输入法零高度时验证真实系统软键盘及 `InputConnection` 文字提交，不打入产品 APK。

完整构建、安装、合成宿主、输入法设置保存/恢复、真实截图与卸载步骤见 [UI-2v](../../tests/evidence/ui-2v/README.md)。结束只卸载本次两个隔离包、停止隔离服务并移除本次 ADB reverse（安卓端口反向映射）与 forward（调试端口转发）；不要卸载旧调试包、清除其资料或使用全局端口清理。

### 现有原生测试

主助手负责确认 MuMu 的序列号、安装两个 APK 和启动测试。本仓库不自动安装或清除模拟器。测试 runner 为 `com.memoweft.weftmate.mobile.debug.test/androidx.test.runner.AndroidJUnitRunner`。以下旧原生页测试保留作兼容回归，**不能代替新 launcher 的 `HybridActivity` 验收**。

- `LocalPersistenceTest`：本地重启、未绑定记录、终态恢复、待同步队列、游标和账户隔离。
- `ModelLoopTest`：模拟模型重复请求同一已派发工具，核实手机动作只执行一次。此测试不打开系统设置。
- `NetworkCancelTest`：本机阻塞响应头/上传失败时取消连接与清理。
- `UiSmokeTest`：启动原生界面并写 `weftmate-ui-smoke.png`，测试输出含 `SCREENSHOT_PATH`，供主助手从模拟器取图核对。
- `WeaveVisualProbeTest`：沿可见菜单/设置路径拍空对话、侧栏、设置主层、模型子层和能力规划页，并断言空态连接行完整位于聊天视口内；不发模型请求。
- `FrontendViewTest`：检查设置与手机/电脑只读记录页保留草稿和会话、不能误发旧会话、慢响应不能覆盖已返回的聊天；输入法测试只在真实 IME bottom inset 绘制稳定后通过，否则明确跳过，不能把可见标志当键盘证明。
- `StopActualInstrumentedTest`：测试内用回环阻塞模型响应头，通过可见停止图标实际取消，核实本机回合为 `cancelled`、助手假回复为零；不调用真实模型。
- `PersonalSyncInstrumentedTest`：仅在主助手提供隔离合成账户的 `syncOrigin`、`syncUser`、`syncPassword` 参数时运行；从手机进程真实登录、上传、重复回执、冲突和拉取，不发模型请求、不操作设备。若未提供参数，测试跳过。
- `OfflineSyncPhasesTest`：同一个 `syncRunId` 分三次运行 `syncPhase=setup|offline|resume`。`setup` 连接隔离宿主并加密保存合成身份；主助手受管停止宿主后运行 `offline` 写本地事件并证明未清空；重启同一宿主后运行 `resume`，核实同一事件 ID 受理、重复提交返回 `duplicate=true`。各阶段使用独立测试数据库，不清空调试应用资料。
- `NativeFlowInstrumentedTest`：只在 `runInference=1` 且指定合成账户与 `modelOrigin` 时，经原生界面登录、保存模型、保留草稿/会话、发送普通聊天；必须等本轮持久完成且助手气泡实际布局可见才截图。测试以真实 WindowInsets 判断软键盘：可见时输出 `weftmate-ime-flow.png`，不可见时输出 `IME_VISIBLE=false` 和 `weftmate-composer-no-ime.png`，不能把后者算作键盘验收。随后点击“系统设置”核对 Android Intent 派发与本地回执。该测试会发送真实模型请求，不属于默认测试。
- `NaturalToolInstrumentedTest`：显式 `runNaturalTool=1` 时只发一次自然语言“打开系统设置”；只有模型真实调用手机工具、回合完成且 Android 设置在前台才通过。普通文字承诺会失败。此测试会发送真实模型请求，不属于默认测试。
- `HybridVisualSmokeTest`：启动新 `HybridActivity`，等内置页面、抽屉/设置/模型弹层完成布局与 WebView `postVisualStateCallback`（视觉状态回调），再用 `UiAutomation.takeScreenshot()` 拍系统屏幕。图在测试应用的 `externalFilesDir`：`hybrid-0-chat.png`、`hybrid-1-drawer.png`、`hybrid-2-settings.png`、`hybrid-3-models.png`。同类还经真实 WebMessage（网页消息）入口检查 camelCase（驼峰命名）桥方法的有限响应，并用 APK 内实际 Markdown 库渲染表格与代码；显式 `renderFixture=1` 且已有合成回复时才截图原持久消息的表格/代码。不发模型请求。
- `HostModuleProjectionTest`：从真实 `status.backend.modules` 层读取已连接、未启用与未知，不把缺失字段当已接入。
- `ModelLibraryTest`：独立测试 KeyStore 别名与私有设置，验证多端点密钥隔离、短名称重启回读与当前端点 `/v1/models` 标签；不碰默认模型库。
- `StreamingModelTest`：合成 SSE 与 JSON（普通响应）的长度终止、实际思考状态、主动取消已生成文字及缺失 `[DONE]`，不调用真实模型或手机动作。
- `HybridClipboardTest`：只有显式 `clipboardSynthetic=1` 才运行。一个用例检查原生复制桥保留换行缩进，另一个必须等真实合成模型回复出现代码块后，实际点击渲染出的“复制代码”控件并核对系统剪贴板。测试先等待应用窗口获焦再保存原剪贴板，结束恢复，绝不输出原内容。
- `AvatarImageTest`：生成有效合成 PNG（图片格式）并经实际 `ContentResolver.openInputStream`（内容读取接口）走头像尺寸探测与解码，再核对有界 JPEG（图片格式）结果；不上传账户资料。
- `MultiAccountIsolationTest`：合成 A/B 两账户与无主旧会话，验证旧活动账户模型迁入其独立加密 scope（归属范围）、B 不可读 A 会话/密钥、通知收件箱和类别隔离、未知无主资料保持未认领；延迟投递的 A 回调不会显示在 B 页面。不触及真实账户。
- `HybridBackgroundSyncTest`：显式 `hybridSyncFixture=1` 且当前为 18187 的 `root-phone-*` 合成账户时，先保存系统原有 Job 状态，再核 `HybridActivity` 登录态启动确实注册现有 `SyncJobService`，关闭界面后 Job 仍保留，最后恢复测试前的调度状态。此测试不发模型消息；切号、退出和系统强制运行仍由主助手在隔离账户与 JobScheduler 中验收。
- `SyncJobLeaseTest`：使用独立数据库与合成传输模拟 A 的同步请求挂起、B 已安排新代次后 A 返回 401；也覆盖同一 owner 换设备或轮换 Cookie，以及旧成功回执在切号后不再清待传事件。它不发真实网络请求；实际 JobScheduler 的注册和系统执行仍须在隔离设备验收。

示例（参数仅用隔离合成账户；不要把真实密码放进命令行）：

```powershell
adb -s <confirmed-serial> shell am instrument -w -e class com.memoweft.weftmate.mobile.PersonalSyncInstrumentedTest -e syncOrigin http://127.0.0.1:18187 -e syncUser <synthetic-user> -e syncPassword <synthetic-password> com.memoweft.weftmate.mobile.debug.test/androidx.test.runner.AndroidJUnitRunner
```

`127.0.0.1:18187` 只有在主助手已对隔离宿主配置 ADB reverse 后才可从模拟器访问。该路径不连接正在使用的个人资料。真实模型回复、真实手机安装与用户体验另行验收。

## 可选真实 MiniPlus 模型联调

`test-support/miniplus-relay.mjs` 只供主助手管理的隔离 MuMu 验证。它需要显式 `--enable-real-model-relay` 和启动进程中的 `MODEL_SWITCH_UNIFIED_KEY` 环境变量；缺一拒绝启动。仅监听 `127.0.0.1:18189`、接受固定 `occamy-miniplus-v21` 的 `/v1/chat/completions`，只转发至本机 `8081`，不预加载模型、不接受任意目标地址或命令；客户端断线中止上游请求，stdin `q` 退出。密钥不写入 APK、源码或日志。主助手可在确认端口与模型服务后执行 ADB reverse `tcp:18189 tcp:18189`，从侧栏底部“个人设置”进入“对话模型”，填入调试地址 `http://127.0.0.1:18189/v1`。该模型仍运行在电脑上，所以此验证只能证明安卓原生聊天与工具循环，不能证明电脑断电时独立推理；手机自己的 HTTPS 模型提供方需要另行配置与真实验收。


### S1c-Web 云登录（0.8.2 / native code 15）

连接页可输入电脑设置中复制的一次性配对码，再点「用 WeftMate 账号登录」。WebView 不承载云密码页面：系统浏览器完成 Code+PKCE 和邮件确认，通过 `com.memoweft.weftmate:/oauth` 返回应用。云端预登记 weftmate-android 的上述回调。配对码提供内容 TLS pin；所有原生宿主请求在系统 CA/域名验证后校验 SPKI，刷新凭据与 Cookie 使用现有 Keystore 加密设置。扫码相机另包，不新增权限。

GitHub `S1c Web and Android / Android debug and JVM tests` 执行 Gradle 8.9、Java 17 的 `:app:assembleDebug :app:testDebugUnitTest`，包括回调路径/重复或不匹配 state 的 JVM 测试。本机无 SDK 时使用此 runner，不重建开发环境。系统浏览器返回和实际 TLS pin 的 Android 真机测试仍需隔离模拟器/测试设备。手机 UI 发布需 `--min-native-version-code 15`。

MEM-2壳 **0.8.13 / code26** 增加临时对话业务路由 `/sessions/temporary`。界面包含入口、标题提示、记忆 / 召回开关和期限；宿主历史 `cacheAllowed:false` 时不保存为离线历史。发布此界面包最低code26。
