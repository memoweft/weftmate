# WeftMate

开源的桌面 AI 伴侣。换个模型、关掉重开,它依然记得你说过什么;而且分得清哪些是**事实**、哪些只是**推测**。

底层用 [MemoWeft](#三层别搞混) 当长期记忆能力(`import 'memoweft'`,当依赖、不改库源码)。

> **English** — WeftMate is an open-source desktop AI companion. Switch models or restart the app,
> and it still remembers what you told it — and keeps **facts** and **guesses** apart, powered by MemoWeft
> as its long-term memory layer.
>
> This README is Chinese-first with an English summary. Full bilingual UI/docs (i18n) land at milestone **M3**
> on the [roadmap](docs/ROADMAP.md) — this is the bilingual skeleton, not the finished translation.

---

## 三层别搞混

一个常见的混淆点,先说清楚:

| 名字 | 是什么 | 说明 |
|---|---|---|
| **WeftMate** | 产品层 · 这个 Electron 桌面 App | 开源、面向大众,主打展示长期记忆能力 |
| **星瑶** | 人格层 · App 内置的一个可切换人格 | **不是产品名**。第一人称「我记得你」只属这一层 |
| **MemoWeft** | 能力层 · 长期记忆库 | 当依赖 `import`,不改其源码;负责把记忆分成事实与推测 |

> 换句话说:**WeftMate** 是壳,**星瑶** 是你切换到的那个人格,**MemoWeft** 是壳底下那台记忆引擎。

---

## 已实现的能力

> 以下均为**开发层面已接线**(真跑通、非 demo)。尚未打包成可安装物,详见[项目状态](#项目状态)。

- **桌面常驻** —— 系统托盘、单实例锁、自绘无边框标题栏。
- **多模型配置** —— 内置多模型 + 自定义;apiKey 用 Electron `safeStorage` 加密,**不明文落盘**。
- **记忆 + 画像** —— 把「记住的东西」做成可看的画像,**按来源分组**(感知来的 / 对话推断的 / 你改删过的),分事实与推测,可当场纠错。
- **记忆气泡** —— 新理解当场织进聊天流(「记住了 · 还没确认 · 改/删」),管理不用另开页。
- **人格切换** —— 一个人格 = 系统提示 + 语气 + 可选形象;切人格 = 切能力包,同一份记忆都还在。
- **感知采集** —— **opt-in**,采集你在忙什么 / 设备状态喂进画像;observed 数据**默认不上云**。
- **agent 干活** —— Host 自建 agent 循环 + 内置四工具 + 沙箱;自主度三档(只建议 / 问一下 / 放手做)、每步可视、快照一键撤回。
- **MCP 一键装** —— 走官方 MCP SDK(stdio),像装扩展一样接外部工具。
- **上下文附件** —— 拖文本文件当上下文,接进干活模式(图片/多模态待后续)。

---

## 开发 · 运行

需要 Node.js（含 Electron,随 `npm install` 装上）。

```bash
git clone https://github.com/memoweft/weftmate && cd weftmate
npm install        # 装依赖(含 Electron、memoweft、MCP SDK)
npm start          # 起 Electron:主进程 import server.ts 起 loopback + core → 窗口加载
npm run typecheck  # tsc 类型检查
npm test           # 跑契约/冒烟测试(node:test)
```

> 源码:[github.com/memoweft/weftmate](https://github.com/memoweft/weftmate)(MIT · 开源)。尚无预编译安装包(打包在路线图 M4–M5),当前从源码运行。

---

## 项目状态

- **阶段** —— 开发中。功能内核已扎实接线(阶段 1 + 阶段 2 前四块),但目前**只从源码运行**。
- **交付层在建** —— 打包 / 签名 / 自动更新 / CI 尚未就绪。
- **暂无安装包** —— 还没有 Windows/macOS/Linux 安装物;可安装物计划在路线图 M4–M5。
- **双语** —— 当前是双语骨架;完整 i18n(UI 字符串、英文人格、库语言口径)在 M3。
- **发布后 fast-follow** —— 历史接力、记忆护城河深化等排在 v1.0 之后(M6–M9)。

完整分期见 [`docs/ROADMAP.md`](docs/ROADMAP.md)(9 个里程碑)。

---

## 文档

- [`docs/PRODUCT.md`](docs/PRODUCT.md) —— 产品定义(定位、界面、功能盘、贯穿纪律)。
- [`docs/ROADMAP.md`](docs/ROADMAP.md) —— 路线图与计划(9 个里程碑、工作量、风险)。
- [`AGENTS.md`](AGENTS.md) —— 开工红线(不碰库源码、守命名纪律、三条克制纪律)。
- [`docs/PRIVACY.md`](docs/PRIVACY.md) —— 隐私说明(数据存哪、什么时候离开你机器、你的控制权)。

---

## 许可证

MIT,见 [`LICENSE`](LICENSE)。
