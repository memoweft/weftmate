# CURRENT.md · WeftMate 当前任务白板

> 唯一的"现在做什么"看板。产品定义看 `docs/PRODUCT.md`(活文档·中途可调),历史看 git 提交。

## 当前:阶段 1 开工(S0 / S1 已通)

- **S0 · sqlite** ✅ node:sqlite 在 Electron 43 / Node 24.17 可用 —— **走 node:sqlite,零原生模块**(未装 better-sqlite3、能跑就是它)。
- **S1 · Electron 骨架** ✅ `src/main.mjs` 设 userData 库 + 默认星瑶 + 单实例锁 → `import './server.ts'`(起 127.0.0.1:7788 loopback + 建 core) → 开窗加载。现有 Host 能力已在桌面跑;**Electron main 直接跑 .ts、免编译链**。

### 阶段 1 · 立身之本(作者拍板开工顺序 = 下面 ①→②→③→④;配置生效见 [[weftmate-config-apply]])

- **① 桌面化收尾** ✅ 已做:托盘常驻 + 左键唤窗 + 菜单(显示/退出)、**关窗收托盘不退**、`before-quit` 调 server 导出的幂等 `shutdown()`(scheduler.dispose + core.close + 强断连接关 loopback·带超时兜底)、第二实例唤前台;DB 落 userData(✅)、单实例锁(✅)。托盘图标内嵌 data URL(免打包路径)。**启动冒烟过**;before-quit→shutdown 运行时路径需 GUI 点"退出"才能验(代码复查过)。
- **② 配模型设置界面** ✅ 已做:新 `src/config-store.ts` 收拢全部 Electron 耦合(safeStorage 加解密 + relaunch),key 加密落盘 `userData/weftmate-model.enc`(**明文绝不落盘/不 log**);`readPublicView()` 剥掉所有 key 只回 baseUrl/model+hasKey;重配留空 key 沿用旧的(mergeKeepingKeys)。main 启动 `injectEnv()` 解密塞 env → 再建 core;`server.ts` 加 `GET/POST /api/model-config`(保存后延时 `app.relaunch()` 生效)。前端向导由"拼 .env 复制"改成"保存并启用"(直连 model-config,预填 baseUrl/model)。**验:隔离临时库冒烟——密文无明文 key 泄露/安全视图无 key/merge/injectEnv 全绿;真机启动 GET 通、POST 空体 400、真实配置未污染。** relaunch-on-save 路径靠代码复查(不在真机触发免污染)。模型配置最终放**底部选择器**留 ③ 外壳做。
- **③ 产品级对话界面**(← 下一 · Claude Desktop 风格):左对话记录、底部工具栏(`＋ 文件/工作区 · 模型选择器 · 技能 · 沙箱 · 发送`)、功能收侧栏底部**有切换动画**、输入框**无 placeholder**、桌面形象角落。现有 `src/web/index.html`(2319 行)**重做外壳+聊天流+工具栏**,保留已验证的记忆管理/图谱/向导逻辑,不推倒。
- **④ 三样立身之本做扎实**:记忆 + **画像可视**(能看还能纠错)、**记忆气泡**(新理解织进聊天流·改/删)、**人格切换**。
   守克制纪律:少而准、不吹大、工具定义延迟加载。

## 复用(已在 `src/` · 从 `../DLA_rebuild/apps/memoweft-host` 搬 · 只经 import memoweft 用门面不碰库)

`experiences/`(星瑶/plain 人格 + 注册表) · `scheduler.ts`(后台整理) · `chatHistory.ts` · `confBand.ts`(把握度分档) · `server.ts`(loopback + core + chat 编排,切人格清双缓存那段必须原样保留) · `web/index.html`(前端 · **待重做**)。

## 待作者手动

- **建 GitHub repo `weftmate`**(本机没装 gh):建好后配 remote 推送(本地已 `git init` + 提交若干)。命名口径见 MemoWeft 的记忆 [[memoweft-naming-positioning]]。

## 参照

- 产品定义 = `docs/PRODUCT.md`(**活文档·中途可调**)。
- 可视化蓝图 = `docs/blueprint.html`(浏览器打开)。
- 开工规矩/红线 = `AGENTS.md`。
