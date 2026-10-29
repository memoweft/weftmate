# Windows 安装、更新与源码版迁移

R0-1 使用 electron-builder（桌面打包工具）的 NSIS（Windows 安装器）。已有打包链与 electron-updater（自动更新组件）都支持它；按用户安装、分块差分与自定义卸载页可以共用一条链。无需管理员，默认安装到用户程序目录 `%LOCALAPPDATA%\Programs\WeftMate`，拒绝 `/allusers`。开始菜单快捷方式由安装器写入 `AppUserModelID（应用通知身份）=com.memoweft.weftmate`；运行时使用同一身份，通知显示 WeftMate。`register-desktop-identity.ps1` 仅保留给源码开发，不用于安装版。

关窗进入托盘；托盘「退出」才关闭宿主。设置 → 常规的开机自启登记当前安装程序和配置文件，启动到托盘；单实例以数据目录隔离。正常卸载保留数据与配置、移除程序快捷方式和开机项。卸载确认显示当前安装身份配置中的数据目录，明确说明对话、记忆和设置不会删除；安装器不提供删除数据选项。静默卸载及升级内部卸载也保留数据，继续调用 `--uninstall-cleanup`（卸载清理入口）移除开机自启。

## 品牌安装窗口

双击安装包显示单页 WeftMate 窗口：顶部也由品牌绘制层呈现，可拖动，只有关闭按钮，没有最大化或系统标题栏。首次安装显示默认位置与「更改」「安装」；不更改时点一次「安装」即可。更改使用系统文件夹选择器，在所选位置创建 `WeftMate` 子目录；选中的目录本身名为 WeftMate 且为空或已有同身份程序时沿用。安装前检查写入权限、空间、系统／数据目录及既有 NSIS 的路径长度限制，失败留在原页并提示更换位置，不申请管理员权限。没有许可、下一步或完成页。

再次运行安装包会沿用该身份登记的安装位置，跳过位置选择，直接显示「正在更新」，保留原配置与数据并重新打开程序。正在使用这份安装目录的程序仍运行时，交互安装等待本人关闭后点「重试」。卸载只有确认与进度，不提供一键删除数据。进行中的关闭按钮禁用，Alt+F4（关闭快捷键）与 Esc（退出键）也不能中断文件操作；准备安装或确认时可以取消。按钮和文本保留 Windows 标准控件的辅助技术语义与键盘焦点；按窗口像素密度重新绘制字体、图形和布局，Windows 11 使用系统圆角，细描边保证浅深色边界清晰。

`build/installer.nsh` 只替换 NSIS 页面；仍使用 electron-builder 默认脚本及其卸载器生成、安装包大小核验、当前用户登记、快捷方式和差分块图。`scripts/release/installer-assets.cjs` 在 Windows 的 beforePack（打包前钩子）里用 Visual Studio C++ x86（32 位原生编译工具）编译小型 Win32（Windows 原生窗口接口）绘制库；无需额外安装框架或网页运行时。颜色从 `design/tokens/tokens.json` 读取，按系统应用浅深色选择；所有图标继续使用既有九种尺寸的 `build/icon.ico`。需安装 Visual Studio C++ build tools（C++ 构建工具）；Windows CI（持续集成）镜像已具备。生成物留在 `.local/installer-ui/`，不提交二进制。

交互式 NSIS 错误弹窗保留原来的重试／取消返回值，绘制层改为说明磁盘空间、占用与安全软件拦截的排查方法，不展示内部错误码。`/S /currentuser` 与 `/D=<安装目录>`、`--updated`、`/force-run`、签名清单、差分下载和监护进程协议保持原行为。Windows 自己的「未知发布者」与 SmartScreen（下载信誉保护）提示仍由系统显示，本包没有代码签名证书，也不替换或自动点击这些提示。

验收见 [真实安装窗口与合成数据验证](https://github.com/memoweft/weftmate/blob/85321e89888552fb25abe95b0fc8d61f62f2ef5f/tests/evidence/inst-1/README.md)。`tests/inst-1b-interactive.ps1` 使用独立后台桌面，通过窗口句柄取图与向该测试窗口发送按钮消息，不切换本人桌面、不发送全局鼠标键盘。测试包的主题、渲染像素密度和文件夹选择返回值覆盖只在 `--test-identity` 构建中可用，正式包始终读取系统主题。

追加验收还发现了三项现有应用边界，安装界面包未改对应应用文件：含空格的程序路径下，开机自启状态查询可能显示关闭，实际 HKCU（当前用户注册表）启动命令和启动记录正确；主进程正常退出后的短暂进程查询窗口可能让监护保护返回 `SYSTEM_QUERY_FAILED`，全部旧进程消失后重跑原监护脚本才能完成；监护重新启动的测试窗口起初隐藏，后台验收仅在隔离桌面显现它。不能把后两项称为正常更新一次成功。手动安装包覆盖升级仍使用本包的直接启动方式，自动打开由实际窗口验证。自启查询路径按命令行解析的实现见 [Electron Windows 源码](https://raw.githubusercontent.com/electron/electron/v43.7.8/shell/browser/browser_win.cc)，后续修复归应用启动／可靠性工作包。

## 安装版配置

安装版读取 `%APPDATA%\WeftMate\desktop-config.json`，可用 `--desktop-config=<绝对路径>` 指定另一份。账号密码、模型凭据、云令牌与证书私钥继续保存在已有数据目录，不放此文件或仓库。配置中的数据目录必须有既有宿主标记；迁移指向原目录，不复制日用数据。

```json
{
  "schemaVersion": 1,
  "dataDirectory": "D:/WeftMateData/personal-account",
  "accessPort": 18186,
  "publicOrigin": "https://home.weftmate.com:8443",
  "trustLoopbackProxy": true,
  "mobileUiDirectory": "D:/WeftMateData/mobile-ui-releases",
  "personalMemoryConfig": "D:/WeftMateData/personal-memory-config.json",
  "androidPackagePath": "D:/WeftMateData/android-candidate.apk",
  "production": {
    "cloudIssuer": "https://api.weftmate.com/personal/v1/cloud/oidc",
    "cloudDesktopClientId": "weftmate-desktop",
    "cloudDesktopRedirectUri": "http://127.0.0.1:18186/personal/v1/ui/",
    "cloudWebClientId": "weftmate-desktop",
    "relayEnabled": true,
    "acmeEnabled": true,
    "acmeDirectoryUrl": "https://acme-v02.api.letsencrypt.org/directory"
  },
  "updates": {
    "channel": "stable",
    "baseUrl": "https://weftmate.com/updates/windows/x64/"
  }
}
```

可选配置包括 `localModelConfig`、`workspaceDirectory`；`production.acmeEmail`、`production.relayCertFile` 可指向原有私有设置。官方 frpc（中继客户端）0.71.0 与公开 CA（证书机构）根链随安装版打包，运行时不依赖源码目录。内容证书、宿主身份及 ACME（自动证书管理）账号仍在原数据目录。没有 `publicOrigin` 时只监听回环；没有 `updates.baseUrl` 时关闭更新源，适用于离线演练。

首次安装创建默认数据目录与配置，使用生产云客户端和 18186。已有日用宿主仍占用该端口时不会接管它；迁移应先完成下面的停止原任务步骤。日常启动不再需要 Node、npm、Git 或计划任务。

## 三层更新

设置 → 关于显示电脑界面、程序本体和宿主发布的手机界面版本，提供正式 / 预览通道、检查更新、签名清单里的更新内容与「重启并更新」。通道切换只改变以后接受的发布源；当前已验证的界面继续使用，不自动降级。预览选择持久化在配置文件。

- 界面包沿用 UPD-1：验 Ed25519（签名算法）整体清单与兼容范围，复用相同哈希文件、只下载变化文件；下次打开窗口、宿主空闲且无草稿时切换。加载失败或启动确认中断会恢复上一界面。
- 程序本体与宿主一起升级。先验签版本、再用 blockmap（分块映射）与 HTTP Range（字节范围请求）下载变化块，最终核对签名清单中的安装包 SHA-256（文件哈希）。服务端不支持范围或缺旧块图时，electron-updater 会退到完整下载；发布源必须通过范围请求预检。
- 下载不打断任务。安装需要明确点击：检查空闲 → BK-1 在线备份 → 保留上一版程序与更新缓存 → 再检查空闲 → 正常关闭宿主 / DSH（助手运行时）→ 启动静默安装器。可以一直推迟；普通退出不会自动安装。
- 独立监护进程从旧程序副本运行，使用独立的 `WeftMateRecovery.exe` 文件名。旧宿主完成退出后，监护再核对签名清单授权的安装包哈希、执行 NSIS、使用原配置启动新版。安装器最多等待10分钟；安装完成后180秒内没有启动健康确认，则只关闭该安装路径的新版进程，恢复旧程序、缓存及系统卸载登记版本，重新启动原配置，并拒绝再次安装同一坏版本。回退结果在 `%APPDATA%\WeftMate\app-recovery\last-result.json`。程序副本保留在同目录用于人工恢复；本机制不覆盖用户数据，升级前数据备份由 BK-1 管理。新版本的数据格式变更必须维持上一版可读；跨越不兼容数据格式的升级需单独迁移设计。
- 成功更新的业务页面就绪、健康回执写入后，主窗口自动还原并显示到前台一次；不继承更新准备期间的隐藏或最小化状态。普通开机到托盘、后台下载和界面热更新不会因此抢到前台。此行为需要完整程序版本，单发界面包不能修复旧宿主的启动链。
- 安装前把已关闭的旧程序目录移到同级 `.previous-<标识>` 位置，再安装到原路径，避免 NSIS 逐文件卸载时的占用错误。健康确认或成功回退后清理同级旧程序目录；独立的恢复副本仍保留。安装器和新程序不会继承监护的 `ELECTRON_RUN_AS_NODE`，新程序使用原配置文件启动。
- 恢复时优先移走坏程序目录；Windows 开放目录句柄持续阻止移动时，直接在原目录恢复完整的上一版 ASAR 与运行时文件，并恢复缓存中的旧安装器。该路径已通过真实故障包的独立自动回退验收，不需要手工移动目录。
- 云服务是第三层，由服务器发布流程处理；本包不连接生产服务器执行发布。

## 本地发布，暂不上传

版本采用 SemVer（语义化版本）：正式 `X.Y.Z`，预览 `X.Y.Z-preview.N`；同版本内容不可重发。Git 标签是 `vX.Y.Z` 或 `vX.Y.Z-preview.N`。版本通过构建的 `extraMetadata.version` 写入安装程序，不要求改开发用 `package.json`。构建脚本只产出目录，不创建或推送标签。

先在私有位置生成 / 保存 Ed25519 私钥，用 `scripts/release/trust-key.mjs` 同步其**公钥**到各端。当前仓库公钥是 UPD-1 占位身份，其私钥未保存；必须先选定发布身份再发布。Windows 构建强制检查签名私钥对应的公钥已在包内受信列表。测试构建可使用独立临时公钥和 `--test-identity r01qa`，其安装注册、开机项与配置命名空间均隔离。

```powershell
# 私钥只在仓库外；不要在终端打印它。
$env:WEFTMATE_UPDATE_PRIVATE_KEY_PATH = 'D:\WeftMateSecrets\update-ed25519-private.pem'
node scripts/release/trust-key.mjs D:\WeftMateSecrets\update-ed25519-public.pem
node scripts/release/windows.mjs --version 0.2.0-preview.1 --channel preview --output .local\windows-release --notes .local\release-notes.txt
# 正式版：
node scripts/release/windows.mjs --version 0.2.0 --channel stable --output .local\windows-release --notes .local\release-notes.txt
```

脚本验证固定 DSH、打 NSIS 安装包与块图、检查包内路径 / 凭据边界、生成整体签名清单和差异索引。上传树在 `<output>/<version>/upload/`：

```text
updates/windows/x64/stable/            # preview 同构
  manifest-app.json                   # 含版本、兼容范围、哈希、说明、Ed25519 签名
  manifest-ui.json
  latest.yml                          # preview 通道用 preview.yml
  WeftMate-Setup-<version>.exe
  WeftMate-Setup-<version>.exe.blockmap
  files/app/<version>/...
  files/ui/<ui-version>/...
  delta/...
update-public-keys.json                # 公开验收副本，客户端信任来自已安装程序
```

上传时保留上一版 EXE / blockmap，否则首次差分失败。原子替换通道清单，清单禁缓存或短缓存；版本文件可长期缓存。HTTPS（加密传输）、准确 MIME（内容类型）与 Range 206 是源的要求。发布前检查：清单离线验签；最新版本与标签一致；安装包 Authenticode（Windows 程序签名）身份符合选择；旧块图仍在；`Range: bytes=0-1023` 返回 206 与正确 `Content-Range`。由 Claude 与本人确认放置位置和身份后另执行上传，本包没有上传或部署。

## 本人迁移当天

- **MEM-D 记忆摄取**：迁移后确认记忆页与设置中的记忆健康为「正常」、outbox（持久待提交队列）无积压，再引导本人决定是否点击「整理过去的对话」。先核对会话数、回合数与预计模型用量；本人确认后才补整理，默认不自动运行。临时回合、已关闭记忆的对话和已遗忘来源排除；暂停／取消只停止尚未提交的回合。


先由 Claude 审查本包并确认发布身份、安装包哈希。以下脚本只在本人安排迁移时执行；本包没有执行日用任务的停止、删除、启动或原数据写入。

1. 原计划任务仍运行时做 `Prepare`。用 `-RuntimeDirectory` 传入原任务实际使用的绝对运行目录；旧部署脚本里已有明确 `$runtime` 字面值时仍可读取它。脚本只解析原 Production（生产）脚本里的配置，不执行它；备份原安装配置，写新配置。核对端口18186、原数据路径、public-origin（公开来源）、记忆桥配置、手机包、云 / 中继 / ACME 参数。若本人进程环境使用额外 `WEFTMATE_ACME_EMAIL` / 私有证书路径，私下补到配置或保留本人用户环境，勿写入公开日志。
2. `Apply` 导出原任务 XML（任务定义）到用户私有迁移目录、记录原启用状态、停用并停止原任务，安装按用户的程序，使用新配置启动。同一原数据目录只启动一个宿主。安装失败自动恢复原任务。
3. `Verify` 检查本地端口与公开配置。AUTH-1 版本在本机原生窗口直接进入原账户，不要求云/本地密码；核对原对话、记忆和模型设置、原激活云绑定；在设置按需云登录，再核对手机远程；设置 → 系统状态核对宿主 / 记忆桥；通过已登录 `/status` 核对中继在线、证书错误为空、证书到期日合理。再验手机远程内容与 `https://home.weftmate.com:8443`；确认模型正常，不重新绑定或新建空账号来替代原数据。
4. 本人确认上述项目后 `Finalize` 才删除原任务。开机自启由安装版设置管理，确认已启用。原 XML 保留，用于随时回退。
5. 任一步失败，执行一次 `Rollback`：只停止指定安装路径的程序、移除安装版开机项，恢复先前配置与原任务 XML / 启用状态，然后启动原任务。它复用原数据，保留迁移后已写入的对话，不恢复旧数据快照。

```powershell
# 在已核对的源码仓库中运行；目录来自原部署配置，不是新的默认值。
$migration = (Resolve-Path './scripts/migrate-installed-desktop.ps1').Path
$sourceTask = (Resolve-Path './scripts/run-personal-host-task.ps1').Path
$runtimeDirectory = Read-Host '原任务实际使用的绝对运行目录'
$dataDirectory = Read-Host '原数据的绝对目录'
& $migration -Action Prepare -SourceTaskScript $sourceTask -RuntimeDirectory $runtimeDirectory -DataDirectory $dataDirectory
# 仅在本人迁移窗口执行；Installer 换为已核对哈希的真实发布包。
$installer = Read-Host '已核对哈希的安装包绝对路径'
& $migration -Action Apply -Installer $installer
& $migration -Action Verify
# 本人完成登录 / 记忆桥 / 中继 / 证书 / 手机验收后：
& $migration -Action Finalize
# 需要回退时：
& $migration -Action Rollback
```

演练命令与结果见 [R0-1 证据](https://github.com/memoweft/weftmate/blob/85321e89888552fb25abe95b0fc8d61f62f2ef5f/tests/evidence/r0-1/README.md)。正常启动会更新日志、设备会话、路由和窗口元数据，因此“逐文件哈希一致”在**演练副本恢复之后**验证；报告另列启动期间的新增 / 更改 / 删除数量，不把它写成运行期间零字节变化。原备份在演练前后逐文件一致。离线演练关闭公网来源、云连接、中继、ACME 与记忆推理；真实 Production 记忆桥、中继与证书链路须在迁移当天按第3步验收。

自定义安装位置不改变数据目录。迁移脚本保持原样：已有自定义安装登记时，在 `Prepare`、`Apply`、`Verify`、`Finalize` 或 `Rollback` 的每次调用均传 `-InstalledExe <自定义位置\WeftMate.exe>`；不能只在 Prepare 指定一次。Apply 的静默安装沿用已有登记的位置，未登记的首次静默安装默认仍在用户程序目录。

指定备份把 DSH 的生成依赖联接展开成普通目录。演练只在副本中删除 `dsh-home/profiles/node_modules` 这份生成缓存，由 DSH 原生启动器重新生成；原日用迁移的联接会由 DSH 重指向新安装位置。备份文件全部保留，演练最后恢复副本并重新核对每个文件。升级冷备份同时覆盖了实际出现的 Windows 长路径：SQLite 读源和写备份目标使用扩展长度路径，避免超过260字符时启动失败；真实数据库回归见 `tests/backup-windows-long-path.test.ts`。

### FX-15：迁移当天的记忆核对

2026-10-10 的指定备份只读副本核对见 [FX-15 数量证据](https://github.com/memoweft/weftmate/blob/85321e89888552fb25abe95b0fc8d61f62f2ef5f/tests/evidence/fx-15/backup-inventory.json)：7 个 Core（记忆核心）SQLite（嵌入式数据库）文件均为 `user_version=20`，`entity / relationship / cognition / world_event` 均为 0 行。2 个账号有规范库，另 5 个文件是同一原账号目录内的非当前库；原账号规范库有 1 条 Evidence（原始证据）、1 条交互上下文、1 个作业及 1 条助手承诺，均不能当成正式记忆。规范路径由宿主确定为 `<dataDirectory>/personal-access/accounts/<ownerId>/memory-home/memoweft/memoweft.sqlite3`；记录的依据归属与账号一致。此结论只覆盖指定备份，未搜索本人其他运行目录。

- 切换前，用当天备份运行 `python tests/integration/fx15-memory-inventory.py <备份路径> --output <私有数量报告路径>`，核对每个账号的规范库、表行数与归属布尔值；工具只读复制、排除依赖和密钥库，结束自动删除副本，不导出姓名、账号标识或原文。不要把本次 0 行当成迁移当天应有的固定值。
- 指定备份没有可迁移的旧版正式记忆，也没有账号映射错位证据，因此 FX-15 不增加转换、清库或回填步骤，不改 `migrate-installed-desktop.ps1`。如果本人预期这里应有旧记忆，应先确认另一个明确授权的数据源；不要让安装程序凭猜测创建或合并记忆空间。
- 登录同一旧账号后逐类核对记忆页数量；`200 + 0` 与 `503` 分开记录。后者是不可用，不等于 0。副本中其他三个账号的底层错误均为 `MEMORY_MODEL_UNAVAILABLE`：两个账号没有可用模型，另一个有私有模型但后台选择不可用；仅补合成凭据仍503，再选可用后台模型后三类均200且0条。其他账号还需核对可用模型、后台模型选择和该账号的凭据；桥进程的启动依赖已授权模型路由。隔离诊断只使用合成凭据，不能证明日用模型凭据可用。
- 安装后与回退后分别对照迁移前数量。若当天非零，应在迁移窗口用正式 Core 查询／备份工具取得前后数量与内容摘要哈希；不把指定空库的历史演练称为非空记忆迁移验收。Verify（迁移验证）的匿名请求修复归 FX-14。

## Windows 代码签名

本包不购买证书，不保存签名私钥，也没有替 Windows 建立测试信任根。Ed25519 清单保证更新内容来自受信发布者；Windows SmartScreen（下载信誉保护）依赖 Authenticode 与文件 / 发布者信誉，两者分工不同。

微软公开资料给出的费用级别：Azure Artifact Signing（云签名服务，旧称 Trusted Signing）约 **9.99美元/月**，个人目前限美国 / 加拿大，组织限美国 / 加拿大 / 欧盟 / 英国；传统 OV（组织验证）证书约 **150–300美元/年**，私钥需要硬件令牌或 HSM（硬件安全模块）；EV（扩展验证）通常 **400美元/年以上**，自2024年起也不保证初次发布绕过 SmartScreen。中国身份应先询问 CA 的主体认证与硬件 / 云签名支持，不先购买。实际报价、身份支持、税费与令牌成本以供应商为准。[微软代码签名选项](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)

签名流水线需要固定发布者身份、证书链到 Windows 受信 CA、SHA-256 签名与可信时间戳，以及只在本人或 CI（持续集成）机密环境可用的硬件 / 云签名凭据。electron-builder 可接 Azure 签名配置或 `signtoolOptions`；本包使用未签名测试包。签名新文件仍可能出现信誉提示，不能承诺签名即消除警告。[微软 SmartScreen 信誉说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

未签名安装包通常显示未知发布者和“Windows 已保护你的电脑”；受管理电脑或 Smart App Control（智能应用控制）可能直接阻止。过渡期只交付官方来源的有限试用包，同时提供完整 SHA-256 与公开构建版本；用户自行核对来源后，若系统允许，可选择“更多信息 → 仍要运行”。不关闭安全保护、不自动点击安全提示、不把自签证书作为面向公众的替代。准备向其他用户正式分发前，优先解决可信签名身份。


## 安装目录冒烟回归

`npm run release:preflight` 是 dependency preflight（依赖预检）：只检查根依赖清单没有本地 `file:` 引用、生产依赖没有高危安全公告。通过不表示 vendor（固定运行时）、安装包、包内容、签名或程序启动通过；控制台与普通 CI（持续集成）步骤名称明确这一边界。跨平台单测前的依赖检查保留轻量，Windows 的真实打包由独立强制检查负责。

桌面原生依赖 get-windows 使用 N-API 9（跨 Node 版本的原生接口）预构建文件，`npm ci` 安装它；Electron 打包不再重复本地重编译。上游加载器只从 `lib/binding/napi-9-win32-unknown-x64/node-get-windows.node` 加载，`build/**` 的链接器中间文件不进入包。本地重编译会把工作目录写进中间文件及 `.node` 的 PDB（原生调试数据库）位置，因此仅排除 `.exp` 不能解决问题。依赖安装拿不到预构建文件而回退本地编译时，包身份检查仍会拒绝携带本机构建路径的二进制；不能把检查关闭来发布。

每个 PR（拉取请求）与 main 推送都会运行 [Windows package and startup smoke](../.github/workflows/windows-package.yml)：检出生产固定 DSH，应用随仓库补丁并编译，装配及验证 vendor，然后打完整 NSIS（Windows 安装器）与 `win-unpacked`，检查包内容并启动真实程序完成下列五项合成冒烟。编译缓存按 Windows、Node 24、固定提交与补丁哈希隔离，缓存命中仍重新连接锁定依赖、装配及验证。打包、检查与启动失败均阻断；只缓存保存容错，不让缓存优化隐藏产品错误。无真实模型请求、不注册系统安装项、不上传安装器，临时私钥在构建结束删除；只上传已移除本机身份的冒烟报告与截图，保存七天。任务上限30分钟，与普通测试并行，不串行增加原任务耗时。实测冷启动与缓存用时见本包 PR；不是依靠本机夜间任务发现打包回归。

夜间回归的 `installed-smoke` 阶段从当前源码构建独立 `fx21qa` 身份的 NSIS（Windows 安装器），默认启动其 `win-unpacked` 中的真实程序。它使用合成账号、合成模型、随机端口、临时数据；通过真实 `src/main.mjs` 网关创建主会话、添加合成项目文件夹、执行原生文件读取和审批后写入、导出实际主对话记录。系统选择 / 保存对话框只替换返回值，不操作桌面。失败使夜间阶段失败，原始结果在 `installed-smoke/results.json`。

交互检查由 `migration-host.mjs` 显示它创建的独立窗口；托盘启动会让原生可见性把界面切到后台并暂停读取，即使 Playwright 仍能找到并点击第一张审批卡。`tests/second-approval.test.ts` 从托盘启动真实程序，验证窗口显示后，读取和写入两张审批卡依次可点、两条审批均完成，写入内容正确。

```powershell
# 夜间同一路径：构建后直接验证安装目录，不登记系统安装项。
node scripts/nightly/installed-smoke.mjs --out .local/installed-smoke
# 本机真实安装 / 卸载验收：使用独立身份和临时安装目录。
node scripts/nightly/installed-smoke.mjs --install --out .local/installed-smoke-installed
# 复用已构建的独立测试安装器；不可传本人正式安装器。
node scripts/nightly/installed-smoke.mjs --install --installer <fx21qa安装包绝对路径> --out .local/installed-smoke-installed
```

临时签名私钥在构建结束即删除；程序关闭后卸载测试安装，删除合成数据。`--build-root` 可指定短的私有构建输出路径，`--prebuilt-stage` 可复用已经验证的 DSH（助手运行时）暂存目录，避免重复复制依赖。安装使用 `--updated /S /currentuser` 阻止安装器自行启动默认配置；只由测试运行器用随机端口配置启动程序。

多个包并行验收时使用 `--test-identity <合成标识>`，隔离安装注册、快捷方式及程序身份；复用 `--installer` 时传同一标识。FX-23 使用 `fx23qa`，默认夜间身份仍为 `fx21qa`。真实安装验收检查该身份的 HKCU（当前用户注册表）卸载登记存在，卸载后检查程序文件及该登记均消失。默认冒烟也加载真实程序里的 get-windows 原生绑定，但不读取本人其他窗口或接管桌面。`results.json` 保存五项结果、构建与场景秒数、包身份零命中计数；写入时将本机身份替换成公共占位名。

运行器构建同时传 `--isolate-test-executable true`，程序文件名为 `WeftMate-<合成标识>.exe`。这隔离 NSIS 在 PowerShell（脚本环境）策略受限时按文件名查找进程的回退路径；仅隔离安装登记仍可能关闭另一个目录的同名测试程序。正式程序文件名保持 `WeftMate.exe`；卸载清理使用 NSIS 的 `APP_EXECUTABLE_FILENAME`，测试程序也能调用自身完成清理。安装／卸载与 `win-unpacked` 验收顺序运行，不同时启动同一测试身份。

Windows 的运行器与普通 CI 夹具一样，在系统盘根创建随机命名、完成即删除的隔离临时目录。账户／数据／项目都在这个临时根下；原生路径先规范化，报告中的临时根用 `%TEMP%` 占位。文件夹确认页显示真实选中路径，所以不能用带个人用户名的默认 TEMP（系统临时目录）直接生成公开截图；不是在截图上遮盖或修改内容。其他迁移助手调用保留自己的临时根，也可显式传入 `tempRoot`。

项目读取器直接从应用归档读取脚本到进程内存，通过私有标准输入管道把固定脚本与 JSON（结构化数据）请求分开传给系统 PowerShell（命令解释器）。不解包到应用数据目录，不按用户可替换的脚本路径执行，也不把文件路径或名称拼成可执行命令。应用归档采用与程序代码相同的发布完整性边界；不声称可防止已经能替换整个程序的同一用户恶意进程。


## 本机运行诊断

程序退出与崩溃诊断见 [运行记录说明](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/DIAGNOSTICS.md)。安装版使用配置的 `dataDirectory/logs` 与 `dataDirectory/Crashpad`，原生转储仅本地保存、关闭上传；普通卸载保留，明确删除数据时一起清除。安装目录冒烟同时检查真实日志、转储路径、上传开关与正常退出记录。BK-1（个人备份）当前会包含 `logs/`、排除 `Crashpad/`；建议单独调整备份排除范围，本包未改该产品选择。

追加验收还发现了三项现有应用边界，安装界面包未改对应应用文件：含空格的程序路径下，开机自启状态查询可能显示关闭，实际 HKCU（当前用户注册表）启动命令和启动记录正确；主进程正常退出后的短暂进程查询窗口可能让监护保护返回 `SYSTEM_QUERY_FAILED`，全部旧进程消失后重跑原监护脚本才能完成；监护重新启动的测试窗口起初隐藏，后台验收仅在隔离桌面显现它。不能把后两项称为正常更新一次成功。手动安装包覆盖升级仍使用本包的直接启动方式，自动打开由实际窗口验证。自启查询路径按命令行解析的实现见 [Electron Windows 源码](https://raw.githubusercontent.com/electron/electron/v43.7.8/shell/browser/browser_win.cc)，后续修复归应用启动／可靠性工作包。
## 安装、移动位置与正常退出（INST-2）

Windows 安装仍使用 NSIS（Windows 安装引擎）与既有卸载登记。`/S` 或 `--silent` 表示静默：新装使用默认位置，覆盖沿用已有登记的位置与安装范围；`/currentuser`、`/allusers` 可明确选择范围。`/D=<绝对路径>` 已由上游支持，必须位于最后且整段不再额外包引号；含中文与空格的路径同样适用。

从 PowerShell（Windows 命令解释器）或原生进程参数调用 `/S`。Git Bash（Git 自带命令解释器）的 MSYS（Windows 上的类 Unix 环境）可能把 `/S` 转成 `S:/`，从而启动交互安装；本机参数探针已复现。此环境使用 `--silent`，或先设置 `MSYS_NO_PATHCONV=1` 再传标准 `/S` 与 `/D`。preview.4 的构建记录包含品牌安装脚本，源码的自绘初始化与位置页已有静默判断；没有证据表明它们忽略了真实的 `/S`。本包同时保护上游无条件 `BringToFront`（窗口前置）入口，静默过程不调用绘制、提示或提权窗口。

交互安装完成后自动打开程序；静默安装默认不打开，显式 `--launch` 才打开。应用内当前用户更新仍由既有监护重新启动，并传原 `--desktop-config`，安装器本身不抢先打开默认配置。

所有用户安装必须已具有管理员令牌。静默运行拿不到权限时退出码为 **740**，在 `%TEMP%/<应用名>-setup.log` 追加 `ADMIN_REQUIRED` 一行，不请求交互提权。程序退出未完成返回 **3**，安装或旧版卸载失败返回 **2**，另一个安装器在运行返回 **1638**，静默模式下不支持的系统／架构返回 **1633**；错误均写一行日志，不强制结束程序。正常交互安装未获得管理员权限也可从普通权限终端选择当前用户安装；需要改变已有所有用户安装时，从管理员终端运行安装包。

`WeftMate.exe --quit` 通过 Electron（桌面程序框架）的单实例通道请正在运行的程序停止接收新工作、保存并正常退出。可附 `--desktop-config=<原配置>` 或 `--user-data-dir=<原数据目录>` 定位自定义启动配置。等待最多20秒：正常退出或没有运行实例返回0；等待超时返回3；通道或保存收尾失败返回4。命令不会强杀进程、创建窗口或改写正在运行的启动记录。安装与卸载先调用同一路径，再等待辅助进程退出；没有此命令的旧版仍须从托盘“退出”，静默安装请不动旧版就失败，不强杀。

重装时可在品牌位置页更改目录；当前用户与所有用户之间的转换由原 NSIS 卸载流程清理旧目录、旧范围登记和快捷方式。安装末尾重新登记右键入口、更新已有开机启动命令的可执行路径并保留原配置参数；禁用的自启不会被开启。程序每次启动再检查一次：已有自启命令指向不存在的旧程序时修复，查询或写入失败不阻止启动。实际安装范围写入程序目录的 `resources/weftmate-install.json`；更新位置始终从当前 `process.execPath` 取得，不缓存旧位置。

所有用户范围下，程序仍核验并下载新版，在“关于”显示“新版已下载”和“打开安装包”，不尝试用普通权限移动受保护的安装树。迁移这一次：先退出 WeftMate，打开已下载安装包所在文件夹，右键安装包选择“以管理员身份运行”，同意一次管理员授权（需使用原来的 Windows 账号）。安装器会移除旧整机程序与登记，再安装为仅当前用户使用，默认目标为用户程序目录；即使这一次安装器有管理员权限，也不会把新安装写成整机范围。`%APPDATA%\WeftMate\desktop-config.json` 和其指向的数据目录保持不变，不复制或删除对话、记忆、模型配置；正常卸载旧程序也保留数据。装完自动打开，此后从新用户安装更新无需管理员授权。历史安装缺少范围文件时按精确安装目录匹配 HKLM（系统级注册表）卸载登记。当前用户范围继续自动监护与恢复，关闭检测会忽略已确认退出的进程，而仍存活但无法读取路径的进程保持查询失败。

全新 Windows 配置按安装版本选择通道：`X.Y.Z-preview.N` 为预览，`X.Y.Z` 为正式；已有通道选择保持不变。通道清单返回 404（尚未发布版本）时显示“这个通道暂时没有新版本”；资源文件缺失仍报下载失败。发现新版后后台下载，窗口顶部安静显示进度，点提示可到“关于”查看并选择“重启并更新”。监护安装结束后用原配置重新打开窗口，显示“已更新到 X”。程序本体升级会撤销旧本体的界面包试用状态；回退出错只回到内置界面，不阻断启动。这些改动需要发布新版程序本体，不能仅发布界面包。

测试身份的安装包使用 `--test-identity inst2qa --isolate-test-executable true`；默认安装目录也带测试身份，避免默认路径碰到正式安装。需要核对桌面快捷方式时再带 `--test-desktop-shortcut true`，其余测试默认不创建桌面快捷方式。实际验证结果与管理员环境限制见 `tests/evidence/inst-2/README.md`。

监护传给 NSIS 的 `/D` 使用原样的末尾参数：Node（运行环境）的默认命令行编码会给含空格的整个 `/D=…` 加引号，违反安装引擎约定；监护现在只为安装器执行路径加引号，目标位置保留完整尾部。关闭检测还会等待最多5秒的已识别辅助进程退出；真正未知的查询仍直接失败，保持原安装树，并尝试用原配置重新打开旧程序。
监护系统查询固定输出 UTF-8（字符编码）。从无控制台的程序启动 Windows PowerShell（Windows 命令解释器）时，其默认代码页可能不能与 Node（运行环境）的UTF-8读取一致；退出瞬间返回一条中文路径就会校验失败，而再次查询已无该进程时得到空数组，从而出现“第一次失败、重跑通过”。固定回归用系统936代码页与中文执行路径复现旧失败，修后保留原路径，不把真正未知的进程放行。

首次监护的持续阻塞另有已确认根因：监护继承旧程序的 `CHROME_CRASHPAD_PIPE_NAME`，自身连到旧 Crashpad（崩溃记录）处理进程，导致主进程已经正常结束，但该处理进程仍持有旧程序文件。`crash-handler-before-fix.json` 保存了实际进程分类与父进程关系。现在仅从独立监护的环境移除崩溃处理管道及服务器变量，正常程序仍启用原来的本地崩溃记录。Electron（桌面程序框架）的 Node模式会初始化崩溃记录，Windows 子进程按继承的管道连接处理器，见 [固定版本 Node启动源码](https://raw.githubusercontent.com/electron/electron/v43.7.8/shell/app/node_main.cc) 与 [Chromium管道继承源码](https://raw.githubusercontent.com/chromium/chromium/main/components/crash/core/app/crashpad_win.cc)。
