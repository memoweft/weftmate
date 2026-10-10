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

- `vendor:dsh` 只在 vendor 缺失、损坏或固定 DSH 版本被产品所有者明确升级时手动运行；候选构建不会隐式重建 vendor；
- `vendor:verify` 检查版本、文件、依赖闭包和启动行为；
- `dist:win` 把已验证的 DSH 运行时放入 Windows 安装包；
- `dist:win:candidate` 先验证现有 vendor，再使用无 reparse point（重解析点）的隔离暂存目录构建，并审计安装包闭包、开发机路径、用户数据和凭据文件；
- DSH 版本、脚本版本和依赖闭包必须在每次构建时从当前 pin（固定版本文件）与生成的 manifest（清单）读取；长期文档不保存会过期的 commit、包数量或候选路径。

## 运行

- Electron main 使用 Electron 自带的 Node 启动 DSH；
- DSH 数据位于 WeftMate 的用户数据目录；
- API key 由 Electron `safeStorage` 保存；固定 DSH provider 只通过受管 Node child IPC（Node 子进程进程间通信）按 ref 获取密钥，密钥不进入普通配置、子进程环境、日志或诊断；
- 发布包不能依赖开发机器上的绝对源码路径。

Windows 安装、更新、卸载、数据保留、诊断和恢复的当前边界见 [WINDOWS-PREVIEW.md](archive/2026-10-07/WINDOWS-PREVIEW.md)。

## 当前边界

- Windows 预览版先打包 WeftMate UI 与 DSH；
- MemoWeft 当前只保留开发期试验接缝，不进入正式打包承诺；
- AI-Game 当前不进入 WeftMate 安装包；
- MemoWeft 和 AI-Game 的正式分发方式等待各自提供稳定接口后再确定。

## 随仓库携带的 DSH 补丁（patches/dsh）

发货用的固定 DSH = `tests/contract/dsh-pin.json` 的提交 **加上** `patches/dsh/*.patch`（文件名以固定提交前缀开头）。只按固定提交构建、不打这些补丁，得到的不是产品实际使用的运行时——例如首屏输入区依赖的 `data-weftmate-hero-composer` 布局接缝就来自 `…-stage3-hero-composer-carry.patch`。

- 构建 vendor 前，在 DSH 检出目录按文件名顺序执行 `git apply patches/dsh/*.patch`，再编译、再 `npm run vendor:dsh`。云端的「Pinned DSH vendor unit tests」就是这样做的，并把补丁内容的哈希计入编译缓存键。
- 升级固定提交时，每个补丁要么已被上游吸收后删除，要么改名为新提交前缀并重新生成；不允许留下打不上的补丁。
- 新增补丁必须同时有一条依赖它的测试（如 `tests/weftmate-conversation-surface.test.ts`），这样漏打补丁会在 vendor 测试里变红。

Windows 新检出应在 checkout（源码检出）前关闭 `core.autocrlf`，保留上游文件与补丁的 LF（单字符换行）。否则 `git apply` 的上下文及上游 `patchedDependencies` 的锁定哈希都可能因换行转换失配。使用检出根声明的 `pnpm@11.7.0`，从该根运行 `corepack pnpm install --frozen-lockfile` 和 `corepack pnpm run build`；在 WeftMate 根加 `--dir` 不保证 Corepack（包管理器版本选择器）先选中上游声明的版本。

## 包内容中的构建身份

`verify-windows-package` 扫描 app.asar（应用归档）及 resources（松散资源目录），包括 `app.asar.unpacked`、DSH 的全部第三方依赖、配置与中继资源。自有代码、WeftMate 插件和配置拒绝任何 Windows 用户目录路径；第三方 `node_modules` 文件只拒绝当前构建机的用户目录、用户名、机器名与构建目录。身份每次从操作系统读取，不存仓库；失败只输出文件和违规类型，成功只输出零命中计数。源码映射、大文本与 UTF-16（双字节文本编码）配置均检查，不用文件白名单。

没有裁剪 node-pty 的 `src/**` 或测试文件：分层检查允许上游作者的示例路径，同时仍检出该文件中夹带的本机身份。另一方案是在暂存时裁剪非运行时文件；node-pty 的 `main` 指向 `lib/index.js`，执行依赖 `lib` 与原生二进制而非 `src`。vendor 清单校验原始 tarball（依赖包归档）的哈希、闭包包集合及入口，所以只裁剪暂存副本不会改动清单哈希；但还需额外维护文件裁剪规则和依赖升级时的运行验证。本次选择保持已验证闭包完整，通过所有运行路径验收分层扫描方案。

暂存排除 hoisted（平铺依赖）布局中的 pnpm 安装状态与缓存元数据：`node_modules/.bin`、`.pnpm`、`.modules.yaml`、`.pnpm-workspace-state-v1.json`。这些文件记录安装机绝对路径；真实入口为 `bin/dsh-web` 与包的 `main/exports`，原生绑定、源码、许可证及整个运行包集合保留。原始 vendor 与 tarball 哈希不改，暂存副本只移除安装管理文件。DSH 随仓库的 portable CSS module IDs（可移植样式模块标识）补丁将虚拟模块标识改成仓库相对路径，读取及 watch（构建变更监听）仍解析回物理源文件；修复编译器在输出注释中泄露绝对目录，新增固定 vendor 测试会拒绝漏打补丁的产物。
