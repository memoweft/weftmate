# UI-P3 · 对话内单行工具进展（D35）

本目录全部为合成账号、工具事件、命令、文件内容。参考图仅在本机查看，没有复制或提交。没有使用本人日用宿主、账号、模型密钥或运行数据。

验收通过 Playwright（界面自动化工具）的 `_electron.launch` 启动生产 `createPersonalDesktop` 窗口，连接临时目录与随机端口的真实个人入口服务；工具事件由合成 DSH（助手运行时）日志投影提供。同时运行手机界面包及桌面共用界面的 390×844 远程网页，均测试浅 / 深模式。没有使用模型生成来替代确定性工具事件。

## 截图

`desktop-` 为真实 Electron（桌面程序框架）窗口；`mobile-` 为手机界面包；`mobile-web-` 为手机远程网页。三种表面分别有 `light` / `dark`，每组 15 张，再加桌面 / 手机纯文字截图，共 92 张。

| 文件后缀 | 场景与断言 |
|---|---|
| `01-loading` | 真实加载阶段作为对话首行，无工具卡 |
| `02-working-command`、`03-working-read`、`04-working-search` | 三个不同真实事件立即更新当前步骤；减少动态效果时停止文字动效 |
| `05-completed-collapsed` | 按命令 / 文件 / 搜索计数的灰字单行 |
| `06-expanded` | 细边框圆角列表；Enter（回车键）/ 空格展开，读屏名称含展开状态 |
| `07-step-output` | 单步可展开，紧凑参数 / 输出可复制 |
| `08-approval-two-pending` | 输入框上方审批条一次显示一个，提示还有一个待批准 |
| `09-approved-current-removed` | 批准后当前审批立即移除，下一项接替 |
| `10-rejected-bar-removed` | 拒绝最后一项后审批条消失；列表保留已批准 / 已拒绝 |
| `10b-single-approval`、`10c-approved-bar-removed` | 单项批准后审批条消失；详情上按 Enter 不提交批准 |
| `11-artifact` | 成果文件独立显示，标明已读回核验 |
| `11-failure-artifact` | 第 9 个真实步骤失败，警示色并默认展开，成果仍独立可见 |
| `12-stopped` | 等待实际终止事件后截取已停止状态 |
| `desktop-pure-text`、`mobile-pure-text` | 纯文字回复无工具进展行，出字后等待首行消失 |

`checks.json` 记录三种表面的行为断言：事件与正文顺序、流式保留展开、键盘操作、审批收起与回执、失败详情、成果核验、无横向溢出和减少动态效果。

## 验证命令

```powershell
node tests/integration/ui-p3-inline-progress.mjs
node tests/integration/desktop-ui-interactions.mjs
node --test tests/personal-access-ui-interaction.test.ts tests/ui-core.test.ts tests/personal-timeline-native.test.ts tests/design-tokens.test.ts tests/mobile-ui-core-assets.test.ts apps/mobile-ui/tests/chat-interactions.test.mjs
node --test tests/personal-desktop-motion.test.ts
node --test apps/mobile-ui/tests/approval-interactions.test.mjs apps/mobile-ui/tests/queue-interactions.test.mjs apps/mobile-ui/tests/visual-interactions.test.mjs apps/mobile-ui/tests/motion-interactions.test.mjs
npm run typecheck
node scripts/generate-tokens.mjs --check
node apps/mobile-ui/src/build-ui-core.mjs --check
```

主定向回归 197/197；现有桌面浅深交互、两种停止方式、桌面和手机动效回归通过。审批异常重试仍复用原请求，原账号 / 设备 / 来源绑定与终止单调性断言保留。复用现有颜色、字体、间距、圆角及动效令牌，无需新增令牌。界面精修技能的机械检查只报告原有引用块边框，未改动该范围外样式。

审稿页同步更新了按名称 / 角色查找的截图测试；本地生成与公开证据检查通过，40 个实时合成场景无失败，四种视口 / 主题检查通过。完整测试由 PR（拉取请求）的 CI（持续集成）执行，包括审稿页工作流。

未改宿主事件、客户端接口、审批模式和既有批准 / 拒绝契约；未重打安装包、发布手机更新包或执行日用升级。Apple（苹果）原生客户端不在本包范围。
