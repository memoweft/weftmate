# 环境恢复

先读 [当前状态](CURRENT_STATE.md) 确认当前获授权任务和试用入口。本机保留当前源码和现有依赖，没有执行累计包的源码生成器。下方带日期的记忆/预览启动记录是历史环境说明，不是当前开工指令或自动启动授权；其中 2026-09-08 的“不备份/清理”属于历史授权，不延续本轮。

README、AGENTS、package.json 和 src 同层即主仓库根。只读归位检查：`python scripts/check-project-layout.py`。

后续开发者先核实 package.json、锁文件、tests/contract/dsh-pin.json、vendor 固定依赖及本地修改；不要根据 ZIP 的旧测试记录推断环境。现有命令包括 `npm run typecheck`、`npm run test:unit`、`npm run test:contract`。本机 package.json 没有累计包新增的 test:direction 命令。

vendor/dsh-runtime 是受忽略的生成依赖；独立克隆后须按 scripts/vendor-dsh.mjs 与固定声明恢复，不能把 Shared 中源码存在当成 vendor 可用证明。不得自动升级 DSH。

## 个人宿主与安卓客户端

个人宿主启动器为`node scripts/run-personal-host.mjs`。复用已确认的`--user-data-dir`才会保留原账户和会话；`--access-port`指定回环接入端口，`--public-origin`必须与实际HTTPS来源一致，仅在本机可信反向代理后启用`--trust-loopback-proxy`。启动前先核实该资料是否已有受管实例，避免重复启动；正常退出使用启动器终端的`q`。当前准确目录、端口和进程只看`CURRENT_STATE`。

安卓构建与独立测试见[apps/android/README](../apps/android/README.md)。宿主仅在显式指定`--android-package-path`且固定安装包文件可用时，在已登录账户页面提供下载；下载沿用账户鉴权。用户在原生应用的侧栏底部设置中分别配置电脑账户和对话模型。电脑账户负责身份与同步，当前手机版模型服务需独立配置；不能将账户登录成功视为手机已获得电脑模型。

MuMu开发验证使用明确序列号、隔离账户与仅回环的临时服务；这些地址不填入真实手机。手机使用真实可达的HTTPS服务地址，密码和模型密钥只在应用中输入。原始记录、配置与凭据保留在对应Runtime或手机本机存储，卸载应用会影响其本地资料。

## 历史候选环境说明

隔离试用入口是 dogfood/run.mjs；实际参数、数据目录和停止方式应在 S00-B 核对后准备。开发者负责依赖排错，不要求用户先修环境。模型、手机、账户和私人数据不会因本轮整理自动启用。

手机组件从它的 README 和 docs/COMPONENT 开始；本机保留 AIGame/Repository，脚本和环境仍依赖它。MemoWeft 在自己的独立仓库恢复。

Windows 原生启动与完整退出必须实际验证；macOS 和其他端分别记录。参见 [设备安排](DEVELOPMENT_ENVIRONMENT.md)。一次候选的停止不影响其他现用模型和应用。

本轮候选入口 START_PREVIEW.cmd 使用相邻 Runtime/Preview/user-data。退出用托盘或终端 q；按需查看当前任务卡，不需手工启动 DSH 服务或固定端口。

S03 记忆入口 START_MEMORY_PREVIEW.cmd 使用相邻 Runtime/MemoryPreview/user-data，并读取 Runtime/MemoryPreview/memoweft.local.json 中的本机 Python/源码路径、明确的本地模型地址、模型名和凭据引用。配置不含明文密钥。它与普通预览数据隔离，用于本轮虚构资料试用；不是另一个产品。

S02 已在本机候选中保存指定 Qwen3.8-27B 的本地配置，端点为127.0.0.1:18080。模型服务沿用现有启动器和参数，WeftMate只连接它，退出应用不停止该共享服务；电脑重启后按原模型启动流程恢复。凭据不写进仓库文档。

2026-09-09 S04记忆试用采用用户批准的临时61440上下文。模型启动配置为相邻Runtime/MemoryPreview/model-validation.local.json，继续使用既有WeftLearn/Repository/scripts/Start-Model.ps1；模型和视觉文件、其余参数不变。原WeftLearn/Runtime/config/model.json仍为92160，不要用原配置的运行参数校验结果误判当前临时服务。记忆试用客户端的contextWindow已同步61440；普通Preview配置不变。退出WeftMate仍不停止该独立模型服务。
