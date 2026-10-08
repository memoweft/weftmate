# WeftMate 手机界面

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

`npm run build` 只将固定依赖的 `markdown-it`、`DOMPurify`、`highlight.js` 打成 `www/vendor.js`。`www/app.js`、`www/styles.css`、原稿细线 SVG 图标和 W 品牌资源直接由 Android Gradle 的 `assets.srcDir` 收入 APK。包内 `www/licenses/` 保留所用开源库的许可证；图标来自用户指定的 MobileStyle v1.2 原件。

宿主发布使用仓库的 `scripts/build-mobile-ui.mjs`，由主助手在审阅后选择独立输出目录和版本。发布器生成不可变资产与清单，手机对每个文件核对大小和 SHA-256（哈希）后才在私有目录切换。应用页面只从 `https://appassets.androidplatform.net/ui/` 加载；外部网页没有原生桥，业务请求也只允许当前账户宿主的固定业务前缀。

0.8.1 页面使用历史尾页、beforeSeq 和 `shared.sessions.eventDetail`，必须以 `minNativeVersionCode=14` 发布。`scripts/build-mobile-ui.mjs` 默认版本与最低原生版本已同步；旧 code13 及以下继续使用原界面，需要先更新 APK。

## 页面与数据

页面涵盖登录/注册、对话、记忆、能力与扩展、项目与成果、设备、通知、资料、模型、外观、同步和更新。记忆、Mod（能力模块）与电脑项目尚未接入的部分保留真实状态和页面位置，不生成演示条目。聊天 Markdown（结构化文本）先净化再显示；代码块、表格、复制和滚动位置由页面负责，模型请求、手机工具、SQLite（本地数据库）记录与系统通知仍由 Kotlin 执行。

前端只收到当前账户的显示投影。草稿与选中会话按服务来源加 `ownerId` 派生的 scope（归属范围）分开保存；退出后不展示上一个账户的草稿和历史。`host.business` 只可访问已规划的 `/personal/v1/{memory,mods,tasks,notifications,workspaces,capabilities}/` 路由；实际后端未连接时页面显示未接入。账户 Cookie、CSRF 和模型密钥始终留在原生层。

此目录的构建与静态检查不等于 MuMu（安卓模拟器）实屏、真实模型、账户多用户隔离或无重打包更新验收；这些由 Android instrumentation（设备内仪器测试）与主助手管理的隔离宿主分别验证。


历史与执行使用 CLIENT_API 第 3.4 / 4 节：首次读尾页、上滑读更早、正向游标独立；手机执行块默认收起，审批 / 提问 / 成果留在原对话。独立事情页与任务详情已删除。`www/timeline.js` 对齐 UI-1c 的可读描述 / 原始内容两层展开，保留手机自己的呈现包；原生连接层支持 beforeSeq 和按 seq 读取步骤详情。


S1c-Web 的共享云登录与 QR bundle：根目录 `npm ci`、本目录 `npm ci` 后运行 `npm run build:cloud`。它使用锁定的 jose 6.2.12 / qrcode 1.5.4，将 bundle 与共享 cloud-login.js 同步到桌面和手机静态目录，许可证在 www/licenses/cloud.txt。云登录单测为 `node --test tests/cloud-login.test.mjs`；真实 Chromium 场景由 S1c Web CI 单独运行。新版 UI 的 Android 最低 native code 为 15。
