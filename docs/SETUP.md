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
| `node scripts/run-personal-host.mjs` | 启动个人宿主（`/personal/v1`）；`--user-data-dir` 复用已有账户数据，`--access-port` 指定端口 |
| `npm run typecheck` | 类型检查 |
| `npm run test:unit` | 单元测试（`tests/*.test.ts`） |
| `npm run test:contract` | 契约测试 |
| `npm run dist:win` | 打 Windows 安装包 |

## 各端

- Android：[apps/android/README](../apps/android/README.md)
- Apple（macOS / iOS / watchOS）：[apps/apple/README](../apps/apple/README.md)
- 设备与验证环境：[DEVELOPMENT_ENVIRONMENT](DEVELOPMENT_ENVIRONMENT.md)

## GitHub CI

三平台使用 Node 24 和锁文件安装；生产发布预检、完整依赖高危审计、依赖兼容冒烟、类型检查与必过单测都阻塞合入。普通 `npm test` 仍保留完整单测与 vendor 契约门。

- `.github/scripts/ci-unit-tests.mjs required` 运行必过用例；`known` 单独观察 13 项主干失败（PR #20 的 11 项，以及 CI-1 在未改动 main 上复现的停止回执重试、图片消息原请求重试两项）。该观察步骤非阻塞，同文件里的其他用例仍必须通过。
- 精确文件/用例、原因与追踪项见 [CI 例外清单](../.github/ci-test-exceptions.json)，每次运行也写入 Actions 摘要；不自动把新失败加入清单。
- Linux/macOS 测试目录使用规范化的 `RUNNER_TEMP`；Windows 在系统盘 C: 创建新的完整路径，避开 `RUNNER~1` 短路径并保留 C: 夹具与 D: 仓库的跨盘断言。macOS runner 为合成 HTTP 夹具配置 `127.0.0.2` 回环别名；Linux 使用 Xvfb，并在 Electron 延迟下载完成后配置 `chrome-sandbox` 的 root 属主与 4755 权限。
- `vendor:dsh`、`vendor:verify`、`test:contract` 明确显示为跳过；103 个依赖 vendor 的单测用例及 3 个文件也不验证，另有 1 个文件顶层读取仓库外 `Design`。固定 DSH 来源可以获取，但无所需 `lib/dist`；vendor 脚本只消费外部已编译 checkout，不负责构建。恢复条件：提供与 pin 一致的可重复编译产物，再恢复 workflow 的三个步骤并移除相应例外；发布前仍须在完整环境运行这些门。
- Windows 继续验证进程树清理，Linux/macOS 明确跳过此项；记忆路由夹具现使用隔离临时路径，在三平台验证。外部平台 optional（可选依赖）包夹具只在非 Linux 验证。POSIX 进程树清理仍是后续项。

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

当前邮件为 file transport（文件邮件传输），只写服务器私有 outbox（邮件输出目录），不发信。本人需配置 Resend 私有 key/发件域及 SPF/DKIM（发件来源与签名验证）。三个新 DNS（域名解析）A 记录已就绪；生产宿主内容证书仍需实现阿里云 DNS-01（DNS TXT 证书验证）provider（服务商适配器），本人把仅限 DNS 的 RAM 子账号凭据放服务器，再接宿主 CSR（证书签名请求）定时签发/安装/热载。仅加入 RAM 环境变量不会自动启用 provider。
