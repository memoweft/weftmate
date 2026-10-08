# WeftMate 手机界面

UPD-1 / D32：Android（安卓）0.8.9 / code22 的发布清单升级为统一 `mobile-ui` 签名格式，保留旧 `uiVersion` / `assets` / `minNativeVersionCode` 字段与既有下载接口。新安卓壳在下载、激活和恢复已装版本时核对内置公钥的 Ed25519（签名算法）签名与兼容范围；按大小与 SHA-256（文件哈希）复用内置 / 当前版本的相同文件，全部校验后才暂存，任务 / 草稿期间继续暂缓切换，坏页沿用原生回退。旧壳仍可读取新清单，但不具备新签名验证能力。发布命令现在必须从 `WEFTMATE_UPDATE_PRIVATE_KEY_PATH` 读私钥路径，私钥绝不进仓库或包；正式公钥与发布源留 UPD-3 配置。完整步骤与本地校验见 [发布说明](../../scripts/release/README.md)，真实 Chromium（浏览器引擎）390×844 与 MuMu（安卓模拟器）切换 / 回退见 [UPD-1 证据](../../tests/evidence/upd-1/README.md)。合入 BK-1 后资源总数达到251，超过旧壳250文件容量；code22支持512文件，超过250的包必须声明 `minNativeVersionCode >= 22`，旧壳保留原界面。共享 `src/ui-core/update.js` 提供当前 / 可用版本、状态和检查动作，关于页呈现由 UI-4 注册表接入。

UI-P1m：手机动效沿用 UI-P1 的 120–240 毫秒令牌与无弹跳曲线。执行块、逐条步骤、审批、全屏来源、会话、抽屉、发送 / 停止、队列、登录步骤与长按菜单已接入；布局立即完成，退出副本不参与交互或滚动。系统减少动态效果与 Android（安卓）三种动画缩放任一为 0 时瞬时显示，运行中修改也生效。超过 20 项不逐项动画。未新增令牌；重新生成并检查已有令牌。[浏览器与 MuMu（安卓模拟器）连续帧、性能与验收边界](../../tests/evidence/ui-p1m/README.md)。

LG-1b：0.8.8 / Android（安卓）code21 在应用内登录、注册与找回密码；复用 `src/ui-core/cloud-auth.js` / `cloud-account.js` 的授权、验证码倒计时、账户生命周期与设备动作。登录前只呈现账户表单，连接电脑、扫码与输入码放在「设置 → 设备」。新设备等待已登录设备批准，账户退出与注销清凭据并保留本机数据。一台设备只有一个当前账号。

Android 使用原生 P-256 Keystore（系统密钥库）签名与加密凭据存储，真实刷新令牌不进入 WebView（应用内网页视图）；网页使用不可导出 WebCrypto（浏览器密码接口）密钥与 IndexedDB（浏览器结构化存储）。二维码相机读取内置 [jsQR](https://github.com/cozmo/jsQR) 1.4.0，不上传画面；无相机可输入电脑配对码。条款与隐私资产从 `docs/legal/` 构建并逐字节校验。发布这版页面须使用 `--min-native-version-code 21`；新桥需同时更新 APK（安卓安装包）。[真实云、手机网页与 MuMu（安卓模拟器）验收](../../tests/evidence/lg-1b/README.md)。

UI-3m：0.8.7 / Android（安卓）code20 接入共享的排队与插话状态机。电脑会话运行中默认「插话」，可切「新任务」；输入框上方折叠显示「N 个排队中」，支持取消与编辑后重新排，停止保留后续队列。插话消息显示「已补充到当前任务」。审批与工具来源先呈现人话摘要，原始参数收在「详情」；输出同名去重，并可查看已读取的旧版。名称 / 角色交互测试与真实隔离宿主 / MuMu（安卓模拟器）验收见 [UI-3m](../../tests/evidence/ui-3m/README.md)。发布最低原生 code20：它透传发送意图，并保留取消竞争的 HTTP（网络协议）409 状态；旧原生壳继续使用原界面。

FE-1b：手机接入 `src/ui-core/` 共享功能层，保持 0.8.6 / Android（安卓）code19 的现有外观与登录 / 注册流程。入口创建独立功能实例，页面位置集中在 `www/layout.js`；`www/components/` 管理呈现、抽屉、焦点、滚动和原生选择提示。会话历史、时间线投影、审批 / 模式、提问、任务、成果 / 来源、记忆快照、设置和原生请求恢复经共享层与手机适配器执行。传输、账户凭据、模型密钥和本机记录继续留在原生壳。构建副本与母版不一致时，手机检查、Android 打包与宿主发布都会失败。[改前 / 改后 Chromium（浏览器引擎）与 MuMu（安卓模拟器）证据](../../tests/evidence/fe-1b/README.md)。

UI-2：0.8.4 / Android code17 统一桌面中性色与浅 / 深 / 跟随系统主题。首页为可搜索的会话列表，工具步骤默认收起；「输出与来源」在手机打开全屏列表、成果与使用摘要，返回保留对话位置和草稿。来源列表复用 CLIENT_API 3.16，按账户与会话缓存，原文按需读取；新增对应的原生只读路由，因此发布最低 code17。手机相关交互100/100、Android JVM（Java 虚拟机）27/27、调试包构建与类型检查通过；[截图、复现与验收边界](../../tests/evidence/ui-2/README.md)。

UI-2a：0.8.3 页面新增输入区五种审批模式、全部允许风险确认、设置中的新电脑对话默认模式，以及允许一次 / 总是允许此类 / 拒绝审批卡。模式按 CLIENT_API 3.7 保存在电脑会话上；共享会话和已交给电脑的手机对话均可使用，手机直连模型未绑定电脑时显示适用范围。同类授权只限当前对话，断网重试保留原请求与范围。Android 壳需 code16，发布使用 `--min-native-version-code 16`（发布器默认值已更新）。验收见 [UI-2a](../../tests/evidence/ui-2a/README.md)；`node --test tests/approval-interactions.test.mjs` 使用 Chromium（浏览器引擎）验证 390×844 的真实页面，截图默认写仓库忽略的 `.local/ui-2a/`。

`www/` 是同一份 Weave 0.8.4 页面资产：Android APK（安卓安装包）内置它作离线底版，个人宿主的版本发布也只读取这个目录。修改 `www/` 不会自动改变已经安装的底版；经审阅后由宿主发布新界面包，现有 APK 在连接时下载、校验并切换。新增原生能力、权限、数据库或 native bridge（原生连接层）版本仍需更新 APK。

## 开发与打包

```powershell
cd D:/AIProjects/WeftMate/Repository/apps/mobile-ui
npm ci
npm run build
npm run check
```

`npm run build` 将固定依赖的 `markdown-it`、`DOMPurify`、`highlight.js` 打成 `www/vendor.js`，并按 `src/ui-core/manifest.mjs` 的 `uiCoreAssets` 清单生成 `www/ui-core/`。这个目录只存生成文件，修改功能必须回到 `src/ui-core/` 母版；`npm run check` 严格比较文件集合与每个字节，并检查全部页面脚本语法。Android Gradle（安卓构建工具）`preBuild` 和宿主发布脚本使用同一检查，`assets.srcDir` 收入同一份 `www/`。包内 `www/licenses/` 保留所用开源库的许可证；图标来自用户指定的 MobileStyle v1.2 原件。

手机原生桥适配位于 `src/ui-core/adapters/`。共享功能以 `/personal/v1` 数据形状调用适配器；适配器选择现有的原生缓存、认证、任务与业务方法，真实 Cookie（会话凭据）、CSRF（跨站请求伪造防护）和模型密钥不进入页面。`mobile-decisions.js` 复用共享审批 / 提问 / 任务动作，并迁移旧未确认请求标记与问题草稿；手机原生发送和本地 / 已交给电脑的对话回执恢复由适配动作保留。记忆界面的节点留在组件里，功能层只保存视图标识和账户 / 修订快照。

相关验证：`npm test`（按可见名称 / 角色的 Chromium 流程及内部状态回归）、根目录 `node --test tests/mobile-memory-page.test.ts tests/mobile-android-bridge.test.ts tests/mobile-ui-core-assets.test.ts tests/ui-core.test.ts`；设备流程与前后截图复现见上面的 FE-1b 证据。MuMu 使用 `-PweftmateApplicationId=com.memoweft.weftmate.mobile.fe1bqa` 或证据中的隔离构建脚本，测试结束卸载自己的包，不覆盖已安装应用。

宿主发布使用仓库的 `scripts/build-mobile-ui.mjs`，由主助手在审阅后选择独立输出目录和版本。发布器生成不可变资产与清单，手机对每个文件核对大小和 SHA-256（哈希）后才在私有目录切换。应用页面只从 `https://appassets.androidplatform.net/ui/` 加载；外部网页没有原生桥，业务请求也只允许当前账户宿主的固定业务前缀。

0.8.1 页面使用历史尾页、beforeSeq 和 `shared.sessions.eventDetail`，必须以 `minNativeVersionCode=14` 发布。`scripts/build-mobile-ui.mjs` 默认版本与最低原生版本已同步；旧 code13 及以下继续使用原界面，需要先更新 APK。

## 页面与数据

页面涵盖登录/注册、对话、记忆、能力与扩展、项目与成果、设备、通知、资料、模型、外观、同步和更新。记忆、Mod（能力模块）与电脑项目尚未接入的部分保留真实状态和页面位置，不生成演示条目。聊天 Markdown（结构化文本）先净化再显示；代码块、表格、复制和滚动位置由页面负责，模型请求、手机工具、SQLite（本地数据库）记录与系统通知仍由 Kotlin 执行。

前端只收到当前账户的显示投影。草稿与选中会话按服务来源加 `ownerId` 派生的 scope（归属范围）分开保存；退出后不展示上一个账户的草稿和历史。`host.business` 只可访问已规划的 `/personal/v1/{memory,mods,tasks,notifications,workspaces,capabilities}/` 路由；实际后端未连接时页面显示未接入。账户 Cookie、CSRF 和模型密钥始终留在原生层。

此目录的构建与静态检查不等于 MuMu（安卓模拟器）实屏、真实模型、账户多用户隔离或无重打包更新验收；这些由 Android instrumentation（设备内仪器测试）与主助手管理的隔离宿主分别验证。


历史与执行使用 CLIENT_API 第 3.4 / 4 节：首次读尾页、上滑读更早、正向游标独立；手机执行块默认收起，审批 / 提问 / 成果留在原对话。独立事情页与任务详情已删除。`www/timeline.js` 对齐 UI-1c 的可读描述 / 原始内容两层展开，保留手机自己的呈现包；原生连接层支持 beforeSeq 和按 seq 读取步骤详情。


S1c-Web 的共享云登录与 QR bundle：根目录 `npm ci`、本目录 `npm ci` 后运行 `npm run build:cloud`。它使用锁定的 jose 6.2.12 / qrcode 1.5.4，将 bundle 与共享 cloud-login.js 同步到桌面和手机静态目录，许可证在 www/licenses/cloud.txt。云登录单测为 `node --test tests/cloud-login.test.mjs`；真实 Chromium 场景由 S1c Web CI 单独运行。新版 UI 的 Android 最低 native code 为 15。
