# WeftMate

WeftMate 是一个专有的桌面集成中心和图形界面，用来连接和管理 DSH、MemoWeft 与 AI-Game。

WeftMate 不替代这些项目：

- DSH 提供 Agent、模型、工具和代码执行能力；
- MemoWeft 独立开发长期记忆能力，目前只保留试验接缝；
- AI-Game 独立开发主动智能体与设备协同能力，目前尚未正式接入；
- WeftMate 负责统一界面、状态、配置、生命周期、诊断和用户交互。

## 当前状态

- DSH 启动、Gateway、会话、模型、工作区、权限和诊断已有代码基础；
- 当前产品界面仍主要借用 DSH Web；
- 下一步是建立 WeftMate 自己的最小 UI 和统一管理框架；
- MemoWeft 与 AI-Game 未完成，不作为当前版本的强制依赖；
- 桌宠、感知和移动设备接缝保留代码，但不在当前主线扩展。

## 开发

```powershell
npm ci
npm start
npm run typecheck
npm test
```

## 项目说明

- [产品边界](docs/PRODUCT.md)
- [当前架构](docs/ARCHITECTURE.md)
- [总路线](docs/ROADMAP.md)
- [DSH 打包事实](docs/VENDOR-PACKAGING.md)

## 许可证

WeftMate 自有代码、二进制、视觉资产和文档采用专有授权，见 [LICENSE](LICENSE)。DSH、MemoWeft、AI-Game 与其他第三方组件继续遵循各自许可证。
