# 按版本发布更新（D32 / UPD-1）

三层分别使用 `ui`、`app`、`mobile-ui`，版本独立，渠道为 `stable` / `preview`。`ui` 更新桌面呈现与共享功能资源；`app` 更新 Electron（桌面程序框架）主进程与宿主；`mobile-ui` 更新手机网页资源。桌面 `ui` 只包含 `personalAccessUiResources` 的严格白名单，当前没有主进程可热更的提示 / 预设资源。未来增加纯资源时先登记白名单与消费者，主进程代码与原生能力继续通过 `app` 更新。

此包没有配置正式更新源。`package.json` 的 `publish` 仍为 `null`；UPD-3 负责真实上传、Windows（视窗系统）代码签名与发布机密。

## 初次配置发布身份

`src/personal-update/trusted-keys.json` 和 Android（安卓）资产中的副本只存公钥。当前是启动用占位公钥，其私钥没有保存，不能用于正式发布。本人在 UPD-3 私下生成并保管发布密钥，把**公钥**交给以下脚本，再重新发布一次原生安装包以建立可信身份：

```powershell
node scripts/release/trust-key.mjs D:/private/update-public-key.pem
```

脚本拒绝私钥文件。不要把私钥、证书、密码或真实运行目录复制到仓库、输出包和证据中。签名脚本只从 `WEFTMATE_UPDATE_PRIVATE_KEY_PATH` 读取私钥路径；CI（持续集成）从私有机密文件提供它。不提供命令行私钥或把私钥放进清单的入口。

## 发布一个新界面版本

1. 修改源文件，确认桥接与宿主最低版本；改 `src/ui-core/` 后执行 `node apps/mobile-ui/src/build-ui-core.mjs`。按真实窗口 / 手机验证功能。
2. 在进程内设置私钥路径，使用仓库外的发布目录。正式与预览使用不同目录和地址，保留历史版本文件。
3. 创建完整版本和变化文件目录。版本号必须递增，不覆盖已发布的桌面或本体版本。`--previous` 用上一份完整签名清单计算发布差异；客户端仍按自身文件哈希计算实际所需下载。

```powershell
$env:WEFTMATE_UPDATE_PRIVATE_KEY_PATH = 'D:/private/update-private-key.pem'
node scripts/release/package.mjs --layer ui --version 0.2.0 --channel stable --min-app-version 0.1.0 --min-host-version 0.1.0 --output-dir D:/private/update-feed/stable --previous D:/private/previous/manifest-ui.json
node scripts/release/verify.mjs D:/private/update-feed/stable/manifest-ui.json D:/private/update-feed/stable/files/ui/0.2.0 src/personal-update/trusted-keys.json
```

产物：`manifest-ui.json`、`files/ui/<version>/`、`delta/ui/<version>/`、`delta-ui.json`。先上传不可变的 `files/`，最后原子替换清单；`delta/` 用于审查差异和上传规划，不是必须先应用的补丁。保留完整版本，较老客户端也能下载自己需要的文件。清单的 `assetBase` 相对清单地址解析。

客户端使用 `WEFTMATE_UI_UPDATE_FEED=https://<source>/stable/manifest-ui.json`，`WEFTMATE_UPDATE_CHANNEL=stable`。HTTPS（加密网络协议）是正式来源；HTTP（网络协议）只接受本机回环地址。禁用重定向，签名覆盖来源路径、版本、渠道、兼容范围和全部文件。没有来源时显示未配置。

后台每小时检查，也可手动检查。文件只在签名和 SHA-256（文件哈希）均通过后成为待应用版本。窗口下次打开且 DSH（助手运行时）无任务、页面无未发送草稿时切换；后台任务与服务不重启。新页须在所有同步挂载完成后设置 `__WeftUiStarted=true`。导航失败、渲染进程失败、脚本启动异常、超时或进程在启动验证期间退出，均恢复上一完整版本，记录失败版本身份；同一坏版不重复应用。要修复坏版，递增版本重新发布。

## 发布手机界面包

```powershell
node scripts/release/package.mjs --layer mobile-ui --version 0.9.0 --channel stable --min-host-version 0.1.0 --min-native-version 0.8.9 --min-native-version-code 22 --source-dir apps/mobile-ui/www --output-dir D:/private/mobile-ui/stable
node scripts/release/verify.mjs D:/private/mobile-ui/stable/manifest-mobile-ui.json D:/private/mobile-ui/stable/bundles/<asset-index-hash> src/personal-update/trusted-keys.json
```

宿主仍用 `--mobile-ui-dir=<absolute directory>` 提供认证的 `/personal/v1/app/manifest`、`/app/assets/` 和 `/app/updates`。兼容旧发布命令 `scripts/build-mobile-ui.mjs`，它现在也必须提供私钥环境变量；可选 `--channel`、`--min-host-version`、`--min-native-version`。恢复历史发布时使用该脚本的 `--activate-release <version-hash>`，签名与每个文件仍须通过校验。

新清单保留 `schemaVersion=1`、`uiVersion`、`assets`、`minNativeVersionCode`、`entry`、`assetBase`，因此旧壳继续按既有流程读取；它们等于统一字段的对应值并纳入签名。新安卓壳 0.8.9 / code22 在下载与激活前强制验签，按哈希复用内置 / 当前版本文件，在私有目录下载、校验、切换；有任务或草稿时沿用既有暂缓机制。签名与哈希不通过保留当前版；新页面启动失败沿用壳的自动拒绝 / 回退流程。已有旧 unsigned manifest（无签名清单）可继续向旧壳提供，新壳拒绝它并使用内置页；不签名旧包不作为新版发布方案。

Android `stable` 是当前原生壳的默认渠道；独立预览壳用 Gradle（安卓构建工具）参数 `-PweftmateUpdateChannel=preview` 选定同名渠道，不把预览清单发到 stable 来源。更新验签使用 Bouncy Castle（密码库）的轻量 Ed25519（签名算法）实现，不依赖较新 Android 系统才具备的密码提供者。

## 发布程序本体与 blockmap

先按原有打包流程生成有代码签名的 NSIS（Windows 安装包格式）安装包、`.blockmap` 和 `latest.yml`。`nsis.differentialPackage=true`、`disableDifferentialDownload=false` 已接线；保留旧安装包的 blockmap（分块映射），更新服务器支持 HTTP Range（字节范围请求）。让 electron-builder（程序打包工具）生成实际分块，不用自制二进制补丁。

```powershell
node scripts/release/package.mjs --layer app --version 0.2.0 --channel stable --source-dir D:/private/reviewed-installers --output-dir D:/private/app-feed/stable
node scripts/release/verify.mjs D:/private/app-feed/stable/manifest-app.json D:/private/app-feed/stable/files/app/0.2.0 src/personal-update/trusted-keys.json
```

脚本拒绝缺失 `.exe.blockmap` 的 Windows 包，并复制安装包 / blockmap / 更新描述到来源根目录，供 electron-updater（Electron 自动更新组件）读取；统一清单包含每个文件大小与 SHA-256。打包形态配置 `WEFTMATE_UPDATE_FEED` 或既有 `app-update.yml`；使用打包提供者时另设置 `WEFTMATE_APP_MANIFEST_FEED` 为包含 `manifest-app.json` 的根地址。检查时先验签清单，再发现与下载清单授权的版本；下载结束后验安装包哈希，才显示“重启以完成更新”。正常退出不自动安装，任务运行时重启动作拒绝。下载失败保持当前安装；实际原生安装与生产发布源由 UPD-3 验收。

## 关于页接入与验证

`src/ui-core/update.js` 已被桌面、手机加载，提供 `readUpdateState()`、`checkUpdates()`、`restartForUpdate()`、`updateStatusText(layer)`。响应为 `{layers:[{layer,currentVersion,availableVersion,status,error,channel}],canRestart}`。桌面手机包版本的 `scope=host-published` 表示宿主正在提供的版本，设备安装版本由手机原生状态返回。UI-4 合入前不创建另一套关于页面；UI-4 的“关于”注册项绑定上述动作，检查期间轮询状态，只有 `canRestart=true` 才提供本体重启动作。

```powershell
node --test tests/update-manifest.test.ts tests/update-store.test.ts tests/personal-mobile-ui-release.test.ts tests/mobile-ui-core-assets.test.ts
node tests/integration/upd-1-electron.mjs
node tests/integration/upd-1-mobile.mjs --mumu
npm run typecheck
```

真实桌面使用隔离临时 `userData`（用户数据目录）、临时密钥与本地来源；真实 DSH 任务由合成 SSE（服务器推送事件）模型保持运行。手机 Chromium（浏览器引擎）390×844 核签下载与切换；MuMu（安卓模拟器）先检查其他测试包进程，再构建 / 安装独立 `upd1qa` 包，测试后卸载。证据在 `tests/evidence/upd-1/`，测试不触碰日用数据。开发形态只允许本机回环测试源配合 `WEFTMATE_UPDATE_TEST_PUBLIC_KEYS_PATH` 替换测试公钥；打包形态忽略该变量。
