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
npm run dist:win:candidate -- `
  --version 0.1.0-stage3.2 `
  --output-dir D:\AIProjects\WeftMate\Runtime\Stage3\builds\0.1.0-stage3.2 `
  --stage-root D:\AIProjects\WeftMate\Runtime\Stage3\staging\0.1.0-stage3.2
```

- `vendor:dsh` 只在 vendor 缺失、损坏或固定 DSH 版本被产品所有者明确升级时手动运行；候选构建不会隐式重建 vendor；
- `vendor:verify` 检查版本、文件、依赖闭包和启动行为；
- `dist:win` 把已验证的 DSH 运行时放入 Windows 安装包；
- `dist:win:candidate` 先验证现有 vendor，再使用无 reparse point（重解析点）的隔离暂存目录构建，并审计安装包闭包、开发机路径、用户数据和凭据文件；
- 当前 manifest 为 `scriptVersion=3`、DSH `0.1.0-rc.5@47f943859bef60e4160492346772ded9b24f765a`、197 包闭包、195 个 Windows 实装包、2 个 Linux-only optional package（仅 Linux 可选包）、`carriedButNotMounted=[]`。

## 运行

- Electron main 使用 Electron 自带的 Node 启动 DSH；
- DSH 数据位于 WeftMate 的用户数据目录；
- API key 由 Electron `safeStorage` 保存；固定 DSH provider 只通过受管 Node child IPC（Node 子进程进程间通信）按 ref 获取密钥，密钥不进入普通配置、子进程环境、日志或诊断；
- 发布包不能依赖开发机器上的绝对源码路径。

Windows 安装、更新、卸载、数据保留、诊断和恢复的当前边界见 [WINDOWS-PREVIEW.md](WINDOWS-PREVIEW.md)。

## 当前边界

- Windows 预览版先打包 WeftMate UI 与 DSH；
- MemoWeft 当前只保留开发期试验接缝，不进入正式打包承诺；
- AI-Game 当前不进入 WeftMate 安装包；
- MemoWeft 和 AI-Game 的正式分发方式等待各自提供稳定接口后再确定。
