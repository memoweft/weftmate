# AGENTS.md · WeftMate

接手先读三份：**本文件、`docs/PRODUCT.md`、`CURRENT.md`**。
需要规划后续时再读 `docs/ROADMAP.md`；需要完整代码事实、演进和风险时读 `PROJECT_ANALYSIS.md`。可视化蓝图是 `docs/blueprint.html`。

## 这是什么

WeftMate 是一个**越用越了解你的 AI 桌面伴侣**：Electron 桌面常驻 App，面向普通用户，也是 MemoWeft 的官方产品验证。

- **MemoWeft**：独立、完全开源的个人 AI 记忆能力层；本仓库只把它当依赖。
- **WeftMate**：本仓库的用户产品，负责对话、人格、Agent、感知、隐私和交付。
- **星瑶 / Aria / 普通助手**：WeftMate 的可切换人格，不是产品名，也不拥有独立用户记忆。

一句话边界：**MemoWeft 是记忆内核，WeftMate 是产品，人格是可选择的外壳和能力配置。**

## 文档职责

- `docs/PRODUCT.md`：产品定位和 owner 已拍板的长期边界。
- `docs/ROADMAP.md`：少量大阶段、模块范围和退出标准。
- `CURRENT.md`：唯一“现在做到哪里、下一步做什么”看板。
- `PROJECT_ANALYSIS.md`：特定日期与 HEAD 的完整代码审计快照，不是当前任务源。
- 源码、测试和 Git：功能是否真实存在的最终证据。

## 红线

- **不碰 MemoWeft 源码**：只通过依赖和 `src/memoweft.ts` adapter 使用公开接口；MemoWeft 的内核、协议和社区治理留在它自己的仓库。
- **守 MemoWeft naming 口径**：不吹“真正理解你”；记忆不等于相信；慢活诚实说需要时间；用户侧不露 0–1000 原始把握度；MemoWeft 能力层文案不用“她”；第一人称只属于人格体验层。
- **工具定义延迟加载**：上下文只放名字和极简签名，用到再展开。
- **主动打断只报 P0/P1**：少而准，不把陪伴做成骚扰。
- **隐私可控**：observed 默认不上云；API key 不明文落盘，使用 Electron `safeStorage`；分享人格时绝不包含用户记忆。
- **能力不等于权限**：AI 更聪明或更了解用户，都不能自动扩大文件、工具、感知或设备权限。
- **当前不做多 Agent**：允许单 Agent 和基础工作流，不扩展成多 Agent 协同系统。

## 开发纪律

- 改功能前先查 `CURRENT.md`，不要按旧提交日志或过期百分比继续施工。
- “已完成”必须能指向代码可达路径和验证证据；只有底层、没有用户路径时标 `partial`。
- 人格包与记忆包分开：人格是可分享配置，记忆属于用户。
- 执行自主度与陪伴主动度是两个设置，不要复用同一个开关。
- 保留用户最高修改权，区分画像“修改”和推断“指正”。
- 改完至少运行 `npm run typecheck` 与 `npm test`；涉及 Electron 主进程、UI、安装或原生模块时追加对应真机验证。
- 独立仓库和发布版本不得使用 MemoWeft sibling `file:` 依赖；必须精确固定公开版本，并在无 sibling 的干净目录验证安装、类型检查、测试和 Electron 启动。

## 运行

当前开发树：

```bash
npm start
npm run typecheck
npm test
```

是否能从干净克隆安装、打包和发布，以 `CURRENT.md` 的最新验证为准。
