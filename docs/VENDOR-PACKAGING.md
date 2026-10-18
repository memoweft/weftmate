# DSH 打包事实

本文只记录当前 DSH 打包接缝，不定义产品路线。

## 来源

- DSH 版本由 `tests/contract/dsh-pin.json` 固定；
- 开发环境可以使用指定的 DSH checkout；
- 发布包使用 `vendor/dsh-runtime/` 生成运行时；
- `vendor/dsh-runtime/` 是构建产物，不进入 Git。

## 构建

```powershell
npm run vendor:verify
npm run dist:win

# 可辨识 Windows 候选；输出与暂存都使用明确隔离目录
$candidateVersion = '0.1.0-preview.1'
$candidateRoot = Join-Path 'D:\AIProjects\WeftMate\Runtime\Candidates' $candidateVersion
npm run dist:win:candidate -- `
  --version $candidateVersion `
  --output-dir (Join-Path $candidateRoot 'build') `
  --stage-root (Join-Path $candidateRoot 'staging')
```

- `vendor:dsh` 自动构建固定提交与随仓补丁，并把工作树的 `vendor/dsh-runtime` 联接到共享缓存；缺失、升级固定提交或增删改补丁后运行 `npm run vendor:dsh`；同身份缓存损坏时按下节保留现场并人工挪开；候选构建只校验已有运行时，夜间的 `vendor-tests` 阶段会重建缺失或过期运行时；
- `vendor:verify` 检查版本、文件、依赖闭包和启动行为；
- `dist:win` 把已验证的 DSH 运行时放入 Windows 安装包；
- 所有 electron-builder 入口的共享 `beforePack` 显式应用并核验 [CSR 依赖补丁](../patches/root-csr/README.md)，不依赖 `postinstall`；归档检查再核对实际打进去的依赖完整哈希，未知版本或哈希拒绝构建并要求重新评估补丁；
- `dist:win:candidate` 先验证现有 vendor，再使用无 reparse point（重解析点）的隔离暂存目录构建，并审计安装包闭包、开发机路径、用户数据和凭据文件；
- DSH 版本、脚本版本和依赖闭包必须在每次构建时从当前 pin（固定版本文件）与生成的 manifest（清单）读取；长期文档不保存会过期的 commit、包数量或候选路径。

## 运行

- Electron main 使用 Electron 自带的 Node 启动 DSH；
- DSH 数据位于 WeftMate 的用户数据目录；
- API key 由 Electron `safeStorage` 保存；固定 DSH provider 只通过受管 Node child IPC（Node 子进程进程间通信）按 ref 获取密钥，密钥不进入普通配置、子进程环境、日志或诊断；
- 发布包不能依赖开发机器上的绝对源码路径。

Windows 安装、更新、卸载、数据保留、诊断和恢复的当前边界见 [WINDOWS_RELEASE.md](WINDOWS_RELEASE.md)。

## 当前边界

- Windows 预览版先打包 WeftMate UI 与 DSH；
- MemoWeft 当前只保留开发期试验接缝，不进入正式打包承诺；
- AI-Game 当前不进入 WeftMate 安装包；
- MemoWeft 和 AI-Game 的正式分发方式等待各自提供稳定接口后再确定。

## 随仓库携带的 DSH 补丁（patches/dsh）

发货用的固定 DSH = `tests/contract/dsh-pin.json` 的提交 **加上** `patches/dsh/*.patch`（文件名以固定提交前缀开头）。只按固定提交构建、不打这些补丁，得到的不是产品实际使用的运行时——例如首屏输入区依赖的 `data-weftmate-hero-composer` 布局接缝就来自 `…-stage3-hero-composer-carry.patch`。

- 一条命令：`npm run vendor:dsh`。脚本从 `WEFTMATE_DSH_CHECKOUT` 或本机惯例目录读取包含固定提交的 Git 对象，创建独立 clone（克隆副本），固定检出、按文件名顺序打全部补丁、安装锁定依赖并编译，再装配运行时。主检出的工作区、分支和配置均不改动；不再要求手工先打补丁或编译。
- 升级固定提交时，每个补丁要么已被上游吸收后删除，要么改名为新提交前缀并重新生成；不允许留下打不上的补丁。
- 新增补丁必须同时有一条依赖它的测试（如 `tests/weftmate-conversation-surface.test.ts`），这样漏打补丁会在 vendor 测试里变红。

Windows 新检出应在 checkout（源码检出）前关闭 `core.autocrlf`，保留上游文件与补丁的 LF（单字符换行）。否则 `git apply` 的上下文及上游 `patchedDependencies` 的锁定哈希都可能因换行转换失配。使用检出根声明的 `pnpm@11.7.0`，从该根运行 `corepack pnpm install --frozen-lockfile` 和 `corepack pnpm run build`；在 WeftMate 根加 `--dir` 不保证 Corepack（包管理器版本选择器）先选中上游声明的版本。

脚本在独立 clone 中设置 `core.autocrlf=false`；补丁若被 Windows 检出为 CRLF（双字符换行），仅将送入 `git apply` 与哈希计算的内容转成 LF，不修改仓库补丁文件。`VENDOR-MANIFEST.json.runtimeIdentity` 记录固定提交、版本、排序后的全部补丁文件名与各自 SHA-256（内容哈希），并以文件名和规范化为 LF 后的完整字节计算总补丁哈希；不同工作树的换行配置不会导致重复编译。校验发现缺身份或与当前 pin / 补丁不一致，明确报「运行时过期」，本机 `vendor` 测试失败并提示 `npm run vendor:dsh`；夜间先运行该命令重建。

Windows 缓存默认位于 `D:\AIProjects\WeftMate\Worktrees\_shared\dsh-runtime-<commit12>-<patchhash16>`；可用 `WEFTMATE_DSH_CACHE_ROOT` 指定共享父目录，其它环境默认使用仓库 `.local/dsh-cache`。相同提交与补丁只编译一次，完成装配后才发布缓存，各工作树通过联接复用。构建中的同一身份由相邻 `.lock` 文件互斥；异常中断留下的锁须确认该构建进程已退出后才删除并重跑。正常失败会清理独立构建目录和锁。旧的 `…-p3` 缓存缺少可验证的完整补丁身份，不能凭名字自动认定有效或补签；保留旧目录，运行上述命令生成新缓存并接管工作树 vendor 联接。

## 包内容中的构建身份

`verify-windows-package` 扫描 app.asar（应用归档）及 resources（松散资源目录），包括 `app.asar.unpacked`、DSH 的全部第三方依赖、配置与中继资源。自有代码、WeftMate 插件和配置拒绝任何 Windows 用户目录路径；第三方 `node_modules` 文件只拒绝当前构建机的用户目录、用户名、机器名与构建目录。身份每次从操作系统读取，不存仓库；失败只输出文件和违规类型，成功只输出零命中计数。源码映射、大文本与 UTF-16（双字节文本编码）配置均检查，不用文件白名单。

没有裁剪 node-pty 的 `src/**` 或测试文件：分层检查允许上游作者的示例路径，同时仍检出该文件中夹带的本机身份。另一方案是在暂存时裁剪非运行时文件；node-pty 的 `main` 指向 `lib/index.js`，执行依赖 `lib` 与原生二进制而非 `src`。vendor 清单校验原始 tarball（依赖包归档）的哈希、闭包包集合及入口，所以只裁剪暂存副本不会改动清单哈希；但还需额外维护文件裁剪规则和依赖升级时的运行验证。本次选择保持已验证闭包完整，通过所有运行路径验收分层扫描方案。

暂存排除 hoisted（平铺依赖）布局中的 pnpm 安装状态与缓存元数据：`node_modules/.bin`、`.pnpm`、`.modules.yaml`、`.pnpm-workspace-state-v1.json`。这些文件记录安装机绝对路径；真实入口为 `bin/dsh-web` 与包的 `main/exports`，原生绑定、源码、许可证及整个运行包集合保留。原始 vendor 与 tarball 哈希不改，暂存副本只移除安装管理文件。DSH 随仓库的 portable CSS module IDs（可移植样式模块标识）补丁将虚拟模块标识改成仓库相对路径，读取及 watch（构建变更监听）仍解析回物理源文件；修复编译器在输出注释中泄露绝对目录，新增固定 vendor 测试会拒绝漏打补丁的产物。

缓存校验命中后，工作树指针建立失败直接报告原始错误，不触发编译。取得构建锁后再次校验缓存，若另一构建刚发布则直接复用。同身份缓存一旦存在就保留：校验失败也拒绝删除或重新发布，先由操作者诊断；不会用重建替换其它工作树正在使用的缓存。

## 共享缓存是只读的

已发布的缓存只用于读取、校验和复制。装配与打包暂存各自在本次新建的独立临时目录完成，再整体改名发布；不会在 `vendor/dsh-runtime` 原地执行安装。替换联接或 symbolic link（符号链接）只 `unlink`（解除链接）自身；已有普通目录改名保留为相邻的 `.replaced-<id>`，不自动递归删除。已有指针仍有效时正常命令直接复用，不重建联接。缓存的身份、闭包包版本、包入口和 tarball（依赖包归档）哈希均按清单核对。

独立 cwd（当前目录）本身不足以隔离安装：pnpm 会读取父进程的 `npm_config_modules_dir` 等环境变量及用户 `.npmrc`，相对的安装目录可以越出临时目录、沿联接进入旧缓存并清空其 node_modules。源码安装与运行时安装都以显式命令行选项固定 `modules-dir=node_modules`、本次目录内的 `virtual-store-dir` 和 `lockfile-dir`，并关闭全局安装；这些选项优先于继承配置。

出现「同身份缓存已存在但校验失败；保留缓存，拒绝重新发布」时，先保留日志和目录，确认使用它的构建与程序已停止，由操作者把错误信息中的**准确目录**改名挪开（例如追加 `.damaged-<时间>`），然后重跑 `npm run vendor:dsh` 生成同身份的新缓存。不要对工作树联接执行清空或递归删除，也不要直接在共享缓存里运行 `pnpm install`。中断遗留的构建目录和锁同样先确认属主进程退出；脚本不回收其它运行留下的目录。

隔离试验须同时隔离缓存根与工作树输出；只设缓存根仍会更新当前工作树的 vendor 指针：

```powershell
$probeRoot = Join-Path ([IO.Path]::GetTempPath()) ('weftmate-vendor-probe-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $probeRoot | Out-Null
$env:WEFTMATE_DSH_CACHE_ROOT = Join-Path $probeRoot 'cache'
$env:WEFTMATE_DSH_RUNTIME_DIR = Join-Path $probeRoot 'repo/vendor/dsh-runtime'
try {
  npm run vendor:dsh
} finally {
  Remove-Item Env:WEFTMATE_DSH_CACHE_ROOT
  Remove-Item Env:WEFTMATE_DSH_RUNTIME_DIR
}
```

测试结束后仅处理自己的 `$probeRoot`，保留失败样本供诊断。输出父级或缓存根有联接、输出与缓存根重叠时命令直接失败。递归删除仅允许本次创建的临时目录；清理前核对真实路径、目录身份和归属范围，内部联接逐个解除，不沿联接进入目标。
