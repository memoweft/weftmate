# ROB-1：首次启动中断与系统查询期限

测试使用真实 Electron（桌面运行时）43.7.8、合成资料、合成密钥和测试自行申请的随机端口。没有读取日用资料、访问固定模型端口、接管桌面或调用真实模型。进程原始留证在 `.local/rob-1-processes/`；公开材料只包含文件存在性、大小、修改时间、主密钥字段是否存在、退出码和可读性，不含密钥或密文内容。

## 复现与根因

`before-fix-matrix.json` 使用本分支起点的原始 `config-store.ts`；`after-fix-matrix.json` 使用修复实现。每轮只有一个真实 Electron。`before` 是第一次调用模型凭据加密前；`during` 是临时密文文件写出、替换正式文件前；`after` 是替换正式文件后。已有目录先用同一个运行时正常保存并退出；修后另有旧格式资料升级用例。

修前，全新目录的三种 `after` 都出现：`weftmate-model.enc` 已有完整大小，`Local State` 不存在，重启解密失败。`before` 没有正式密文；`during` 只有临时密文，下次不会当作已提交数据。已有目录正常退出过一次以后，三种方式、三个时机都可读。这定位到 Chromium（浏览器引擎）的本机主密钥尚未持久化，而应用已经提交密文；并非模型凭据索引丢失。本仓库没有单独的密钥索引文件，模型名称与地址在公开设置里，整个 secret map（秘密映射）在一份保管库内。

[Electron 43.7.8 的本机状态实现](https://github.com/electron/electron/blob/v43.7.8/shell/browser/browser_process_impl.cc)在 `PostEarlyInitialization` 从 `sessionData/Local State` 读取偏好，主密钥初始化以后由偏好系统安排写入；`PostMainMessageLoopRun` 才调用 `CommitPendingWrite`。对应的 [safeStorage 实现](https://github.com/electron/electron/blob/v43.7.8/shell/browser/api/electron_api_safe_storage.cc)使用 OSCrypt（操作系统加密层）。源码与文件时序、真实重启失败相互印证。不能把正常退出触发的提交当作崩溃时仍会执行的操作。

三种终止分别为 `process.crash()`、父测试对已创建进程的 `SIGKILL`（强制终止）、`process.reallyExit(73)`（直接结束原生进程）。模拟断电在测试接缝关闭当次临时文件的 `flush`（刷盘）后直接结束，不经过应用退出回调。Electron 会延迟 `process.exit()`，早期试验看到 `during` 后继续走到 `after`；正式矩阵已改用 `reallyExit`，退出阶段可从记录核对。软件测试不声称替代物理断电或磁盘硬件故障测试。

## ROB-1b 审查返工

| 项目 | 审查的数字 | 现在的数字 | 同脚本与固定回归 |
|---|---|---|---|
| M1 备份恢复冲突 | 3/3 覆盖正确主密钥，本次审查再1/1 | 0/1 覆盖；原状态与密文保留、同次读取与重启可读；旧备份附件未落地 | 附录A `confirm.mjs` / `probe.cjs`，`review-confirm.json`；固定 `rob-1-review-confirm.mjs` |
| M2 暂时解密故障 | 两种各3/3永久隔离，本次再各1/1 | 两种各0/1隔离；同次重试与重启各2/2可读 | 同附录A；`tests/rob-1-electron.test.ts` |
| S1 超时孙进程 | 3/3残留 | 0/3残留，后置清理0 | 附录B `commands.mjs`，`review-commands.json`；固定 `rob-1-command-probe.mjs` |
| S2 成功查询3/6/8秒 | 1/3成功，6/8秒被5秒期限拒绝 | 3/3成功 | 同附录B；`tests/rob-1-timeouts.test.ts` |

删除 `readWrappedStorageKey()`、`persistWrappedStorageKey()`、`restoreVaultLocalState()`、`credentialRecoveryRequired()` 及主程序恢复接线。不再生成、读取或轮换 `weftmate-storage-key.json*`；不写恢复标记，不在启动时改名密文。残留旧文件原地忽略，个人备份排除 `*.enc.*`、`.replaced-*`、旧恢复文件；备份列表、导入与恢复的完整性验证接受旧备份的这些附件，仍验证全部字节和完整哈希；提取与恢复跳过这些附件，不落地。

最终写入顺序：safeStorage（本机加密存储）生成无秘密探针；最多15秒等待磁盘 `Local State`（本机状态文件）的主密钥能在内存中认证该探针；对浏览器内核已经写出的文件刷盘；然后才开放密文写门。解包仅经私有标准输入／输出管道，主密钥返回缓冲与验证明文用完清零，不写文件。普通密文和事务回滚仍使用唯一临时文件、刷盘、原子替换。等不到时不写密文，返回可重试的 `CREDENTIAL_STORAGE_NOT_READY`，模型表单保留输入与原请求编号。

启动读不出时，原文件原路径、原字节不变，程序继续启动，只把状态记在内存里。每次需要凭据都重新读取，不缓存失败；暂时故障过去以后，原值自动恢复可读。模型设置显示「密钥暂时读不出」，提供小重试图标和「重新填写」；停止使用仍在统一菜单。只有使用者输入并提交新的密钥，当前读取仍失败且新值能安全加密时，才把旧文件留为 `.replaced-<时间>` 并提交新密文；提交失败恢复原路径，成功后只留最近一份。固定 `host.failure`（宿主失败记录）与 `CREDENTIAL_VAULT_UNREADABLE` 同次运行只记一次，不写永久损坏标记。

设计变更对应的测试预期（不是放宽断言）：

1. 原恢复单测由“改写陈旧/缺失状态并轮换恢复文件”改为“就绪超时不写任何状态、密文或残留恢复文件”，另保留半写／替换失败原文不变断言。
2. 27格中断的“没提交或完整可读”断言不变，旧资料9格与旧版本读取9次不变。主动删除 `Local State` 后的9次改成读不出、原密文原地不动、没有隔离或恢复标记、明确重新填写后可读且旧字节留存。
3. 实际程序界面由启动恢复／自动隔离改为当前读不出／可重试／保存后才留存旧字节；新增头部与关闭入口滚到底仍可见、底部留白至少16px的断言。
4. 安装版强杀后重启保留已落盘的 `Local State`，仍要求原凭据可读；主动删状态的行为在矩阵单独验证，不再要求安装版重建主密钥。

崩溃临时文件清理只匹配本模块 `weftmate-model.enc.<pid>.<UUID>.tmp`，只删超过一小时的普通文件，不跟随链接，不清其它模块或新文件。原恢复在单实例锁之前改写状态的并发风险随整个机制删除；没有新增跨进程恢复锁或审计层。

## 外部命令盘点

持续运行的 DSH（助手运行时）、Python（记忆桥）、中继和扩展进程不设置总寿命期限；它们的请求、就绪、验证和停止期限分别列出。下表区分原本有期限、本包补齐以及用户指定只读的脚本。

| 调用点 | 命令／服务 | 期限与失败行为 |
|---|---|---|
| `windows-vault-storage.mjs` 持久化验证 | PowerShell / 当前用户 DPAPI；不使用 WMI | 每次最多3秒，整个就绪门最多15秒；验证不通过则禁止写密文。启动失败记录 `host.failure / CREDENTIAL_STORAGE_NOT_READY`，之后可以重试。没有密钥材料参数或原始命令输出日志。 |
| `main.mjs::readCurrentLocalServiceKey` → `local-service-key.mjs` | PowerShell / `Get-CimInstance Win32_Process`，需要命令行中的密钥 | 新增 5 秒；结束整棵查询进程树，提示「系统查询没有响应，稍后再试」；`host.failure / SYSTEM_QUERY_TIMEOUT`，其他失败 `SYSTEM_QUERY_FAILED`。 |
| `app-watchdog.mjs::relevantProcesses` | 改为 PowerShell / `Get-Process`，不依赖 WMI（Windows 管理查询服务） | 15 秒；无法读取候选进程路径也算未知。安装前未知则保持原安装目录和 pending（待处理）状态；回退前未知则停止恢复，不覆盖正在使用的文件。固定 `host.failure / SYSTEM_QUERY_TIMEOUT` 或 `SYSTEM_QUERY_FAILED`。 |
| `app-watchdog.mjs` 停止新版主进程／精确路径进程 | `taskkill.exe /T /F` | 每次5秒；失败停止恢复，不再忽略；覆盖前再确认进程列表为空。`EXTERNAL_COMMAND_TIMEOUT / EXTERNAL_COMMAND_FAILED`。 |
| `app-watchdog.mjs` 恢复系统版本 | `reg.exe add` | 每次15秒；保持恢复失败状态和快照，固定外部命令错误码。 |
| `app-watchdog.mjs` 运行安装包 | NSIS（Windows 安装器） | 原有 600 秒；结束安装进程后进入既有恢复流程，恢复仍受进程检查约束。 |
| `app-rollback.mjs` 安装前快照登记信息 | PowerShell / HKCU（当前用户注册表） | 15秒；记录 `host.failure`，清理本次准备快照，拒绝继续安装。 |
| `personal-desktop.mjs` 通知权限 | PowerShell / HKCU | 新增 5 秒；保留原来 `enabled:null`（状态未知）的界面语义并记录 `host.failure`。 |
| `personal-relay/index.mjs` 中继版本预检 | `frpc -v` | 15秒；不能确认官方版本则拒绝启动中继，不阻塞无期限。 |
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

日志只调用已有 `host.failure`；原ROB-1增加的六个固定值继续使用，本轮未改 `host-log.mjs` 或 `host-diagnostics.mjs`：`CREDENTIAL_VAULT_UNREADABLE`、`CREDENTIAL_STORAGE_NOT_READY`、`SYSTEM_QUERY_TIMEOUT`、`SYSTEM_QUERY_FAILED`、`EXTERNAL_COMMAND_TIMEOUT`、`EXTERNAL_COMMAND_FAILED`。没有新增日志字段或业务路由。

## 界面和验证

`recovery-ui.json` 与 `models-refill-*.png` 是真实程序浅深色、1200／480／360／390宽的列表、菜单与编辑器打开状态。360窗口高度780，390高度844，全部只是桌面响应式窗口；S4手机原生系统栏整屏证据按本轮边界不做，未冒充验收。编辑器头部和底部操作栏固定，只有正文滚动；沿用现有控件、设计令牌、浅深色与焦点样式。没有新业务路由、安卓版本或壳能力。

`rob-1-electron.test.ts` 纳入 Windows required（完整必过单测），包括27格中断、旧状态主动删除9次的新设计、旧版读取9次、审查三条固定回归及明确重新填写的加密失败／提交失败／一份旧字节留存检查。`rob-1-storage.test.ts` 验证主密钥等待失败原文不动、陈旧临时文件范围、ENOSPC（空间不足）与EACCES（权限失败）原子替换失败。备份分别有新快照排除和旧备份跳过测试。超时固定回归保留进程状态未知时不覆盖安装目录的断言。

云端旧红灯的项目读取路径是 `personal-projects/index.mjs::invoke()` 自己的15秒计时器，不调用 `boundedCommand()`；旧附件记录 `PROJECT_READER_TIMEOUT` 后，安装冒烟外层45秒等待报 `MIGRATION_SMOKE_TIMEOUT`。附件没有 `SYSTEM_QUERY_TIMEOUT` 或 `EXTERNAL_COMMAND_TIMEOUT`。本包没有修改项目读取器、迁移脚本或共享 vendor（固定运行时构建）；最新云端结果在交付报告更新。

## 最终验证

| 检查 | 本地结果 |
|---|---|
| required（完整必过单测） | 283文件，1508通过／0失败／14既有条件跳过；第二轮24分46秒 |
| vendor（固定运行时集成） | 29文件，204通过／0失败／0跳过 |
| 手机交互组 | 五文件109通过／0失败，51共享资源已生成 |
| 备份最终入口复验 | 25通过／0失败；旧附件的前置验证和列表可选性也已断言 |
| 类型检查／公开身份 | 通过／零命中 |
| rob1qa最新打包版本 | 构建、身份五类边界零命中、七项冒烟通过；未系统注册安装 |
| 最新安装版首次强杀后重启 | 原密钥可读；主密钥保留、不重建；真实模型请求0 |

第一轮required有一个测试进程 `personal-artifact-task.test.ts` 以 `0xC0000409` 退出，没有断言失败；原文件单独8/8通过，完整第二轮0失败，未改该文件。首次安装强杀的Node（JavaScript运行时）运行器也出现一次同退出码；单独重跑与最新打包版本复验通过。没有将这些观测归因于某个未验证的系统原因。

完整required和vendor通过后，备份完整性验证的默认行为补齐为接受并跳过旧存储附件；备份全25项随后0失败，并以最新源码重建安装版、复验冒烟和首次强杀。最新云端完整检查另在交付报告记录。`validation.json` 留有逐次重活名额及起止时间，均单次不足30分钟。
