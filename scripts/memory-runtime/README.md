# Windows 记忆组件构建

对应 PLAN 当前清单第 3 项、D106 和 #332 G8。只制备和分发 Windows x64
组件；MEM-AUTO 已接入 Windows 无显式配置时的自动记忆。按本人 2026-10-16 确认的 D110，Windows
构建默认 `full`；仍可显式选择 `base` 单独构建基础候选。出处见
[#332 的总经理转达](https://github.com/memoweft/weftmate/issues/332#issuecomment-6209119265)。

`lock.json` 固定官方 Python 3.13.16 嵌入 ZIP、Core 已合入的
`06205fccfe3530101bf428e90cbef8546812b310` 提交及官方源归档 URL、大小与
散列、Core `uv.lock` 散列、Windows CPython 3.13 对应 wheel、传递依赖、许可、模型
修订及文件散列。基础层是 Python/Core 和 7 个基础依赖；完整层在同一
基础上加入 17 个语义依赖、固定模型/分词器、微软两个必需运行库和许可。
不带开发工具、pip、账户库或用户数据。wheel 的原有许可和元数据保留。

此版本包含 [MemoWeft #140](https://github.com/memoweft/memoweft/pull/140)：形成记忆时区分管理记忆的请求与事实否定，避免把遗忘指令仅处理成旧事实失效；保留同条原话里独立支持的事实。该修复只处理形成子因，不代替真实删除回执；M7 的宿主授权分类修复另见 [WeftMate #602](https://github.com/memoweft/weftmate/pull/602)，最终组合安装场景仍须复验。

此版本包含 [MemoWeft #135](https://github.com/memoweft/memoweft/pull/135)：同账户原话仍在形成记忆时，先阻止可能与其竞争的遗忘；整理结束后须重新预览确认。已经明确覆盖全部在途来源的批量授权仍可原子删除，迟到结果不能恢复已删内容。宿主配套修复已在 [WeftMate #580](https://github.com/memoweft/weftmate/pull/580) 合入；M3/M7 安装版场景留待整体重跑验收。

此版本包含 [MemoWeft #134](https://github.com/memoweft/memoweft/pull/134)：本人偏好纠正尚未形成时，召回可提供完整用户原话；不推断替换关系、不改正式形成规则。宿主投递顺序及遗忘修复另见 WeftMate #563，安装场景仍需两者合入后复验。

此版本还包含 MemoWeft #130 的偏好修订合同和 #131 的派生上下文清理及遗忘范围凭据；宿主须保留预览返回的凭据，不能在删除时静默刷新。

此 Core 版本包含英文召回的真实日期与 `initialize.lang` 支持（MemoWeft #122）；
语言读取和重新初始化规则见 [MEMORY.md](../../docs/MEMORY.md)。
同时接入 MemoWeft #123 的有界响应缓存（最多 128 条、8 MiB Python 对象估算）与
#124 的英文候选打分。8 MiB 仅是历史响应留存预算，不是整个进程的内存上限；
单次查询、模型和向量索引仍有各自工作集。请求 ID 只在缓存窗口内重放；
WeftMate 两个传输入口每次分配新 ID，业务恢复使用边界、命令或形成请求的持久身份。
英文仍有小写功能词歧义的已知漏召回，完整不变量与限制见
[MemoWeft #124](https://github.com/memoweft/memoweft/pull/124)，不代表通用英文质量或安装版验收。
此版本还包含 [MemoWeft #125](https://github.com/memoweft/memoweft/pull/125)：
状态 A→B→A 保留每次变化的独立来源和修订链，长期目标按支持原话的分句白名单形成。
同一分句中的否定、他人主语/所有格及问句不支持本人目标；明确过往意向与同条原话
中的后续本人收回也会拦截，原话仍保留为普通来源。白名单之外的句式、反讽和隐含语义
仍有限制；例如「不打算放弃」也可能触发收回，不代表已解决所有目标理解。

同时包含 [MemoWeft #126](https://github.com/memoweft/memoweft/pull/126)：
助手提出的事实必须得到用户明确确认才可形成记忆；简短的行动确认只能确认
实际选中的行动提议，不能借同轮其他提议把助手的事实陈述写成用户记忆。
未覆盖的确认句式仍有漏形成限制，本次版本更新不替代 M1/M2/M3/M7 安装验收。
包含 [MemoWeft #127](https://github.com/memoweft/memoweft/pull/127) 的跨轮行动确认修复：
简短指回确认须以完整主题和实际动作匹配选中的提议，保留完整原话的否定与问句核对。

## 制备两种载荷

脚本读取并核对 `lock.json` 固定的官方 GitHub 源归档，再解包所需 Python
源码和许可，不读取开发者 Core checkout 或它的未提交内容。构建工具为
仓库锁定的 Node/npm 依赖；7-Zip 复用当前 electron-builder 的固定工具集，
支持归档中的长路径。微软安装器只被解包，绝不执行。

```powershell
npm ci
node scripts/memory-runtime/prepare.mjs --mode base --output .local/memory-base --cache .local/memory-inputs
node scripts/memory-runtime/prepare.mjs --mode full --output .local/memory-full --cache .local/memory-inputs
```

`--output` 必须为空；缓存中的每个输入仍要核对固定散列。构建工具和全部
固定输入已就绪时可加 `--offline`；不另做下载队列、重试或恢复。Core、Python 或
依赖升级要同时更新清单并重新验收，不能只改清单里的显示版本。Core
归档缓存名包含完整提交，命中后仍核对 SHA/大小；成品还核对 Core 提交
和整个固定清单，因此 base/full 都拒绝复用旧 `e86b73ba`、`52952ff0` 载荷。随包版本
与 `observed-core` 保持一致，版本升级遵守 MEMORY.md 的主线首绿规则。

输出直接放入 `resources/memory-runtime/`：

```text
memory-runtime/
  python/                  # 官方解释器、标准库、相对 python313._pth
  core/src/memoweft/        # 固定 Git 源码
  site-packages/           # 固定 wheel，保留许可
  models/                 # 仅 full，Core 固定修订
  licenses/               # Core、模型说明及微软原许可
  runtime-lock.json
  MEMORY-RUNTIME.json     # 平台、层、协议、启动参数、逐文件大小/散列
```

解释器的 `._pth` 只列出随包相对路径，不启用 `site`，忽略系统 Python、
注册表、`PYTHONPATH` 和当前目录。清单中的调用参数为
`python/python.exe -B -m memoweft.integrations.dsh_bridge`；`-B` 禁止在
安装资源内写字节码。MEM-AUTO 必须遵守该调用参数，继续使用现有账户
数据目录，且将 `MEMOWEFT_SEMANTIC_CACHE_DIR` 指向已核验的 `models/`。
本包兼容边界精确固定为 Core 清单提交、`memoweft.dsh_rpc` v2、schema 1。

## 打包入口

候选入口支持独立参数：

```powershell
node scripts/build-windows-candidate.mjs --version 0.1.0-membase.1 --output-dir dist/membase --memory-runtime-mode base --memory-runtime-dir .local/memory-base
node scripts/build-windows-candidate.mjs --version 0.1.0-memfull.1 --output-dir dist/memfull --memory-runtime-mode full --memory-runtime-dir .local/memory-full
```

正式发布入口 `scripts/release/windows.mjs` 和
`scripts/nightly/installed-smoke.mjs` 也接受相同两个参数。现有
`npm run dist`、`dist:win`、`dist:win:feed` 及直接 electron-builder 调用
可通过 `WEFTMATE_MEMORY_RUNTIME_MODE` 与 `WEFTMATE_MEMORY_RUNTIME_DIR`
提供选择和载荷目录。省略层选择时采用 `full`；制备脚本仍要求显式选择，
并且打包时必须提供已制备的载荷目录。

各入口共用 `memory-runtime-package.mjs`。现有 Windows `beforePack`
在复制前核验并补入资源，`afterPack` 在最终资源目录重新核验和运行
离线探针；包检查器再依据 app.asar 中的 `memoryRuntimeMode` 检查完整
文件清单。遗漏目录、层不匹配、版本/散列错误、缺模型或必需 DLL 都失败。
Linux/macOS 的原有打包行为不变。组件沿用本体安装、签名和更新机制。
保留官方 Python 可执行文件的原签名与散列，签名配置只排除
`python.exe` 和 `pythonw.exe`，WeftMate 本体和安装器仍按原流程签名。

## 核验与限制

```powershell
node --test tests/memory-runtime.test.ts tests/windows-package-policy.test.ts tests/verify-windows-package.test.ts
node scripts/memory-runtime/verify.mjs --root .local/memory-full --mode full --probe
```

探针用随包解释器真实导入依赖、核对版本，禁止网络连接；用合成目录
通过独立 Core 进程执行 capabilities、initialize、health、shutdown，
确认数据库实际建立。完整层还用固定模型真实编码出有限的 384 维向量，
确认所需 VC DLL 从随包解释器目录加载。两层都检查不产生字节码。
Windows 工作流分别构建和检查 base/full，并走原有真实程序启动冒烟。

在开发机隔离 PATH/环境并不等于干净系统。发布前仍须在无 Python、
开发工具或额外 VC 的干净 Windows 验证；本包不自动开启 Windows
功能。签名安装、升级、覆盖修复、回滚、卸载保留数据及主路 M1–M7
由后续安装验收包完成。自动接入也不能替代这些安装验收场景。

## 安装版自动接入

Windows 安装版在没有显式记忆配置时，每次从当前安装位置的
`resources/memory-runtime/` 生成内存中的配置，不把自动路径写成用户的
`personalMemoryConfig`。已有文件或命令行配置优先，macOS 保持原行为。
构建时把已核验的清单 SHA-256 写入应用元数据，启动时验证清单和全部文件。
受管解释器仍按 `-B -m memoweft.integrations.dsh_bridge` 启动，完整层模型目录
仅来自核验过的 `models/`。账户数据继续使用用户数据目录下的原有
`personal-access/accounts/<owner>/memory-home/`，组件更新不写入该目录。

记忆推理沿现有本机模型调度入口，跟随账户授权的后台模型，不使用配置里的
占位模型地址发请求。账户权限、来源权限和云/本机目的地分类保持现有规则。
组件缺失或校验失败只停用记忆；解释器或 Core 失败沿原管理器降级，记忆页
提供官网下载修复入口。本机日志只记失败代码，不记原文、文件路径或密钥。

随包进程的重试由原记忆管理器控制，显式配置的策略不变。零重试白名单仅为：

| 阶段 | 零重试白名单 | 判定依据 |
|---|---|---|
| 组件检查 | `MEMORY_COMPONENT_MISSING` | 文件系统返回 `ENOENT` |
| 组件检查 | `MEMORY_COMPONENT_HASH_MISMATCH` | 文件完整读出后 SHA-256 与固定值不符 |
| 启动解释器 | `ENOENT`、`ENOEXEC` | 操作系统明确报告不存在或格式不可执行 |
| Core 初始化 | `invalid_subject_id` | 固定 Core `2112aa8` 的 `py/src/memoweft/integrations/dsh_bridge/protocol_v2.py:134–140,334–336,813–814`：初始化参数标识校验失败；要求匹配的有效协议响应、`ok=false`、请求方法为 `initialize` |

白名单之外一律有限重试，不按 `invalid_` 前缀、有效错误响应或非零退出码推断。
Core 的 `internal_error` 是通用异常兜底（同文件 `823–825`），`dsh_boundary_error`
也未列入白名单；未假设存在独立的配置无效或数据版本不兼容错误码。
`EMFILE`、`EBUSY`、`EACCES`、`EPERM` 等打开、读取、统计异常报告为
`MEMORY_COMPONENT_CHECK_UNAVAILABLE`。解释器权限错误同样可重试；Windows 的
通用 `UNKNOWN/-4094` 无法直接证明原生的可执行格式错误 193，
因此 `UNKNOWN` 不在白名单。未知原因的提前退出、中途断开和超时均最多
自动重试 2 次，共 3 次尝试。
限额按账户保存在本次程序的管理器内，成功启动不会把已用额度归零；到上限
后，状态查询和新来源也不会绕过停止状态。来源仍留在原队列，初始化错误
不会被当成来源冲突而永久阻断。记忆页的“修复记忆”复用原系统修复入口，
先清零失败计数，再核验组件并通过原恢复流程继续处理；重新启动程序也会
清零。组件仍损坏时不执行，保留下载重装入口；未知不可用原因同样有该入口。

修复开始时先作废旧的重试计时器、回调和排队/进行中的启动；等旧进程及其
启动、来源处理退出后，才清零预算并开启新一轮。并发修复共用同一次操作。
代次检查只拦截旧对象发起的新动作；已经发出的请求仍原样返回成功或失败，
并完成日志脱敏、删除清理和来源确认，不因修复开始而丢掉回执。
每个 RPC 对象只拥有一个子进程，断开后不能自行拉起替代进程；所有替代进程
都必须经过管理器的预算和初始化，避免迟到请求绕过次数上限。

许可原文及固定来源见 [NOTICE.md](NOTICE.md) 和 `lock.json`。微软允许
程序目录内分发，但将再分发权限定于有相应 Visual Studio 许可的用户；
发布者仍须确认自身权利。参见[微软官方条件](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files)
与[官方 REDIST 清单](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution)。
Python 的嵌入分发和模块查找行为见[官方说明](https://docs.python.org/3.13/using/windows.html#the-embeddable-package)。

本版本含 MemoWeft #133 的多目标原子遗忘：先收齐所有显式目标的完整修订链和来源，
再在一个事务删除。旧的不完整批量凭据失效，需重新预览确认；单目标凭据不变。
