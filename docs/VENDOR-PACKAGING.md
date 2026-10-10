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
