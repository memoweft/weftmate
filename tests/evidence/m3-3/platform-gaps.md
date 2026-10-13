# M3-3：Mac 从源码作为执行宿主

这台 Mac 已验证：真实 Electron 主进程 → 固定 DSH → 首次引导配置模型 → 主对话流式回复 → 登记可写项目 → 读取合成文件 → 两次真实审批 → 新文件落盘 → 正常退出重开后恢复对话、模型与项目。模型是随机端口的合成 HTTP 服务；当前环境没有 `MIMO_API_KEY`，MiMo 请求 **0**。没有连接生产云、本人 Windows 电脑或真实账号。

`desktop.json` 和 1200 像素宽的浅／深各五张截图属于 **Electron 自身 `webContents.capturePage()`**，不是浏览器替代截图。它们包含应用窗口内容，不包含 macOS 外部标题栏。文件选择使用注入的系统面板返回值；没有把它称为真实系统选择器点击。读取、审批、写入和磁盘 SHA-256 均走实际主进程／DSH。五次失败夹具尝试另存 `trial-*.json/png`，不能当作通过图。

## 平台差异

| 接缝与依据 | 本包开始时／现在在 Mac 的表现 | 需要怎么改或进一步验证 | 本包改了没有 |
|---|---|---|---|
| Node/npm/Electron：`package-lock.json` | Node 24.21.0、npm 11.19.0；`npm ci` 成功，Electron 43.7.8 能打开真实 WeftMate 窗口 | 使用锁文件；不复制 Windows 的 `node_modules` | 已恢复锁定依赖；未改变依赖版本 |
| DSH 固定版本／补丁：`scripts/vendor-dsh.mjs` | 同一 `47f943859bef60e4160492346772ded9b24f765a`、rc.5，加四个随仓补丁；补丁总 SHA-256 `43cad2fa6dbc46c920f0da2e897ea3f27e1b858c5d64ce3853616b0c3db1be22` | 共享对象来源必须是可完整读取的固定提交；部分克隆与本地共享 clone 不兼容。仅 `FETCH_HEAD` 不足以供 clone 选取，需要本地 ref | 没改 pin／补丁／构建器；记录可重放的固定获取命令 |
| 包管理器入口 | 已有 Corepack，但 PATH 没有 `pnpm`；上游 `build:web` 又直接调用 `pnpm`，首次编译在此失败 | 在本包私有目录建立 `exec corepack pnpm` shim，沿上游声明的 `pnpm@11.7.0`；不全局安装 | 本机任务目录内处理，未改系统或共享 DSH 检出 |
| DSH 缓存与闭包 | Mac 缓存是 symlink；197 个清单包中，两个 Linux-only Landlock 包按正式 optional 规则跳过，195 个实际安装包。构建与 `vendor:verify` 全通过 | 依赖缓存按平台生成；不要复制 Windows 的原生二进制。结束后按本机规则清理本包缓存和链接 | 已实建、核验并完成运行；生成物不进 Git |
| 用户数据／安装路径：`main.mjs`、`desktop-config.mjs` | 明确 `--user-data-dir` 的临时独立 profile 正常；安装版 Windows 的 `%APPDATA%`、NSIS 默认路径不能当 Mac 安装方案 | 将来稳定 Mac bundle 使用 macOS 的 Application Support，并验迁移与升级；本包仅源码隔离 profile | 未改变 Windows 路径；没有安装到 Applications |
| 项目根与卷／文件身份：`personal-projects/index.mjs` | 原来拒绝 Mac、只接受盘符和 Win32 final path；现在 Mac 以 POSIX 路径和 `st_dev:st_ino` 保存身份 | Mac 读取器逐级 `openat`／`O_NOFOLLOW`，持有目录和文件句柄，拒绝链接／硬链接，核对版本、UTF-8、分页和完整哈希；外置卷移走／根替换按原身份拒绝 | **已改**。仅 darwin 调用 `reader-posix.py`，用现有 `/usr/bin/python3` 的标准库；Win32 仍是原 PowerShell 程序 |
| 项目持久存储：`personal-access/store.mjs` | 读取器适配后，原存储校验仍把 Mac 路径判为损坏，登记返回 `SERVICE_UNAVAILABLE`；现在登记、权限修订和重开读回通过 | 接受合法 Mac 根记录，继续保留原 Windows 记录校验 | **已改**。只有 darwin 增加 POSIX 根分支；无新 API／字段 |
| 文件夹警示：`personal-projects/folder-choice.mjs` | 原来把 Mac 路径当 Win32 路径；现在 `/`、个人主目录和系统目录的警示正确 | Mac 来源路径用 POSIX 规则；Windows 规则保持 | **已改**。Mac 临时专用目录没有系统目录警示 |
| 文件读取／写入／审批 | `read` 和 `write` 通过真实 DSH 调用；在“每次询问”下出现两次审批，批准前输出不存在，批准后物理字节与哈希正确 | 后续扩大到真实模型、更多文件类型和权限模式；本次系统文件面板为替身 | 已验证；未另造工具或审批系统 |
| 凭据：`config-store.ts`、`credential-vault-document.ts` | 现有生产实现已经调用 Electron `safeStorage`；Mac 加密钥匙由 Keychain 保管，`weftmate-model.enc` 仅存密文；不可用时拒绝保存，不落明文 | 实际登录钥匙串、锁定／解锁、签名升级后读取仍需独立验收 | 生产实现未改；新增随机 AES-256-GCM 的进程内测试替身，不读取登录钥匙串。Playwright Electron loader 自带 mock-keychain，直接启动的测试显式加同一测试参数 |
| 子进程隐藏：`windowsHide` | macOS 忽略 Windows 的 console 隐藏参数；Node／DSH 标准流受管，不弹 Windows 命令窗口 | 终端交互或 GUI 程序的体验需单独验 | 未改；这次没有打开系统终端 |
| DSH 退出：`dsh-web-runtime.ts` | 原来 POSIX 只杀根 PID，后代会残留；现在每个 POSIX carrier 有独立进程组，正常退出／超时／native dispose 后收掉组 | 更广的 Bash／PTY／自行脱离进程组的工作另验，不把普通后代回归扩大成所有 detached job 的证明 | **已改**。Windows `taskkill /T /F` 分支保持；原 POSIX 例外删除，原断言通过 |
| 终端／命令：生成的 `personal-remote` composition | 已有组合在非 Windows 启用原生 `bash`、关闭 `pwsh`；本包主路只实测文件工具 | 脚本插件的后台 job 捕获仍有 `pwsh` 专用判断；Mac Bash 后台、PTY、停止、长任务需后续实测与必要适配 | 未改变工具组合；不宣称 shell／后台工作已经完整验收 |
| 普通右键菜单／快捷键 | 程序内仍是共用对话菜单与设置；Mac 窗口启动、内容和主题通过 | Command 键标示、原生菜单／Dock 体验要做 Mac 精修 | 未做 Mac 专门 UI；原生 Apple 遥控端完全未改 |
| Finder “发送到”：`personal-desktop.mjs` | Windows SendTo／Explorer 注册只在 win32；Mac 不登记、界面能力为不支持 | 若要 Finder Quick Action／分享扩展，单独定产品范围和权限 | 未改，未写系统注册项 |
| 通知：`personal-desktop.mjs` | Electron Notification 能力可查询；Mac 通知权限状态返回未知，打开通知系统设置入口仍仅 Windows。Windows 审批按钮动作也仅 win32 | 真实 Mac 通知身份、系统权限、点击回原对话单独验证 | 未请求权限、未发真实通知、未改系统设置 |
| 开机启动：`desktop-autostart.mjs` | 接口宣称支持 darwin，沿 Electron login-item API；源码 Electron.app 加命令行参数不是稳定的 Mac 安装启动方案 | Mac 稳定 bundle 与安装配置交付后验证；Mac 不应依赖 Windows 的 argv／注册表恢复 | 未实际登记或改变 login item |
| 屏幕／桌面操作与使用时间 | Win32 专用采样不在 Mac 运行；屏幕、应用列表等可能涉及 macOS 权限。当前仅捕获本测试窗口内容 | 单独列 Accessibility／屏幕录制等真实权限场景，由本人决定 | 未新增权限、未读剪贴板／本人文件、未做系统桌面自动化 |
| MemoWeft Python | 系统 Python 3.9.6 不满足 Core `>=3.11`；现有只读检出的 `.venv` 是 3.11.17，`regex`／`httpx` 已齐。实际 Core 形成一条命名记忆，新会话合成 HTTP 回答及 Core 重启召回通过 | 生产须配置有效模型；这次核心解释与回答是合成模型，主路 Electron 走查没有启用记忆 | **修了 Mac venv 解释器 symlink 被配置校验拒绝的问题**；保持 venv 路径以发现其依赖。没安装解释器，没切 Core 分支／改文件 |
| “按意思找”约 135 MB 模型 | 现有 Core HEAD `ddd919d8` 所在 Python 树未提供 `semantic_recall` 实现／依赖；此次没有下载向量模型 | 由 Core 负责人同步提供该功能的版本、固定模型身份／校验和及依赖后再启用；不能只装一个不知版本的向量模型 | 未改外仓／未装模型；基本形成与现有召回不依赖它。主仓较新的即时原话召回测试与此旧 Core 不兼容，保留失败边界 |
| 手机发现／寻址与中继 | 合成云能将同账号登记为唯一 `synthetic-mac`。手机后续结果见 `phone.json`；测试传输仅回环，没有配置生产 relay/frpc | Mac frpc 固定二进制、TLS／中继、跨网络和多电脑寻址由后续包验证 | 云端和手机界面未改；不把回环网页证明当成真实手机／公网验收 |
| 桌面云身份类型：`ui-core/cloud-account.js` | 身份层 desktop 默认类型仍是 `windows`，可以由 environment.deviceType 覆盖；本包未验证真实 Mac 原生云登录的 OS 类型标注 | 由 Mac 原生桥提供类型、保持 Windows 默认，再配合 M3-2 验设备列表 | 未改共享身份层／手机界面；合成 token 夹具不作为原生 Mac 类型证明 |
| 安装／自动更新：`package.json`、`update.ts`、`personal-update/app-rollback.mjs` | Mac target 名义存在，但 Windows NSIS、监护回滚、更新 feed 和发行资源不是 Mac 发行链 | 固定 Mac 运行时、x64／arm64 闭包、签名／公证、稳定数据身份、Mac 更新源与回滚另包 | 完全没打包、签名、公证、更新或部署 |

Electron 对 macOS `safeStorage` 的系统语义见 [官方 API](https://www.electronjs.org/docs/latest/api/safe-storage)。本包通过的是注入保管实现的主路、密文和持久性证据；不是实际 OS Keychain 的读写验收。

## 固定版本的 Mac 获取和启动

以下均在仓库根，源码模式、独立数据目录。构建不改 DSH 主检出，不安装系统包。

```sh
export PATH=$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH
npm ci
mkdir -p .local/mac-desktop-build/bin
# 本机有 Corepack 但无 pnpm 命令；只给本次源码构建使用。
printf '#!/bin/sh\nexec corepack pnpm "$@"\n' > .local/mac-desktop-build/bin/pnpm
chmod 700 .local/mac-desktop-build/bin/pnpm
export PATH="$PWD/.local/mac-desktop-build/bin:$PATH"
pin=$(node -p 'JSON.parse(require("fs").readFileSync("tests/contract/dsh-pin.json")).commit')
git init .local/mac-desktop-build/dsh-source
git -C .local/mac-desktop-build/dsh-source remote add origin https://github.com/deepseek-ai/deepseek-harness.git
git -C .local/mac-desktop-build/dsh-source fetch --depth=1 origin "$pin"
git -C .local/mac-desktop-build/dsh-source update-ref refs/heads/weftmate-pin "$pin"
WEFTMATE_DSH_CHECKOUT="$PWD/.local/mac-desktop-build/dsh-source" \
  WEFTMATE_DSH_CACHE_ROOT="$PWD/.local/mac-desktop-build/cache" \
  WEFTMATE_VENDOR_NODE_HEAP_MB=4096 RAYON_NUM_THREADS=2 UV_THREADPOOL_SIZE=2 \
  npm run vendor:dsh
npm run vendor:verify
```

第一次创建新的源码 profile；已有 profile 不覆盖标记、不删资料：

```sh
node --input-type=module - <<'NODE'
import { mkdir, writeFile } from 'node:fs/promises';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from './src/host-mode.mjs';
await mkdir('.local/mac-desktop-profile', { recursive: true });
await writeFile('.local/mac-desktop-profile/' + PERSONAL_HOST_MARKER,
  JSON.stringify(PERSONAL_HOST_MARKER_CONTENT), { flag: 'wx', mode: 0o600 });
NODE
npm start -- --disable-gpu --disable-gpu-compositing --personal-host \
  --access-port=0 --user-data-dir="$PWD/.local/mac-desktop-profile"
```

正常源码运行使用生产 `safeStorage`，本人首次保存模型时可能出现 Keychain 提示；不要把这里的开发启动与不碰登录钥匙串的测试替身混为一谈。源码还没有可下载 Mac 安装包。测试走查可重放为 `node tests/integration/m3-3-mac-desktop.mjs`；它使用独立合成 profile、随机测试密钥和真实主进程，不调用系统 credential store。

## Mac 安装包下一步

| 项目 | 负责人要准备什么 | 苹果开发者账号能解决什么／仍需开发什么 |
|---|---|---|
| 源码变成 `.app`／DMG／ZIP | 固定 bundle ID、产品名、图标、x64／arm64 构建机和各自固定 DSH 原生闭包；去掉对 `/usr/bin/python3` 的开发依赖或随包提供受控 helper／Python | 本机未公证试用可先做；账号不是依赖闭包、路径和数据迁移的替代 |
| 对外签名、公证 | 本人的 Apple Developer Program 团队、Developer ID Application 证书／私钥、受限公证凭据，放私有 CI secret；本人决定开通和费用 | 可解锁 Developer ID 分发及 Apple 公证；需开发 hardened-runtime／entitlements、嵌套二进制签名、notarytool 与 staple／验签链 |
| Keychain 及资料保留 | 稳定 bundle／签名身份，真实新装、跨版本、移动 `.app`、旧密文读取和回退验收 | 账号提供稳定签名条件；不能仅凭 bundle ID 相同宣称旧钥匙串一定可读 |
| 开机项／Dock／通知 | 稳定安装 `.app` 后本人安排系统权限和真机验收 | 需要平台适配和实际验证；不因拿到账号自动可用 |
| Mac 更新 | 由本人指定 Mac 发布源和发布公钥／私有签名保管；独立 Mac ZIP／签名清单、空闲重启、备份与回退设计 | 程序签名有助于可信安装；当前 Windows NSIS 恢复链不能直接用于 Mac |
| 记忆分发／语义模型 | Core 负责人提供含语义查找的 Python 版本和固定约 135 MB 模型身份、依赖清单；本人决定新增解释器／模型安装 | 与苹果账号无关；本机现有 3.11 venv 已足以通过本包基本记忆桥测试 |

签名／公证要求按 [Apple Developer ID](https://developer.apple.com/developer-id/)、[Apple 公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)核对。未购买账号、没有申请权限，也没有执行这些发行步骤。

手机最终：云登记、网页邮箱验证登录和设备页可见唯一 `synthetic-mac` 通过；绑定后的账户 `/models` 为空，原生测试夹具路线没有发布到该目录，因此没有发送聊天命令。`phone.json` 明确 `connected:true`、`completed:false`。这里尚不能区分夹具准备与模型发布接线的影响，需在同一有窗口 Mac profile 中走原生账户模型保存／云绑定后复核，不改现有权限或 M3-2 所有的寻址逻辑来绕过。
