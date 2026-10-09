# 开发环境与运行

旧版（含历史候选环境说明）见 `archive/2026-10-07/SETUP.md`。

## 依赖

- Node 24；`npm ci` 安装依赖。
- `vendor/dsh-runtime` 是受忽略的生成依赖：独立克隆后运行 `npm run vendor:dsh`（需要 pnpm），再用 `npm run vendor:verify` 核对。DSH 版本固定，不自动升级，见 [DSH_UPGRADE_POLICY](DSH_UPGRADE_POLICY.md)。
- 共享 DSH 源码在工作区 `Shared/Dependencies/DeepSeekHarness`（带本地修改）。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm start` | 启动 Electron 桌面应用 |
| `node scripts/run-personal-host.mjs` | 启动个人宿主与 WeftMate 程序窗口；`--user-data-dir` 复用已标记的账户目录，`--access-port` 指定远程网页端口，`--headless` 无窗口运行 |
| `npm run typecheck` | 类型检查 |
| `npm run test:unit` | 单元测试（`tests/*.test.ts`） |
| `npm run test:contract` | 契约测试 |
| `npm run dist:win` | 打 Windows 安装包 |

## Windows 桌面程序（W-1）

`npm start` 默认在同一个 Electron（桌面程序框架）进程中启动个人宿主与 WeftMate 对话窗口。默认数据目录为 `%APPDATA%\com.memoweft.weftmate`；远程网页和程序共用 `src/personal-access-ui/`，桌面窗口使用独立的 persistent session（持久会话），通过已有的本地账号密码登录后记住登录。首次没有账号时，程序使用现有本机原账户设置链接进入密码设置表单，不绕过登录。

复用已有的个人宿主启动方式（必须指定带 `.weftmate-personal-host-profile.json` 标记的目录；测试只使用隔离目录）：

```powershell
node scripts/run-personal-host.mjs --user-data-dir C:\WeftMate-Test\profile --access-port 18080
# 无窗口、无托盘的测试/服务器运行；原有终端管理命令与 q 退出仍可用：
node scripts/run-personal-host.mjs --user-data-dir C:\WeftMate-Test\profile --access-port 18080 --headless
# 启动到托盘；点击托盘或再次启动同一数据目录唤出已有窗口：
node scripts/run-personal-host.mjs --user-data-dir C:\WeftMate-Test\profile --access-port 18080 --start-in-tray
```

未指定接入端口的桌面运行自动选择空闲本机端口。`--headless` 保留未指定端口时禁用个人 HTTP 接入的原有语义。关窗收托盘，托盘「退出」才关闭宿主。窗口大小、位置与最大化状态按数据目录保存；设置中的「开机自启（启动到托盘）」保存当前程序路径、数据目录和宿主参数。开发环境移动仓库或 Electron 路径后应关闭再重新启用该开关。

审批、提问和任务完成通过 Windows Notification（系统通知）提示；点击打开对应对话。成果的「用默认程序打开 / 在文件夹中显示」经 preload（预加载桥）传递成果 ID，主进程使用现有账号授权和校验下载接口导出到该数据目录的 `desktop-artifacts`，再调用系统默认程序或资源管理器。网页不拥有这些原生入口。

旧 DSH 页面只在 `npm start -- --dsh-window` 中显式打开，供运行时设置、模型路由诊断及旧精灵管理使用；它不再是默认界面。桌面精灵仍由托盘唤醒/休息。安装包、快捷方式与开机后的完整安装形态验收属于 W-2。

真实程序验证：在 Windows、依赖与固定 DSH vendor（运行时依赖）就绪后执行 `node tests/integration/personal-desktop-electron.mjs`。它用 Playwright Electron support（Electron 自动化支持）启动程序，使用临时标记目录、合成账号和本机合成模型；截图位于 `tests/evidence/w1/`，通过操作系统窗口捕获包含原生标题栏。测试拦截开机设置注册表写入，避免覆盖本人日用启动项。

## 各端

- Android：[apps/android/README](../apps/android/README.md)
- Apple（macOS / iOS / watchOS）：[apps/apple/README](../apps/apple/README.md)
- 设备与验证环境：[DEVELOPMENT_ENVIRONMENT](DEVELOPMENT_ENVIRONMENT.md)

### 日用 Windows 云账号（UP-2）

计划任务 `WeftMate Personal Host` 使用主仓 `scripts/run-personal-host-task.ps1 -Mode Production`；工作树的改动合入并更新主仓后，在下一次由本人安排的重启生效。此脚本的 Probe（隔离探测）分支保持原样。不要为验证执行 Production，也不要停止日用程序或复制其数据。

Production 只配置以下公开值；账号密码、云令牌、阿里云凭据不在脚本中：

| 环境变量 | 值 / 用途 |
|---|---|
| `WEFTMATE_CLOUD_ISSUER` | `https://api.weftmate.com/personal/v1/cloud/oidc`；宿主验签及桌面云账号请求 |
| `WEFTMATE_CLOUD_DESKTOP_CLIENT_ID` | `weftmate-desktop` |
| `WEFTMATE_CLOUD_DESKTOP_REDIRECT_URI` | `http://127.0.0.1:18186/personal/v1/ui/`；桌面 Code + PKCE（授权码与校验）回调，App（应用）内只解析回调数据 |
| `WEFTMATE_CLOUD_WEB_CLIENT_ID` | `weftmate-desktop`；此部署的 `/cloud/config` 默认值，与桌面一致 |
| `WEFTMATE_RELAY_ENABLED` / `WEFTMATE_RELAY_ACME_ENABLED` | `true`；绑定后开启内容中继、自动证书 |
| `WEFTMATE_ACME_DIRECTORY_URL` | `https://acme-v02.api.letsencrypt.org/directory`；正式证书 |
| `WEFTMATE_FRPC_FILE` | `<主仓>/.local/frp/frp_0.71.0_windows_amd64/frpc.exe`；缺失时使用仓库下载器校验官方包后安装 |
| `WEFTMATE_RELAY_CA_FILE` | `<主仓>/.local/frp/transport-ca.pem`；从 Node（运行时）的公开 CA（证书机构）根证书生成，用于验证外层中继 |

内容证书使用宿主私有默认路径 `<personal-access>/relay-tls/host-fullchain.pem`，私钥和安装身份仍由宿主生成并保存；中继地址及连接凭据由绑定后的云签名接口取得，不需要在电脑上填写云服务器秘密。可选 `WEFTMATE_ACME_EMAIL` 从本人进程环境继承，不写仓库；已有私有证书路径配置仍可通过 `WEFTMATE_RELAY_CERT_FILE` 继承。首次重启前可在主仓运行 `node scripts/download-frp.mjs`，提前完成官方公开依赖安装；否则首次启动需要联网下载。

桌面回调使用字面 `127.0.0.1`、HTTP（网页传输协议）和准确路径，按 [RFC 8252 第 7.3 节](https://www.rfc-editor.org/rfc/rfc8252#section-7.3) 的 loopback（回环）规则登记为 native（原生）公开客户端，无客户端密钥。测试随机宿主端口不会新增生产回调：桌面按照固定配置解析 App 返回的回调数据。这里仅应用回环回调规则，账号交互仍遵循项目 D29 / CLIENT_API 7.8 的 App 内流程，不声称完整采用 RFC 8252 的外部浏览器流程。

旧本地账号应先点「离线使用这台电脑」，以本地账户名和原密码登录，再在「设置 → 账户」点「绑定 WeftMate 账号」。如果离线页已记住一个云账号，可点「使用本地账户登录」显示本地账户名。绑定按钮先认领，再显示现有云账号登录 / 注册页面，绑定成功返回原本地账号设置。不要先在首页直接云登录来迁移旧数据：`/auth/cloud-desktop` 会为新的云身份创建独立账号。远程 `https://home.weftmate.com:8443` 及随机中继地址的浏览器云登录回调未在本包登记；需要另按 CLIENT_API 7.7 登记实际使用地址，不加通配符。本包保留现有 `--public-origin`，不改变日用反向代理。

### 用 MuMu 模拟器验收安卓

本机 MuMu Android 15 的 ADB（安卓调试桥）位于 `D:\Software\MuMuPlayer\nx_main\adb.exe`。本人启动模拟器后连接 `127.0.0.1:7555`；明确指定该序列号，避免操作其他设备：

```powershell
$adb = 'D:\Software\MuMuPlayer\nx_main\adb.exe'
& $adb connect 127.0.0.1:7555
& $adb -s 127.0.0.1:7555 get-state
& $adb -s 127.0.0.1:7555 reverse tcp:18187 tcp:18187
```

只启动隔离宿主与合成账号，监听本机回环 18187。ADB reverse（安卓端口反向映射）后，安卓壳填写 `http://127.0.0.1:18187`；不要把模拟器的回环地址当成 Windows 回环地址，也不要连接日用 Runtime（运行数据）。调试壳允许这一字面回环 HTTP（网页传输协议）地址，正式来源仍要求 HTTPS（加密连接）。

模拟器已有调试应用时，使用独立测试包名保护原有数据，不覆盖或卸载原应用。UI-2v 的构建、真实 `HybridActivity` 操作、`adb exec-out screencap -p` 截图及清理步骤见 [MuMu 验收证据](../tests/evidence/ui-2v/README.md)。软键盘必须同时有实际图像和非零 IME（输入法）区域；MuMu 预装输入法返回零高度时，可使用仅在测试 APK（安卓安装包）中的真实系统输入法服务取证，结束恢复原输入法设置。只卸载本次安装的隔离包、停止隔离宿主，并执行 `reverse --remove tcp:18187`；不运行 `adb reverse --remove-all` 或清空本人应用数据。

## GitHub CI

三平台使用 Node 24 和锁文件安装；生产发布预检、完整依赖高危审计、依赖兼容冒烟、类型检查与必过单测都阻塞合入。普通 `npm test` 仍保留完整单测与 vendor 契约门。

- `.github/scripts/ci-unit-tests.mjs required` 运行必过用例；`known` 单独观察 12 项主干失败（PR #20 的 10 项，以及 CI-1 在未改动 main 上复现的停止回执重试、图片消息原请求重试两项）。该观察步骤非阻塞，同文件里的其他用例仍必须通过。
- 精确文件/用例、原因与追踪项见 [CI 例外清单](../.github/ci-test-exceptions.json)，每次运行也写入 Actions 摘要；不自动把新失败加入清单。
- Linux/macOS 测试目录使用规范化的 `RUNNER_TEMP`；Windows 在系统盘 C: 创建新的完整路径，避开 `RUNNER~1` 短路径并保留 C: 夹具与 D: 仓库的跨盘断言。macOS runner 为合成 HTTP 夹具配置 `127.0.0.2` 回环别名；Linux 使用 Xvfb，并在 Electron 延迟下载完成后配置 `chrome-sandbox` 的 root 属主与 4755 权限。
- `vendor:dsh`、`vendor:verify`、`test:contract` 明确显示为跳过；104 个依赖 vendor 的单测用例及 3 个文件也不验证，另有 1 个文件顶层读取仓库外 `Design`。固定 DSH 来源可以获取，但无所需 `lib/dist`；vendor 脚本只消费外部已编译 checkout，不负责构建。恢复条件：提供与 pin 一致的可重复编译产物，再恢复 workflow 的三个步骤并移除相应例外；发布前仍须在完整环境运行这些门。
- Windows 继续验证进程树清理及 Windows 绝对路径夹具；Linux/macOS 明确跳过这两项。外部平台 optional 包夹具只在非 Linux 验证。POSIX 进程树清理与可移植夹具路径列为后续项。

## 本机数据

账户、会话、模型配置、凭据和运行日志都在仓库外的 `D:\AIProjects\WeftMate\Runtime`（或启动参数指定的数据目录），不进 Git。测试使用隔离的数据目录和测试账号，不碰日用数据。

## 本地模型

本机使用 D:\AI 已有的 ModelSwitcher（模型切换代理），动态入口为 `http://127.0.0.1:8081/v1`。请求的 `model` 决定实际装载模型；代理管理 8080 后端与请求租约。运行参数的唯一来源是仓库外 `D:\AI\Config\*.json`，WeftMate 不启动 llama-server，也不维护模型参数。启动与维护按 D:\AI 的 README 和正式控制脚本执行。

将 `scripts/local-model-endpoint.example.json` 复制到仓库外 `Runtime/LocalModel/config.json`，把占位端口替换为本机入口端口。配置只包含 `baseUrl`、`apiKeyEnv` 和可选的 `restartPath`，没有模型权重、上下文或 GPU（图形处理器）参数。`apiKeyEnv` 指定凭据环境变量名；本机 `MODEL_SWITCH_UNIFIED_KEY` 从 Windows 用户环境读取，仅在进程中使用，不在配置、日志或仓库中保存其值。省略 `restartPath` 时只读状态。

宿主用 `--local-model-config` 接入状态与重启：

```powershell
node scripts/run-personal-host.mjs --user-data-dir <隔离宿主目录> --access-port 0 --local-model-config D:/AIProjects/WeftMate/Runtime/LocalModel/config.json
# 桌面应用可使用同一配置
npm start -- --local-model-config=D:/AIProjects/WeftMate/Runtime/LocalModel/config.json
```

系统状态读取受鉴权的 `GET /switch/status`（当前模型与最近切换）和 `GET /props`（真实 `n_ctx` 与 `total_slots`）；读取失败显示「不可用」，未指定配置或文件不存在显示「尚未配置」。重启调用 `POST /switch/restart`：代理等待现有请求租约结束，再用当前模型在 D:\AI\Config 中的配置调用现有控制脚本，不修改参数、不重启代理。此入口负责选择当前模型的 `launcher_profile`，WeftMate 无需另配脚本路径。完成后宿主重建容量缓存并重新读取 `/props`。实测模型重启约两分钟；系统重启请求使用 6 分钟维护等待窗口，普通请求仍用原有短超时。手机需使用包含此原生网络修正的 APK（安卓安装包）。

设置 → 我的电脑模型使用 8081 动态入口及正式模型 ID（标识）；本包冒烟使用 `qwen3.8-27b-original`。后台模型默认跟随当前对话，可在桌面设置中单独选择；只有本机回环入口且 `/props.total_slots=1` 时按地址排队：主对话整轮（包括工具间隙）优先，标题与记忆推理等待空闲。云 API（应用接口）、多槽或未知槽数服务直接并行。MemoWeft 配置的 `authRef` 可以引用当前账户可见的模型配置，`baseUrl` 填动态入口、`model` 保持 `@current`；实际推理走宿主的共享队列和已授权后台路由。召回只查记忆，不调用模型。Android 0.8.2 / code15 支持手机只读状态与重启请求；发布新 Web UI（网页界面）时使用最低原生版本 15。

## 云服务运维

D1 已部署，复现部署、升级、来源地址配置和证书续期见 [deploy README](../services/cloud/deploy/README.md)。SSH（安全远程登录）别名 `weftmate-cloud` 由本机私有配置管理；地址、邮箱、密钥、密码不写仓库。Node 24.21.0 在 `/opt/weftmate-node`，cloud 发布代码在 `/opt/weftmate-cloud/current`，独立锁定依赖；官方 frp 0.71.0 在 `/opt/weftmate/frp`。

```powershell
ssh weftmate-cloud 'systemctl is-active weftmate-cloud weftmate-frps nginx'
curl.exe -fsS https://api.weftmate.com/healthz
curl.exe -fsS https://api.weftmate.com/personal/v1/cloud/oidc/.well-known/openid-configuration
ssh weftmate-cloud 'journalctl -u weftmate-cloud -u weftmate-frps --since "10 minutes ago" --no-pager'
ssh weftmate-cloud '/root/weftmate-deploy/rollback.sh --dry-run'
# 出现部署引入的旧站点差异，立即恢复 nginx 并停用新增服务，保留数据：
ssh weftmate-cloud '/root/weftmate-deploy/rollback.sh'
```

公网 TCP（传输控制协议）443 由 nginx stream（TCP 流代理）按 SNI（服务器名称指示）分流；旧 HTTPS（加密网页连接）站点在回环9443，PROXY protocol（代理来源协议）保留来源地址。cloud/frps/plugin（授权插件）端口全部私有，80、原有服务、SSH 与防火墙配置保持原样。

私有环境文件 `/etc/weftmate-cloud/cloud.env` 为0600；DynamicUser（动态服务用户）与 StateDirectory（服务数据目录）保存 `/var/lib/weftmate-cloud`，数据库/身份 key/邮件不进发布目录。API 与 relay 的 certbot（自动证书客户端）证书和续期已配置，frps 用 LoadCredential（服务私有凭据）读取私钥快照。基线与备份在 `/root/weftmate-deploy`；完整本地报告在仓库外 `Runtime/Orchestrator/d1.result.md`。

当前邮件为 file transport（文件邮件传输），只写服务器私有 outbox（邮件输出目录），不发信。本人需配置 Resend 私有 key/发件域及 SPF/DKIM（发件来源与签名验证）。三个新 DNS（域名解析）A 记录已就绪；S2b 已实现阿里云 DNS-01 provider 和宿主 Node ACME 自动签发/续期/热载；本人仍需按 deploy README 创建仅限指定 DNS 区增删权限的 RAM 用户、私下填写服务器环境，升级 cloud schema 5 与宿主、开启宿主 ACME。S2b 尚未部署，不能据此声称生产内容证书已就绪。
