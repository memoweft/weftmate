# WeftMate

一个基于开源 MemoWeft 构建的专有 AI 桌面伴侣。换个模型、关掉重开，它依然能记起你说过什么；同时分清哪些是**事实**、哪些只是**推测**。

底层使用 [MemoWeft](#三层别搞混) 作为长期记忆能力（公开依赖、不改库源码）。

> **English** — WeftMate is a proprietary desktop AI companion built on open-source MemoWeft. Switch models or restart the app,
> and it still remembers what you told it — and keeps **facts** and **guesses** apart, powered by MemoWeft
> as its long-term memory layer.
>
> This README is Chinese-first with an English summary. The app already includes Chinese/English UI support
> and an English persona, while public-facing copy is still being refined for the first installable release.

---

## 三层别搞混

一个常见的混淆点,先说清楚:

| 名字 | 是什么 | 说明 |
|---|---|---|
| **WeftMate** | 产品层 · 这个 Electron 桌面 App | 专有产品、面向大众，基于开源 MemoWeft 构建 |
| **星瑶** | 人格层 · App 内置的一个可切换人格 | **不是产品名**。第一人称「我记得你」只属这一层 |
| **MemoWeft** | 能力层 · 长期记忆库 | 当依赖 `import`,不改其源码;负责把记忆分成事实与推测 |

> 换句话说:**WeftMate** 是壳,**星瑶** 是你切换到的那个人格,**MemoWeft** 是壳底下那台记忆引擎。

---

## 已实现的能力

> 以下均为**开发层面已接线**(真跑通、非 demo)。尚未打包成可安装物,详见[项目状态](#项目状态)。

- **桌面常驻** —— 系统托盘、单实例锁、自绘无边框标题栏。
- **多模型配置** —— 内置多模型 + 自定义;apiKey 用 Electron `safeStorage` 加密,**不明文落盘**。
- **记忆 + 画像** —— 把「记住的东西」做成可看的画像，按来源区分感知、对话推断和用户操作，并保留事实与推测的边界；完整的画像“修改/指正”双通道仍在建设。
- **记忆气泡** —— 新理解当场织进聊天流(「记住了 · 还没确认 · 改/删」),管理不用另开页。
- **内置人格切换** —— 星瑶、Aria 和普通助手可以即时切换并共享同一份用户记忆；用户人格包系统仍在建设。
- **感知采集** —— **opt-in**,采集你在忙什么 / 设备状态喂进画像;observed 数据**默认不上云**。
- **agent 干活** —— Host 自建 agent 循环 + 内置四工具 + 沙箱;自主度三档(只建议 / 问一下 / 放手做)、每步可视、快照一键撤回。
- **MCP 一键装** —— 走官方 MCP SDK(stdio),像装扩展一样接外部工具。
- **上下文附件** —— 文本、代码和图片都能作为上下文接入干活模式；视觉模型可直接处理图片。

---

## 开发 · 运行

建议使用 Node.js 24（Electron 会随依赖安装）。

```bash
git clone https://github.com/memoweft/weftmate && cd weftmate  # 需要仓库访问授权
npm ci             # 按锁文件安装 Electron、memoweft、MCP SDK 等依赖
npm start          # 起 Electron:主进程 import server.ts 起 loopback + core → 窗口加载
npm run typecheck  # tsc 类型检查
npm test           # 跑契约/冒烟测试(node:test)
```

> WeftMate 采用专有授权，见 [`LICENSE`](LICENSE)。当前仓库仅对获授权的协作者开放；后续版本与分发方式以官方说明为准。

---

## 项目状态

- **阶段** —— 阶段 1「核心 Alpha 闭环」已完成，当前处于阶段 2「可交付产品 v1」。
- **可复现性** —— 已精确固定公开 `memoweft@0.5.1`，无 sibling 的干净安装、类型检查、48 项测试和 Electron 空数据启动已通过。
- **CI** —— 仓库包含 Windows、macOS、Linux 三平台 GitHub Actions；是否可交付以实际运行结果和 [`CURRENT.md`](CURRENT.md) 为准。
- **暂无安装包** —— 仍需完成发布前安全收口、打包、签名、公证、Release 和自动更新。
- **双语** —— 应用内中英文和英文人格已经接线，站点与发布文案仍在收口。

当前事实看 [`CURRENT.md`](CURRENT.md)，五个大阶段见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

---

## 文档

- [`CURRENT.md`](CURRENT.md) —— 唯一当前状态、阻塞与下一步。
- [`docs/PRODUCT.md`](docs/PRODUCT.md) —— 产品定位和长期边界。
- [`docs/ROADMAP.md`](docs/ROADMAP.md) —— 五个大阶段、模块范围和退出标准。
- [`PROJECT_ANALYSIS.md`](PROJECT_ANALYSIS.md) —— 当前基线的完整代码审计快照。
- [`AGENTS.md`](AGENTS.md) —— 开工入口、文档职责和开发红线。
- [`docs/PRIVACY.md`](docs/PRIVACY.md) —— 数据位置、离机条件和用户控制权。

---

## 许可证

WeftMate 自有代码、二进制、视觉资产和文档采用专有授权（All Rights Reserved），见 [`LICENSE`](LICENSE)。MemoWeft 与第三方组件继续按各自许可证授权。
