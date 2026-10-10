# Windows 安装、更新与源码版迁移

R0-1 使用 electron-builder（桌面打包工具）的 NSIS（Windows 安装器）。已有打包链与 electron-updater（自动更新组件）都支持它；按用户安装、分块差分与自定义卸载页可以共用一条链。无需管理员，默认安装到用户程序目录 `%LOCALAPPDATA%\Programs\WeftMate`，拒绝 `/allusers`。开始菜单快捷方式由安装器写入 `AppUserModelID（应用通知身份）=com.memoweft.weftmate`；运行时使用同一身份，通知显示 WeftMate。`register-desktop-identity.ps1` 仅保留给源码开发，不用于安装版。

关窗进入托盘；托盘「退出」才关闭宿主。设置 → 常规的开机自启登记当前安装程序和配置文件，启动到托盘；单实例以数据目录隔离。正常卸载保留数据与配置、移除程序快捷方式和开机项。卸载页默认不勾「同时删除数据」，明确说明对话、记忆和配置会保留；勾选后再次确认，才删除当前配置指定的标记数据目录。静默卸载及升级内部卸载不会删除数据。

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

1. 原计划任务仍运行时做 `Prepare`。脚本只解析原 Production（生产）脚本里的字面值，不执行它；备份原安装配置，写新配置。核对端口18186、原数据路径、public-origin（公开来源）、记忆桥配置、手机包、云 / 中继 / ACME 参数。若本人进程环境使用额外 `WEFTMATE_ACME_EMAIL` / 私有证书路径，私下补到配置或保留本人用户环境，勿写入公开日志。
2. `Apply` 导出原任务 XML（任务定义）到用户私有迁移目录、记录原启用状态、停用并停止原任务，安装按用户的程序，使用新配置启动。同一原数据目录只启动一个宿主。安装失败自动恢复原任务。
3. `Verify` 检查本地端口与公开配置。本人在程序里用旧本地账号登录；核对原对话、记忆；设置 → 系统状态核对宿主 / 记忆桥；通过已登录 `/status` 核对中继在线、证书错误为空、证书到期日合理。再验手机远程内容与 `https://home.weftmate.com:8443`；确认模型正常，不重新绑定或新建空账号来替代原数据。
4. 本人确认上述项目后 `Finalize` 才删除原任务。开机自启由安装版设置管理，确认已启用。原 XML 保留，用于随时回退。
5. 任一步失败，执行一次 `Rollback`：只停止指定安装路径的程序、移除安装版开机项，恢复先前配置与原任务 XML / 启用状态，然后启动原任务。它复用原数据，保留迁移后已写入的对话，不恢复旧数据快照。

```powershell
$migration = 'D:\AIProjects\WeftMate\Worktrees\w4\scripts\migrate-installed-desktop.ps1'
$sourceTask = 'D:\AIProjects\WeftMate\Repository\scripts\run-personal-host-task.ps1'
& $migration -Action Prepare -SourceTaskScript $sourceTask -DataDirectory 'D:\AIProjects\WeftMate\Runtime\UnifiedAssistant\personal-account-20260926'
# 仅在本人迁移窗口执行；Installer 换为已核对哈希的真实发布包。
& $migration -Action Apply -Installer 'D:\WeftMateDownloads\WeftMate-Setup-0.2.0.exe'
& $migration -Action Verify
# 本人完成登录 / 记忆桥 / 中继 / 证书 / 手机验收后：
& $migration -Action Finalize
# 需要回退时：
& $migration -Action Rollback
```

演练命令与结果见 [R0-1 证据](../tests/evidence/r0-1/README.md)。正常启动会更新日志、设备会话、路由和窗口元数据，因此“逐文件哈希一致”在**演练副本恢复之后**验证；报告另列启动期间的新增 / 更改 / 删除数量，不把它写成运行期间零字节变化。原备份在演练前后逐文件一致。离线演练关闭公网来源、云连接、中继、ACME 与记忆推理；真实 Production 记忆桥、中继与证书链路须在迁移当天按第3步验收。

指定备份把 DSH 的生成依赖联接展开成普通目录。演练只在副本中删除 `dsh-home/profiles/node_modules` 这份生成缓存，由 DSH 原生启动器重新生成；原日用迁移的联接会由 DSH 重指向新安装位置。备份文件全部保留，演练最后恢复副本并重新核对每个文件。升级冷备份同时覆盖了实际出现的 Windows 长路径：SQLite 读源和写备份目标使用扩展长度路径，避免超过260字符时启动失败；真实数据库回归见 `tests/backup-windows-long-path.test.ts`。

### FX-15：迁移当天的记忆核对

2026-10-10 的指定备份只读副本核对见 [FX-15 数量证据](../tests/evidence/fx-15/backup-inventory.json)：7 个 Core（记忆核心）SQLite（嵌入式数据库）文件均为 `user_version=20`，`entity / relationship / cognition / world_event` 均为 0 行。2 个账号有规范库，另 5 个文件是同一原账号目录内的非当前库；原账号规范库有 1 条 Evidence（原始证据）、1 条交互上下文、1 个作业及 1 条助手承诺，均不能当成正式记忆。规范路径由宿主确定为 `<dataDirectory>/personal-access/accounts/<ownerId>/memory-home/memoweft/memoweft.sqlite3`；记录的依据归属与账号一致。此结论只覆盖指定备份，未搜索本人其他运行目录。

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

夜间回归的 `installed-smoke` 阶段从当前源码构建独立 `fx21qa` 身份的 NSIS（Windows 安装器），默认启动其 `win-unpacked` 中的真实程序。它使用合成账号、合成模型、随机端口、临时数据；通过真实 `src/main.mjs` 网关创建主会话、添加合成项目文件夹、执行原生文件读取和审批后写入、导出实际主对话记录。系统选择 / 保存对话框只替换返回值，不操作桌面。失败使夜间阶段失败，原始结果在 `installed-smoke/results.json`。

```powershell
# 夜间同一路径：构建后直接验证安装目录，不登记系统安装项。
node scripts/nightly/installed-smoke.mjs --out .local/installed-smoke
# 本机真实安装 / 卸载验收：使用独立身份和临时安装目录。
node scripts/nightly/installed-smoke.mjs --install --out .local/installed-smoke-installed
# 复用已构建的独立测试安装器；不可传本人正式安装器。
node scripts/nightly/installed-smoke.mjs --install --installer <fx21qa安装包绝对路径> --out .local/installed-smoke-installed
```

临时签名私钥在构建结束即删除；程序关闭后卸载测试安装，删除合成数据。`--build-root` 可指定短的私有构建输出路径，`--prebuilt-stage` 可复用已经验证的 DSH（助手运行时）暂存目录，避免重复复制依赖。安装使用 `--updated /S /currentuser` 阻止安装器自行启动默认配置；只由测试运行器用随机端口配置启动程序。

项目读取器直接从应用归档读取脚本到进程内存，通过私有标准输入管道把固定脚本与 JSON（结构化数据）请求分开传给系统 PowerShell（命令解释器）。不解包到应用数据目录，不按用户可替换的脚本路径执行，也不把文件路径或名称拼成可执行命令。应用归档采用与程序代码相同的发布完整性边界；不声称可防止已经能替换整个程序的同一用户恶意进程。
