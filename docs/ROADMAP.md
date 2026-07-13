# WeftMate 路线图与计划

> **状态:4 个战略决策已由 owner 确认（2026-07-13）· 里程碑内容待开工验收。**
> 此文件是总控/PM/验收跟踪的 source of truth，与 `CURRENT.md`（当前在做什么）并行。
> 红线不变:不碰 memoweft 库源码、守 `docs/naming.md`、三纪律（工具定义延迟加载 / 只报 P0P1 别唠叨 / observed 默认不上云）。

## 0. 现状一句话

功能内核扎实（阶段1≈90%、阶段2前四块≈70%，都是真接线不是 demo），但**只活在开发机上**:测试全在被 gitignore 的 scratchpad（零回归网）、无 typecheck（红线名存实亡）、无打包/签名/更新/repo（工程交付层≈28%）。内核(memoweft)与外层分层干净，但边界上没安全网——升级内核是"换上去跑起来看哪里炸"的手动模式。

## 1. PM 战略推荐

> **先复位安全网 → 堵 P0 安全洞 → 收口 → 双语一等 → 发一个「薄但真」的 v1.0 → 发布后 fast-follow 历史接力与护城河。**

采「地基信任优先」的严谨排序，但**不学「数月只 dogfood 不发布」**——理由:①今天零外部验证，再往未验证假设上加注机会成本最高;②memoweft pre-1.0 experimental，在 CI 回归网证明可靠前于其上大建深护城河=流沙上盖楼;③交付层最脏，越晚碰风险越集中。

**贯穿设计原则（因 owner 拍板"预留手机端接缝"）**:核心逻辑保持运行时无关、尽量住前端 web 层而非 Electron main 进程、Electron 专有层刻意瘦。A2 adapter 即按"运行时无关接缝"设计。这几乎免费地为未来 mobile/跨运行时留位——未来若 memoweft 支持另一运行时，接缝已在。

## 2. 已确认的决策（owner 拍板 · 已锁定）

| # | 决策 | ✅ 定案 | 连带影响 |
|---|---|---|---|
| F1 | 公开发布时机 | **尽早发薄但真的 v1.0** | D 护城河/E 完整度全部 fast-follow 到发布后（M6–M9） |
| F2 | memoweft 升级安全 | **精确 pin（去 `^`）+ 迁移/备份工装** | M1 加 schema 迁移接线(G1)、去 caret;M5 自动更新硬依赖备份(G2) |
| F3 | 目标受众/语言 | **双语一等公民**（≠ PM 推荐的中文优先，owner 拍板） | **新增 i18n 工作线进 v1.0**（M3）;须正面解决库语言默认口径，zh/en 都一等 |
| F4 | 手机端架构 | **现在预留架构接缝**（≠ PM 推荐的全押桌面，owner 拍板） | 上方贯穿设计原则;A2 adapter 设计成运行时无关接缝、逻辑尽量住 web 层 |

## 3. 完整分期路线图

工作量为单人粗估（人天）。**M0–M5 = 到 v1.0**;M6–M9 = 发布后。

### 🟢 M0 · 安全网复位 + 建仓（三版一致、零争议、不依赖任何岔路——先做）
> **进度 2026-07-13 · 本地部分 ✅ 完成并验收**：A1 typecheck（tsconfig+script，绿、能红、修了 collector 类型 bug）· A2 adapter（`src/memoweft.ts`，门面收拢一处、运行时+live-binding 验过）· A3 契约测试（`tests/` 28 例 `npm test` 全绿）· G3 LICENSE(MIT) · G6 dogfood（`dogfood/run.mjs`+PROTOCOL）· README 重写 · A4 CI 配置就绪（`.github/workflows/ci.yml`）。**待建仓关闭**：B1 推代码、A4 CI 激活跑绿、site CTA（需 repo URL）——owner 选了「本地先做」，建仓后即插即用。

把升级内核从"裸奔"变成"编译器先告诉你哪不对"。
- **内容**:A1 tsconfig + `npm run typecheck` · **A2 薄 adapter `src/memoweft.ts` 收拢所有 memoweft 门面调用（设计成运行时无关接缝，服务 F4 手机端预留）** · A3 契约测试进仓（node:test 零依赖，复活 scratchpad 的 41 条断言:agent沙箱15/MCP11/agent×MCP6/附件9）· A4 GitHub Actions 三平台 CI · B1 建 repo + 推代码 + **重写 README（双语结构）** + 提交&部署 site/（**英文 site 结构预留**）+ 修 CTA · G3 LICENSE · G6 dogfood 正式化进仓（seed + 日用协议）
- **验收**:typecheck 干净树退 0、插错退非 0 可当场演示;`grep "from 'memoweft'" src` 除 adapter 外无命中、库源码零改动;`npm test` 41 断言进仓通过、git 能列出;CI 三平台绿、PR 必需检查;repo 存在 + README 无断链 + site 部署 + CTA 指向自己;LICENSE 存在;dogfood 可复现
- **工作量**:16–21 人天 · **依赖**:无 · **⚠ B1 建仓需 owner**（本机没装 gh / 需 GitHub 授权）

### 🔴 M1 · P0 安全闭口 + 内核升级安全网
agent/MCP 已上线可被利用，越晚堵爆炸半径越大。
- **内容**:F1 MCP 只读=不可信自报（默认全批准 + 逐工具"信任"开关）· F2 沙箱硬化（safeResolve 后 realpath/lstat，拒 symlink 逃逸）· F7 超时杀整棵进程树 · F8 npx 装 MCP 锁版本+警示 · G1 schema 迁移接线（adapter 启动时 getSchemaVersion + runMigrations）· **内核精确 pin**（去 `^0.5.0`）
- **验收**:自报 readOnly 未信任前仍弹审批;symlink 逃逸 fail-closed 有断言;超时后无孤儿进程;装 MCP 可见锁定版本;启动检查 schema 版本且能跑迁移;package.json 去 caret
- **工作量**:9–13 人天 · **依赖**:M0

### 🟡 M2 · 收口 + 首启健壮 + 数据安全 + 隐私
让打包出去的那个 build 本身不破、不丢数据。
- **内容**:C1 agent 回写 summary（server.ts:134 一行）· C6 撤回二进制护栏 · C4 感知 originId 跨重启去重 · C5 附件上限统一+截断明示 · C7 Linux 无 keyring 清楚降级 · B4 崩溃上报 · G5 反馈回流（GitHub issue 模板 + 应用内一键带日志报告，默认本地、发送需点）· B8 隐私文案（三处 + observed 默认不上云）· G2 记忆备份/导出 + 一键删除全部（GDPR）
- **验收**:agent 完成后画像出 source=agent 摘要;撤回 PNG 字节一致;感知跨重启不重复;附件单一 cap+截断提示;无 keyring 不静默崩;强制抛异常有日志+前端入口+issue 模板;隐私文案三处;记忆可导出备份+可一键全删
- **工作量**:12–16 人天 · **依赖**:M0

### 🔵 M3 · 双语一等公民（i18n）〔因 F3 拍板新增·v1.0 scope〕
让 1.0 出厂就是中英双语一等，而不是英文半漏。
- **内容**:**I1 i18n 脚手架**（前端 UI 字符串抽取 + 语言切换基建，住 web 层、顺带服务 F4 手机端"逻辑在前端"对冲）· **I2 双语 README/site/release notes**（英文 site 结构落地）· **I3 英文人格 + 正面解决库语言默认口径**（zh/en 双向一等，用 MEMOWEFT_LANG/config.language 支持，不再靠 adapter 压 en 泄漏）· **I4 英文 UI 字符串全覆盖**（设置/记忆面板/干活模式/感知/记忆气泡）
- **验收**:切语言后全 UI 字符串跟随（无硬编码漏网）;库产出（认知/摘要）按所选语言正确出 zh 或 en，两向都对（不再半漏）;英文人格可切、语气自然;README/site 双语齐;守 naming.md（英文文案同样别吹"真正理解你"）
- **工作量**:12–16 人天 · **依赖**:M0（i18n 脚手架依赖 adapter 稳定）

### 🟠 M4 · 打包出可安装物
- **内容**:B2 electron-builder（Win NSIS/Mac dmg/Linux AppImage;先 esbuild 预编译 .ts;get-windows 的 .node 要 asarUnpack）· B3 装机冒烟（空 userData 各 OS 首启全链 + 无 keyring 路径）· G4 品牌图标（.ico/.icns，设计从 M0 就并行起）· G7 规模冒烟（一次高记忆量首启，验 recall 延迟/DB 体积）
- **验收**:三平台安装物;包内无 type-stripping;装机后窗口捕获可用;各 OS 空 userData 全链通;自定义图标非默认 Electron 图标;高记忆量首启无明显退化
- **工作量**:12–18 人天 · **依赖**:M0/M1/M2/M3

### 🟣 M5 · 签名公证 + 发布流水线 + 自动更新 → 发布 v1.0
- **内容**:B7 代码签名+公证 · B5 Release 流水线（tag→三 OS 构建→publish）· B6 自动更新（electron-updater;**硬依赖 G1 迁移 + G2 备份**——更新前先自动备份记忆 bundle + 跑 schema 迁移）
- **验收**:Win signtool verify 通过 / Mac Gatekeeper 无警告;tag 触发三 OS 构建 publish;旧版自动更新且更新前自动备份+迁移;v1.0 挂 Release 页可下载
- **工作量**:12–20 人天 **+ 证书采购日历前置** · **依赖**:M4
- **🚩 关键路径**:签名证书采购有申请周期，可能卡死此期。兜底:先发未签名版给技术型早期用户。

**——— v1.0 发布线 ———**

### M6 · 历史接力（发布后第一波·阶段2欠债）
D1 记忆搜索 · E4 会话搜索+重命名 · C3 归档恢复 UI · D3 merge/archive 记忆接线 — **8–12 人天**

### M7 · agent 信任深化
F3安全 外泄边界密钥扫描 · F4 操作审计日志 · F5 审批可读 diff + 危险命令高亮 · F6 任务级授权范围 — **10–14 人天**

### M8 · 产品完整度
E1 全局热键 · E2 气泡操作条 · E3 离线重发 · E5 首次上手引导（**双语**）· E7 克制通知 · E8 开机自启 · E9 无障碍 · E10 单会话导出 — **14–20 人天**

### M9 · 记忆护城河深化
D2 纠错反证闭环 · D4 "新懂你什么"周报 · D5 感知线索先显 · D6 "正在变淡"标签 · D7 记忆时间线 · G7 完整性能优化 — **14–20 人天**

### 候选（需先与库对齐）
- **E6 流式逐字回复**:依赖 memoweft 是否暴露流式钩子。受不改库红线约束——需先确认库能力，能则插入 M8，不能则记为对库的接口请求。

## 4. 头两周具体做什么（M0 前半）

1. 加 tsconfig + `npm run typecheck`，清类型错误到 0（大概率当场逮到语言默认值那类边界 bug）（A1）
2. 新建 `src/memoweft.ts` adapter，按运行时无关接缝设计，把 6+ 处 `from 'memoweft'` 全收拢进一处（A2，同时服务 F4 手机端预留）
3. scratchpad 的 41 条冒烟断言迁进仓、改零依赖 node:test、`npm test` 能跑并 commit（A3）
4. 重写 README（双语结构）对齐真实进度 + site/ 提交&英文结构预留 + CTA 改指向自己 + 加 LICENSE（B1/G3）
5. dogfood 脚本进仓 + 写日用协议（G6）
6. 〔需 owner〕`gh` 建 WeftMate repo 首推 + 配 GitHub Actions 三平台 CI（B1/A4）

## 5. 工作量汇总

| 阶段 | 里程碑 | 人天 |
|---|---|---|
| 到 v1.0 | M0–M5 | ~73–104（+ 证书采购日历前置）|
| 发布后 | M6–M9 | ~46–66 |

单人粗估 v1.0 约 3.5–5 个月（双语一等 + 手机端预留各加了一点）;并行/多人可压缩。

## 6. 风险登记

- **签名证书采购**（M5 关键路径）:日历前置，兜底先发未签名版。
- **跨平台打包滑期**（M4）:esbuild 预编译边界 + 原生模块 asarUnpack + 各 OS 差异易反复。
- **内核 pre-1.0 churn**:memoweft schema/迁移标注"可能变";M1 迁移接线 + 精确 pin 是对冲。
- **i18n 半漏回归**（M3）:双语一等最大的坑是"库产出语言"两向都要对——正是咬过你那次（默认 en 泄漏），需在 M3 验收里两向都测。
- **手机端架构税**（F4）:为未定方向现在付一点成本;靠 adapter+web 层对冲把成本压到最低，别在别处再另投预留。
- **图标/安装器美术**（G4）:非工程日历前置，须 M0 就并行起。
- **A2 adapter 收拢**可能撞出隐藏耦合（如 config 单例运行时改写），需一并处理否则 typecheck 不绿。

## 7. Backlog 映射（44 条 + 审查补 7 项 + i18n 4 项 → 落在哪期）

- **M0**:A1 A2 A3 A4 B1 C2 G3 G6
- **M1**:F1 F2 F7 F8 G1 +内核pin
- **M2**:C1 C4 C5 C6 C7 B4 B8 G2 G5
- **M3**:I1 I2 I3 I4〔新增·双语〕
- **M4**:B2 B3 G4 G7(冒烟)
- **M5**:B5 B6 B7
- **M6**:D1 D3 E4 C3
- **M7**:F3 F4 F5 F6
- **M8**:E1 E2 E3 E5 E7 E8 E9 E10
- **M9**:D2 D4 D5 D6 D7 G7(完整)
- **候选**:E6（需与库对齐）

> 审查补的 7 项:G1 schema迁移接线 · G2 记忆备份+GDPR删除 · G3 LICENSE · G4 品牌图标 · G5 反馈回流 · G6 dogfood正式化 · G7 规模/性能。i18n 4 项:I1 脚手架 · I2 双语README/site · I3 英文人格+库语言口径 · I4 英文UI字符串。
