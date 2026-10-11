# ROB-1：首次启动中断与系统查询期限

测试使用真实 Electron（桌面运行时）43.7.8、合成资料、合成密钥和测试自行申请的随机端口。没有读取日用资料、访问固定模型端口、接管桌面或调用真实模型。进程原始留证在 `.local/rob-1-processes/`；公开材料只包含文件存在性、大小、修改时间、主密钥字段是否存在、退出码和可读性，不含密钥或密文内容。

## 复现与根因

`before-fix-matrix.json` 使用本分支起点的原始 `config-store.ts`；`after-fix-matrix.json` 使用修复实现。每轮只有一个真实 Electron。`before` 是第一次调用模型凭据加密前；`during` 是临时密文文件写出、替换正式文件前；`after` 是替换正式文件后。已有目录先用同一个运行时正常保存并退出；修后另有旧格式资料升级用例。

修前，全新目录的三种 `after` 都出现：`weftmate-model.enc` 已有完整大小，`Local State` 不存在，重启解密失败。`before` 没有正式密文；`during` 只有临时密文，下次不会当作已提交数据。已有目录正常退出过一次以后，三种方式、三个时机都可读。这定位到 Chromium（浏览器引擎）的本机主密钥尚未持久化，而应用已经提交密文；并非模型凭据索引丢失。本仓库没有单独的密钥索引文件，模型名称与地址在公开设置里，整个 secret map（秘密映射）在一份保管库内。

[Electron 43.7.8 的本机状态实现](https://github.com/electron/electron/blob/v43.7.8/shell/browser/browser_process_impl.cc)在 `PostEarlyInitialization` 从 `sessionData/Local State` 读取偏好，主密钥初始化以后由偏好系统安排写入；`PostMainMessageLoopRun` 才调用 `CommitPendingWrite`。对应的 [safeStorage 实现](https://github.com/electron/electron/blob/v43.7.8/shell/browser/api/electron_api_safe_storage.cc)使用 OSCrypt（操作系统加密层）。源码与文件时序、真实重启失败相互印证。不能把正常退出触发的提交当作崩溃时仍会执行的操作。

三种终止分别为 `process.crash()`、父测试对已创建进程的 `SIGKILL`（强制终止）、`process.reallyExit(73)`（直接结束原生进程）。模拟断电在测试接缝关闭当次临时文件的 `flush`（刷盘）后直接结束，不经过应用退出回调。Electron 会延迟 `process.exit()`，早期试验看到 `during` 后继续走到 `after`；正式矩阵已改用 `reallyExit`，退出阶段可从记录核对。软件测试不声称替代物理断电或磁盘硬件故障测试。

## 修法与影响面

Windows 保留原来的裸 safeStorage 密文字节格式，保证旧程序回退后仍可读取。新增 **只存 DPAPI 包裹主密钥** 的 `weftmate-storage-key.json`，不存模型密钥或明文主密钥。保存前最多等待 15 秒，读取 Chromium 已写出的包裹主密钥，借助 Windows 当前用户的 DPAPI 在私有管道里解包，在内存中验证它确实能认证当前 safeStorage 产生的无秘密探针。原始主密钥缓冲随后清零，子进程原始错误与输出不进入日志。

顺序固定为：验证当前主密钥 → 刷盘 Chromium 的 `Local State` → 临时文件／刷盘／原子替换提交包裹主密钥恢复文件 → 才允许临时文件／刷盘／原子替换提交模型密文。中断在恢复文件持久化之前，应用尚不能写模型密文；中断在后面，恢复材料已存在。系统主密钥不随每次新增／更新模型密钥变化。重启在 Electron 初始化 OSCrypt 之前恢复缺失、损坏或陈旧的 `Local State` 主密钥字段，同时保留其他偏好。修后主动移除合成 `Local State`，验证恢复；随后用旧版真实 safeStorage 读取器验证回退兼容性。恢复材料只用于 Windows；其他平台继续使用原有系统加密后端。

已有目录的系统主密钥已持久化，新增／更新密钥不会重新生成该主密钥。升级首启在首次密文修改前补齐恢复材料；中断有专门的真实 Electron 用例，旧值与新值通过 `revision`（修订结果）区分。若 Windows 用户或 DPAPI 上下文变化引起系统重新生成主密钥，覆盖恢复文件之前还保留旧的受保护材料，不丢掉原密文可能需要的旧包裹主密钥。已不可读的旧密文无法凭空恢复：启动检查先写恢复标记，再保留原始文件为 `.unreadable-<随机编号>`，继续启动；设置复用已有模型行、编辑器和错误提示，显示「需要重新填写密钥」与「重新填写密钥」。固定事件 `host.failure`、错误码 `CREDENTIAL_VAULT_UNREADABLE`，不记录条目材料。

迁移脚本只导入 `desktop-config.json`，沿用原资料目录，不复制保管库，不改变 Windows 用户。源码版迁到安装版的可执行文件路径变化不会改变 DPAPI 的用户绑定。[Microsoft 的 DPAPI 文档](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)说明默认是同一登录用户、通常同一台电脑；本实现使用 `CurrentUser`（当前用户），没有改成机器范围。不能把复制到另一台电脑或换 Windows 用户视为同一种迁移。

对迁移当天：同机同用户、沿用已正常使用的资料目录，不需要先重新填写所有模型密钥。建议安装版验收仍核对模型列表和账户；迁移脚本自身的无期限等待见下表，本包按边界没有改它。

## 外部命令盘点

持续运行的 DSH（助手运行时）、Python（记忆桥）、中继和扩展进程不设置总寿命期限；它们的请求、就绪、验证和停止期限分别列出。下表区分原本有期限、本包补齐以及用户指定只读的脚本。

| 调用点 | 命令／服务 | 期限与失败行为 |
|---|---|---|
| `windows-vault-storage.mjs` 持久化验证 | PowerShell / 当前用户 DPAPI；不使用 WMI | 每次最多 3 秒，整个初始化最多 15 秒；验证不通过则禁止写密文。启动失败记录 `host.failure / CREDENTIAL_STORAGE_NOT_READY`，之后可以重试。没有密钥材料参数或原始命令输出日志。 |
| `main.mjs::readCurrentLocalServiceKey` → `local-service-key.mjs` | PowerShell / `Get-CimInstance Win32_Process`，需要命令行中的密钥 | 新增 5 秒；结束查询进程，提示「系统查询没有响应，稍后再试」；`host.failure / SYSTEM_QUERY_TIMEOUT`，其他失败 `SYSTEM_QUERY_FAILED`。 |
| `app-watchdog.mjs::relevantProcesses` | 改为 PowerShell / `Get-Process`，不依赖 WMI（Windows 管理查询服务） | 5 秒；无法读取候选进程路径也算未知。安装前未知则保持原安装目录和 pending（待处理）状态；回退前未知则停止恢复，不覆盖正在使用的文件。固定 `host.failure / SYSTEM_QUERY_TIMEOUT` 或 `SYSTEM_QUERY_FAILED`。 |
| `app-watchdog.mjs` 停止新版主进程／精确路径进程 | `taskkill.exe /T /F` | 新增每次 5 秒；失败停止恢复，不再忽略；覆盖前再确认进程列表为空。`EXTERNAL_COMMAND_TIMEOUT / EXTERNAL_COMMAND_FAILED`。 |
| `app-watchdog.mjs` 恢复系统版本 | `reg.exe add` | 新增每次 5 秒；保持恢复失败状态和快照，固定外部命令错误码。 |
| `app-watchdog.mjs` 运行安装包 | NSIS（Windows 安装器） | 原有 600 秒；结束安装进程后进入既有恢复流程，恢复仍受进程检查约束。 |
| `app-rollback.mjs` 安装前快照登记信息 | PowerShell / HKCU（当前用户注册表） | 新增 5 秒；记录 `host.failure`，清理本次准备快照，拒绝继续安装。 |
| `personal-desktop.mjs` 通知权限 | PowerShell / HKCU | 新增 5 秒；保留原来 `enabled:null`（状态未知）的界面语义并记录 `host.failure`。 |
| `personal-relay/index.mjs` 中继版本预检 | `frpc -v` | 新增 5 秒；不能确认官方版本则拒绝启动中继，不阻塞无期限。 |
| `personal-relay/tls.mjs` 开发证书 | 两次 `openssl` | 新增每次 30 秒；证书生成失败，不装入未完成证书，走既有中继离线路径。仅开发证书模式。 |
| `local-model-config.mjs::readUserModelSwitcherKey` | PowerShell / 用户环境值 | 原有 10 秒；`LOCAL_MODEL_CREDENTIAL_UNAVAILABLE`，不回传原始命令错误／输出。 |
| `private-host-storage.mjs` | PowerShell / ACL（访问控制列表） | 原有 15 秒；`PRIVATE_STORAGE_UNAVAILABLE`，禁止使用未保护的存储。 |
| `personal-projects/index.mjs` | PowerShell 文件读取器 | 原有 15 秒；结束进程、`PROJECT_READER_TIMEOUT`，不返回不完整文件。 |
| `personal-access/onboarding.mjs` | `arp -a` | 原有 2 秒；局域网发现失败按原空结果处理。 |
| `dsh-web-runtime.ts` | DSH `--dump-config`；`taskkill` | 原有 15 秒预检、5 秒停止；启动另有期限和既有恢复策略。归 BL-29c（对话等待包），未改。 |
| `managed-ai-game-runtime.mjs` | `taskkill` / 受管服务 | 原有 5 秒停止；服务启动与健康查询各有期限。 |
| `personal-memory/rpc.mjs` / `plugins/weftmate-memory.mjs` | Python 常驻进程 | 每个 RPC（进程间请求）有期限；不是等待命令退出才返回。 |
| `runtime/mod-projects/index.mjs` | 扩展常驻进程 | 验证阶段有期限；运行阶段按扩展生命周期管理。 |
| `runtime/weftmod/desktop.mjs` | PowerShell 桌面操作及停止用 `taskkill` | 操作原有 45 秒，但停止进程本身没有期限，等待 `killWork` 可能不收场。归 BL-29c 的 `runtime/**`；本包只报告，建议另修停止接缝。没有运行桌面操作。 |
| `scripts/migrate-installed-desktop.ps1` | `Get-CimInstance`；`taskkill`；`--uninstall-cleanup`；配置导入 Node；NSIS；计划任务系统命令；健康 `Invoke-WebRequest` | 都没有显式期限，安装与清理用了 `-Wait`，健康请求没有 `-TimeoutSec`。按用户边界只读。建议查询／健康 5 秒，清理／配置 30 秒，安装 600 秒；未知进程时保留原任务和资料，不继续删除或切换。 |
| `scripts/nightly/cleanup.ps1` | 两次 CIM 查询 | 无脚本内期限；夜间引擎外层有 15 秒，但 `validate-cleanup.mjs` 的同步调用没有期限。属 NIGHT-3a（夜间维护包），只报告。建议查询 5 秒，未知时不清理。 |
| `scripts/nightly/prune-temp.ps1` | `git worktree list`；CIM 查询 | 无脚本内期限；夜间引擎外层有 600 秒。属 NIGHT-3a，只报告。建议 git（版本管理命令）10 秒、查询 5 秒；任一未知时不删除目录，尤其不能把 CIM 失败的空输出当作没有占用。仓库没有根目录 `prune-temp.ps1`，实际文件在此处。 |

新增日志只调用已有 `host.failure`，`host-log.mjs` 的修改仅为错误码白名单增加六个固定值：`CREDENTIAL_VAULT_UNREADABLE`、`CREDENTIAL_STORAGE_NOT_READY`、`SYSTEM_QUERY_TIMEOUT`、`SYSTEM_QUERY_FAILED`、`EXTERNAL_COMMAND_TIMEOUT`、`EXTERNAL_COMMAND_FAILED`。没有新增日志字段或业务路由。

## 界面和验证

`recovery-ui.json` 与 `models-refill-*.png` 是真实程序的浅深色、1200／480／360／390 宽响应式窗口、编辑器与统一菜单的打开状态。后两者是桌面窗口，**不是手机原生整屏**；没有验收安卓状态栏、底部导航或 Apple（苹果端）系统栏。使用既有模型编辑器和统一菜单；无法读取密钥的行保留一个重新填写主操作，停止使用放入「…」并二次确认。实际重新填写并保存成功，推理请求为零；真实主程序主动丢失 `Local State` 后也能恢复原模型密钥。

`tests/rob-1-electron.test.ts` 纳入完整必过单测，Windows 必须跑真实 3 × 3 中断矩阵和旧格式升级用例；其他系统明确不执行 Windows DPAPI 专属场景。该测试不依赖 vendor（固定运行时构建），因此放 required（必过）组，而不放只有 Linux（另一操作系统）执行的 vendor 工作流。超时、未知进程不得覆盖目录、错误码和资料恢复另有定向单测。完整门、安装版和最终截图的计数见交付报告。
