# Windows 产品边界

WeftMate 当前 Windows 基线是固定 DSH 官方客户端与 Electron 产品外壳。安装、升级、更新、诊断和数据保留由 WeftMate 管理；外部子系统只有在具备稳定接口和宿主生命周期后才进入安装包。

## 当前事实

- Windows x64 使用 per-user NSIS installer（按用户安装的 NSIS 安装器）。
- `deleteAppDataOnUninstall` 为 `false`：普通卸载保留当前 Windows 用户的 WeftMate/DSH 数据。
- 模型密钥由 Electron `safeStorage` 保存，不进入普通配置、子进程环境、日志、诊断或安装包。
- 固定 DSH runtime（运行时）来自已验证 vendor（内嵌依赖），发布包不能依赖开发机源码路径。
- `publish` 仍为 `null`；当前没有公共更新源、代码签名或正式发布声明。
- AI-GAME 当前不随安装包启动或安装，相关用户入口在宿主生命周期完成前不发布。

## 用户数据

正式安装的用户数据根目录是 `%APPDATA%\com.memoweft.weftmate`。普通卸载按 `retained-on-uninstall`（卸载后保留）处理以下类别：

- `weftmate-settings.json`：非秘密产品设置；
- `weftmate-model.enc`：当前 Windows 用户 `safeStorage` 加密的模型凭据；
- `dsh-home/sessions/`：DSH 会话；
- `dsh-home/profiles/`、DSH storage（存储）与默认 workspace（工作区）；
- 经脱敏的本机故障日志。

卸载器不提供隐含的“删除全部数据”。永久删除必须由产品所有者另行授权并使用精确目标确认。

## 构建与证据

```powershell
npm run vendor:verify
npm run dist:win:candidate -- --version <pre-release-version> --output-dir <absolute-output> --stage-root <absolute-stage>
```

候选必须有可辨识版本、SHA-256、闭包审计和隔离数据范围。包构建成功只证明构建与闭包；安装启动、模型/工具实际可用、升级恢复、产品所有者 dogfood 和正式发布必须分别验证。

代码签名、可信发布者、受控 HTTPS 更新源和干净 Windows 用户环境验证仍是正式发布阻断。

候选的机器路径、哈希和测试次数只写入当次交付结果，不进入长期产品文档。
