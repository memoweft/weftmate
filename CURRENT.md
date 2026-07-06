# CURRENT.md · WeftMate 当前任务白板

> 唯一的"现在做什么"看板。产品定义看 `docs/PRODUCT.md`(活文档·中途可调),历史看 git 提交。

## 当前:阶段 1 开工(S0 / S1 已通)

- **S0 · sqlite** ✅ node:sqlite 在 Electron 43 / Node 24.17 可用 —— **走 node:sqlite,零原生模块**(未装 better-sqlite3、能跑就是它)。
- **S1 · Electron 骨架** ✅ `src/main.mjs` 设 userData 库 + 默认星瑶 + 单实例锁 → `import './server.ts'`(起 127.0.0.1:7788 loopback + 建 core) → 开窗加载。现有 Host 能力已在桌面跑;**Electron main 直接跑 .ts、免编译链**。

### 下一 = 阶段 1 · 立身之本

1. **产品级对话界面**(Claude Desktop 风格):左对话记录、底部工具栏(`＋ 文件/工作区 · 模型选择器 · 技能 · 沙箱 · 发送`)、功能收侧栏底部**有切换动画**、输入框**无 placeholder**、桌面形象角落。现有 `src/web/index.html`(2319 行手搓)**重做成产品级**。
2. **配模型设置界面**:填模型 key(**safeStorage 存·不明文**)——不做装完打不开。模型配置放**底部选择器**(内置多模型 + 自定义 + 配置)。
3. **桌面化收尾**:托盘常驻(窗口关不退)、`before-quit` 调 `scheduler.dispose()` + `core.close()`;DB 落 userData(✅)、单实例锁(✅)。
4. **三样立身之本做扎实**:记忆 + **画像可视**(能看还能纠错)、**记忆气泡**(新理解织进聊天流·改/删)、**人格切换**。
   守克制纪律:少而准、不吹大、工具定义延迟加载。

## 复用(已在 `src/` · 从 `../DLA_rebuild/apps/memoweft-host` 搬 · 只经 import memoweft 用门面不碰库)

`experiences/`(星瑶/plain 人格 + 注册表) · `scheduler.ts`(后台整理) · `chatHistory.ts` · `confBand.ts`(把握度分档) · `server.ts`(loopback + core + chat 编排,切人格清双缓存那段必须原样保留) · `web/index.html`(前端 · **待重做**)。

## 待作者手动

- **建 GitHub repo `weftmate`**(本机没装 gh):建好后配 remote 推送(本地已 `git init` + 提交若干)。命名口径见 MemoWeft 的记忆 [[memoweft-naming-positioning]]。

## 参照

- 产品定义 = `docs/PRODUCT.md`(**活文档·中途可调**)。
- 可视化蓝图 = `docs/blueprint.html`(浏览器打开)。
- 开工规矩/红线 = `AGENTS.md`。
