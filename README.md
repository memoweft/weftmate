# WeftMate

WeftMate 是专有的桌面集成中心和图形界面。主窗口直接承载固定版本 DeepSeek Harness（DSH，执行智能体运行时）的官方客户端；WeftMate 管理产品外壳、原生生命周期、安全凭据、安装更新和与其他本地系统的窄接缝。

## 当前基线

- DSH 继续独占会话、消息、输入、工具、模型、审批、工作区、计划和 `userQuestions`；WeftMate 不复制它们的状态机。
- AI-GAME 的 V2 Android 模拟器任务基础已经接入代码，但它还没有被 WeftMate 作为受管子系统启动、停止和打包。
- 因此 Android 模拟器设置和全局任务中心暂不发布；用户不需要、也不应该手工维护 `127.0.0.1:4310` 才能使用一个可见功能。
- 原对话内的 `phone_execution` 工具结果和详情接缝保留，AI-GAME 不可用不会阻止普通 DSH 对话。
- 设备路线只使用用户选择的 Android 模拟器。
- 当前是干净、可控的产品基线，首个通用长期任务的代表性验收标准已经冻结；当前仍不是 AI-GAME dogfood（亲自试用）候选，也没有新的产品所有者 `PASS` 声明。

## 开发

```powershell
npm ci
npm run typecheck
npm test
npm start
```

`npm start` 是源码开发入口。Windows 候选构建和固定 DSH 依赖规则见 [DSH 打包事实](docs/VENDOR-PACKAGING.md) 与 [Windows 产品边界](docs/WINDOWS-PREVIEW.md)。

## 当前文档

- [产品边界](docs/PRODUCT.md)
- [架构与代码事实](docs/ARCHITECTURE.md)
- [路线](docs/ROADMAP.md)
- [AI-GAME 长期模拟器任务](docs/AI-GAME-AUTONOMOUS-MOBILE-TASKS.md)
- [Dogfood 协议](dogfood/PROTOCOL.md)

未来 Agent 不得从 Git 历史、项目归档、旧工作树、运行日志或聊天摘要恢复项目上下文；文档读取范围以 `D:\AIProjects\README.md` 和 `D:\AIProjects\WeftMate\.codex\ORCHESTRATOR.md` 为准。

## 许可证

WeftMate 自有代码、二进制、视觉资产和文档采用专有授权，见 [LICENSE](LICENSE)。DSH、MemoWeft、AI-GAME 与其他第三方组件继续遵循各自许可证。
