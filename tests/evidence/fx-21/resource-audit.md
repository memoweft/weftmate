# 安装版外部资源路径审查

全仓库搜索 `child_process`、`spawn / spawnImpl / execFile / execFileAsync / fork`、`-File`、`.ps1 / .exe / dlopen / fileURLToPath`，逐个区分资源的最终执行者。检查范围包括 `src/`、`runtime/` 和发布暂存 / 包验证脚本；开发、CI（持续集成）与发布脚本不进入应用归档。

| 调用处 | 传给外部进程的资源 | 安装版路径与处理 |
|---|---|---|
| `src/personal-projects/index.mjs` | `reader.ps1` 原先作为 PowerShell（命令解释器）的 `-File` | 本次修复。Electron（桌面程序框架）从 ASAR（应用归档）读入内存，把脚本和 JSON（结构化数据）请求经私有标准输入管道传递；外部进程不再打开归档内路径。真实归档前后测试失败→通过，安装程序项目登记通过。 |
| `src/runtime/weftmod/desktop.mjs` | `desktop.ps1` 的 `-File` | DSH（助手运行时）启动前由 `dsh-web-runtime.ts` 的 `copyDirIfChanged(runtime/weftmod)` 复制到受保护的宿主 `dsh-home/profiles/weftmate/runtime/weftmod/`；真实系统普通文件，执行路径由该已复制模块的 `import.meta.url` 解析。无新解包清单。测试没有操作用户桌面。 |
| `src/dsh-web-runtime.ts` | 固定 DSH 入口、secure snapshot bootstrap（安全快照启动器）、网关、适配器、插件及其资源 | 安装版固定运行时来自 `resources/dsh-runtime` 的 `extraResources`（额外资源）；宿主组件先复制到受保护的宿主普通目录，再交给 Electron 的 Node 模式。B01 和安装冒烟均实际经过此链。 |
| `src/personal-relay/index.mjs`、`sidecar.mjs` | 子进程脚本、`frpc.exe`、配置、CA（证书机构）链 | 脚本由 Electron 的 `ELECTRON_RUN_AS_NODE=1` 执行，支持 ASAR 读取；本机真实打包可执行文件读取归档脚本得到 1033 字节并退出 0；最终包四处归档路径检查见 `packaged-node-paths.json`。frpc / CA 位于 `resources/relay` 普通目录；配置在受保护的私有目录。未连接生产中继。 |
| `src/runtime/mod-projects/index.mjs` | `child-runner.mjs`、项目版本入口 | 模块及 runner（运行器）已由 DSH 部署复制到宿主普通目录；项目版本入口来自已安装 / 校验的项目源目录。运行器不从 ASAR 交给系统 Node。 |
| `src/pets/hatch.ts` | `hatch-mcp-server.mjs` | 使用当前 Electron 可执行文件与 `ELECTRON_RUN_AS_NODE=1`，与中继脚本同一归档读取能力；不交给系统 PowerShell。 |
| `src/personal-update/app-rollback.mjs`、`app-watchdog.mjs` | 监护脚本、物理复制助手、恢复 exe（可执行文件）、已授权安装器 | 更新前从归档读脚本写到私有恢复目录，并物理复制旧程序；监护从独立普通目录启动。已有哈希 / 签名检查及回退测试保留。 |
| `src/personal-memory/rpc.mjs`、`src/plugins/weftmate-memory.mjs` | Python（编程语言）`-m memoweft.integrations.dsh_bridge` | 配置明确指向独立 Core（记忆核心）安装与 Python 路径，未传归档内脚本；本包关闭记忆模型，未改 Core 部署。 |
| `src/managed-ai-game-runtime.mjs` | 已安装游戏运行时入口与工作目录 | 使用安装候选普通目录及已有 manifest（清单）哈希 / PE（Windows 可执行文件）校验；不使用仓库归档内 exe。 |
| `get-windows` 原生依赖 | 需要外部 / 原生按路径加载的本机二进制 | `package.json.build.asarUnpack` 已包含 `node_modules/get-windows/**/*`，发布验证检查物理文件；清单保持。 |
| `src/private-host-storage.mjs`、`personal-desktop.mjs`、`main.mjs` 的系统命令 | ACL（访问控制列表）、系统登记、凭据诊断等内联命令；notepad / taskkill | 系统可执行路径或固定 `-Command` 字符串；没有传仓库脚本路径。系统选择 / 保存对话框用测试替身。 |
| `dsh-view-carrier.mjs` 的 preload（预加载脚本）、UI（用户界面）资源、浏览器资源 | Electron 或 Chromium（浏览器引擎）自身读取的文件 | Electron 的归档文件系统直接读取，非系统外部进程路径；真实安装窗口启动验证。 |

没有发现第二处把仍在 ASAR 内的 PowerShell 脚本直接交给系统 `-File` 的产品运行路径。工具执行用的外部文件全部来自普通资源目录、受保护的宿主部署目录、明确配置的独立依赖目录，或经 Electron 自身的归档支持读取。

安全边界：项目读取器的可执行内容在模块装载时固定，JSON 请求不拼接成代码；无共享临时脚本，外部程序不能通过替换该临时脚本改变执行。程序目录 / 归档自身沿既有发布完整性边界，不引入“同一用户恶意进程无法替换整个应用”的额外承诺。
