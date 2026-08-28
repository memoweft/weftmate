# DSH 打包事实

本文只记录当前 DSH 打包接缝，不定义产品路线。

## 来源

- DSH 版本由 `tests/contract/dsh-pin.json` 固定；
- 开发环境可以使用指定的 DSH checkout；
- 发布包使用 `vendor/dsh-runtime/` 生成运行时；
- `vendor/dsh-runtime/` 是构建产物，不进入 Git。

## 构建

```powershell
npm run vendor:dsh
npm run vendor:verify
npm run dist:win
```

- `vendor:dsh` 从固定版本的 DSH 构建并装配运行时；
- `vendor:verify` 检查版本、文件、依赖闭包和启动行为；
- `dist:win` 把已验证的 DSH 运行时放入 Windows 安装包。

## 运行

- Electron main 使用 Electron 自带的 Node 启动 DSH；
- DSH 数据位于 WeftMate 的用户数据目录；
- API key 由 Electron `safeStorage` 保存，启动时通过子进程环境传递；
- 发布包不能依赖开发机器上的绝对源码路径。

## 当前边界

- Windows 预览版先打包 WeftMate UI 与 DSH；
- MemoWeft 当前只保留开发期试验接缝，不进入正式打包承诺；
- AI-Game 当前不进入 WeftMate 安装包；
- MemoWeft 和 AI-Game 的正式分发方式等待各自提供稳定接口后再确定。
