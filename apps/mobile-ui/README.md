# WeftMate 手机界面

`www/` 是同一份 Weave 0.2 页面资产：Android APK（安卓安装包）内置它作离线底版，个人宿主的版本发布也只读取这个目录。修改 `www/` 不会自动改变已经安装的底版；经审阅后由宿主发布新界面包，现有 APK 在连接时下载、校验并切换。新增原生能力、权限、数据库或 native bridge（原生连接层）版本仍需更新 APK。

## 开发与打包

```powershell
cd D:/AIProjects/WeftMate/Repository/apps/mobile-ui
npm ci
npm run build
npm run check
```

`npm run build` 只将固定依赖的 `markdown-it`、`DOMPurify`、`highlight.js` 打成 `www/vendor.js`。`www/app.js`、`www/styles.css`、原稿细线 SVG 图标和 W 品牌资源直接由 Android Gradle 的 `assets.srcDir` 收入 APK。包内 `www/licenses/` 保留所用开源库的许可证；图标来自用户指定的 MobileStyle v1.2 原件。

宿主发布使用仓库的 `scripts/build-mobile-ui.mjs`，由主助手在审阅后选择独立输出目录和版本。发布器生成不可变资产与清单，手机对每个文件核对大小和 SHA-256（哈希）后才在私有目录切换。应用页面只从 `https://appassets.androidplatform.net/ui/` 加载；外部网页没有原生桥，业务请求也只允许当前账户宿主的固定业务前缀。

## 页面与数据

页面涵盖登录/注册、对话、事情、记忆、能力与扩展、项目与成果、设备、通知、资料、模型、外观、同步和更新。记忆、Mod（能力模块）与电脑项目尚未接入的部分保留真实状态和页面位置，不生成演示条目。聊天 Markdown（结构化文本）先净化再显示；代码块、表格、复制和滚动位置由页面负责，模型请求、手机工具、SQLite（本地数据库）记录与系统通知仍由 Kotlin 执行。

前端只收到当前账户的显示投影。草稿与选中会话按服务来源加 `ownerId` 派生的 scope（归属范围）分开保存；退出后不展示上一个账户的草稿和历史。`host.business` 只可访问已规划的 `/personal/v1/{memory,mods,tasks,notifications,workspaces,capabilities}/` 路由；实际后端未连接时页面显示未接入。账户 Cookie、CSRF 和模型密钥始终留在原生层。

此目录的构建与静态检查不等于 MuMu（安卓模拟器）实屏、真实模型、账户多用户隔离或无重打包更新验收；这些由 Android instrumentation（设备内仪器测试）与主助手管理的隔离宿主分别验证。
