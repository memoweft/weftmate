# WeftMate MVP · 任务书

> 独立仓库的 **Electron 桌面常驻产品**,开源、面向大众,**主打展示 MemoWeft 的记忆能力**。`import memoweft@^0.5.0` 当依赖,**不碰库**(memoweft 源码一行不改)。分步做。
> 依据:第 9 步总纲(`memoweft/docs/internal/tasks/后续批次总纲.md`)+ 三路调研(Host 复用 / 前端取舍 / Electron 集成)+ 对抗校对(2026-07-07)。

## 定位

- **WeftMate** = 产品(桌面 App)。**星瑶** = 内置的一个**可切换人格**(非产品名)。**MemoWeft** = 底层记忆库(依赖)。
- 卖点叙事:**同一份记忆,换不同人格的脸,她都记得你**——保留人格切换正是为演示这个 MemoWeft 独特能力。

## MVP 最小闭环

**要**:① 星瑶 / 普通助手**可切换**聊天;② 跨启动**记住你**(关掉重开她还记得);③ **"她记得你啥"只读查看**(对你的理解 + 你说过的原话 + "记住你 N 件事"计数)。
**砍到后期**:多会话侧栏、数据备份、记忆图谱、采集器、记忆的增删改写操作、配置向导(改设置面板)。

## 决策(作者已拍板 2026-07-07)

| # | 决策 | 定案 |
|---|---|---|
| D1 | 前端 | **沿用现有 memoweft-host 的手搓单文件 HTML**(约 90 函数、零依赖 SPA),搬进 Electron 壳、砍非闭环 tab、改文案贴星瑶口吻。**先跑通**;验证站得住再评估第二步 React 重做(保留这条路,不是二选一)。 |
| D2 | 人格 | **保留切换**(星瑶 + 普通助手)——演示"同记忆换张脸"的卖点。默认激活星瑶。 |
| D3 | 记忆查看 | **MVP 只读**(砍卡片上的标失效/删除/授权写操作 + 二次确认链路)。 |
| D4 | 主进程↔前端 | MVP 先在主进程内起 **127.0.0.1 loopback server** 复用现有 handler(前端 fetch 几乎零改、最快跑通);后期评估换 Electron IPC(去常驻端口)。 |
| D5 | sqlite 驱动 | **✅ 实测定案(2026-07-07):node:sqlite 在 Electron 43(内置 Node 24.17)可用**——`npm run smoke` 建 core + 存读全通、未装 better-sqlite3。WeftMate 走 **node:sqlite,零原生模块、零 electron-rebuild、零 asarUnpack**(推翻了"要 better-sqlite3"的悲观预判)。 |
| D6 | 模型 key 输入 | 做**设置界面**写用户数据目录配置,apiKey 走桌面安全存储(`safeStorage`),不明文躺 .env。**这是"不做就装完打不开"的前置。** |
| D7 | 打包 | electron-builder(Windows/mac);到出安装包时再定细节。 |

## 复用清单(从 memoweft-host 搬 · 都只经 `import 'memoweft'` 用类型/门面,不碰库源码)

| 来源 | 处置 |
|---|---|
| `experiences/xingyao.ts` `plain.ts` `index.ts`(人格插件 + 注册表) | **直接搬·零改**。默认激活 xingyao。 |
| `scheduler.ts`(后台攒批/空闲整理画像) | **直接搬**。桌面常驻比网页更适合它长活。接 Electron 生命周期调 `dispose()`。 |
| `chatHistory.ts`(jsonl 聊天历史落盘) | **直接搬·零改**(单会话 append/read;多会话砍)。 |
| `confBand.ts`(把握度分档) | **搬**——给每条"理解"标"低把握/有一定把握/…",体现"记≠信、会变淡"卖点。 |
| `server.ts` 的"建 core + 每轮 chat 编排(切人格清双缓存)" | **迁进主进程**(改成 loopback handler 或 IPC)。切人格的三件一起清(`activatedConvs.delete` + `core.dropConversation` + `switchedExperienceConvs.add`)**必须原样保留**,否则人格切不动。 |
| `web/index.html`(2319 行前端) | **搬骨架、砍非闭环 tab**(多会话/向导/图谱/插件/备份),记忆查看只读,**文案改成星瑶口吻**(现文案刻意中性、不用"她")。 |
| `genEnv.ts`(拼 .env 向导) | **不搬**,改成原生设置界面(D6)。键名口径可参考。 |

## 三个"不解决就跑不起来"的坑(对抗校对挖出)

1. **🔴 sqlite 驱动**(见 S0/D5):node:sqlite 在 Electron 可能被阉割/需 flag 而跑不通(参考 electron#45532),必须实测。
2. **🔴 模型 key 输入**(见 D6):砍向导后没有填 key 的界面 = 大众用户装完打不开。
3. **桌面化必做**:DB 落 `app.getPath('userData')`(打包后 app 目录只读)、单实例锁(`requestSingleInstanceLock` 防多进程抢同一 sqlite)、托盘常驻生命周期(窗口关≠退出、`before-quit` 调 `scheduler.dispose()` + `core.close()`)、raw `.ts` 要先编译(打包不吃裸 ts)。

## 施工步骤(分步)

- **S0 · sqlite smoke** ✅ **已过(2026-07-07)**:Electron 43 / Node 24.17,`npm run smoke` 建 core + 存读全通、未装 better-sqlite3 → **走 node:sqlite,零原生模块**。头号风险趟平。
- **S1 · 骨架跑通**:主进程建 core + loopback server 复用 chat/记忆 handler + 开 BrowserWindow;DB 落 userData;单实例锁。
- **S2 · 搬前端**:搬 `index.html`、砍非闭环 tab、记忆查看只读、文案贴星瑶、保留人格切换下拉;桌面观感靠 BrowserWindow 配置(去地址栏/托盘)。
- **S3 · 模型配置**:设置界面 + safeStorage 存 key(不做则跑不起来)。
- **S4 · 桌面常驻 + 打包**:托盘、生命周期收尾、electron-builder 出包。
- 后续:React 重做前端(可选)、记忆写操作、多会话、图谱等。

## 红线

- **不碰 memoweft 库**:当依赖 `import`,不改其源码;库的 main 保持"库+生态"纯粹。
- **隐私随迁**:apiKey 不明文落盘(safeStorage);后期若加采集,observed 默认不上云口径原样守。
- 诚实:sqlite 结论以 S0 实测为准,不凭推断。
