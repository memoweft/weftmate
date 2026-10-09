# UX-1 · 界面一致性

本目录使用临时目录、随机回环端口、合成账户和确定性提问 / 审批事件。没有连接日用程序、18186、8081，没有模型请求，也没有读取本人运行数据。

通过 Playwright（界面自动化工具）的 `_electron.launch` 启动生产 `createPersonalDesktop` 窗口；同时验证 390×844 手机远程网页，以及 `apps/mobile-ui/www` 安卓界面包在 Chromium（浏览器自动化引擎）中的同一场景。这里验证的是安卓界面包，没有安装或修改本人安卓应用，也没有宣称原生壳或 Apple 已验收。

浅 / 深主题共 74 张截图。`desktop-` 是真实 Windows 程序，`mobile-web-` 是手机远程网页，`android-ui-` 是安卓界面包。`checks.json` 记录行为结果，`screenshot-text.json` 是每张截图同一时刻的合成 DOM（页面结构）可见文本，用于持续集成扫描；没有声称使用 OCR（图像文字识别）。

| 截图后缀 | 已验证的行为 |
|---|---|
| `01-approval-priority` | 审批与四个问题同时存在；审批优先，明确提示处理审批后还有四个问题 |
| `02-single-choice` | 单选按钮与「还有 3 个问题」 |
| `03-other-input-enter` | 其他回答替换单选；输入框回车不提交 |
| `04-expanded-description` | 展开完整说明、选项含义 |
| `05-multiple-choice` | 多选与补充回答同时保留；选中状态可见 |
| `06-free-answer` | 自由回答，回车不提交；提交按钮聚焦后回车提交 |
| `07-next-batch` | 第一批原契约整批提交，下一批接替；对话只留一行已回答记录 |
| `08-answered-bar-removed` | 安卓界面包提交其他回答后，各端提问条立即消失 |
| `09-chinese-sources`、`09b-source-detail` | 来源中的读取、命令、搜索、工具准备、写入、提问与未登记扩展均中文；展开详情的参数键也中文 |
| `10-chinese-month-picker`、`11-local-time-usage` | 共用月份下拉、中文时区与日期；设备时区传给真实统计接口 |
| `12-memory-category` | 安卓界面包复用共用下拉与底部列表，选择「关系」后真实查询类别切换；系统原生下拉不再可见 |

日期边界另有自动测试：上海跨日 / 跨月、洛杉矶跨日、无效日期。已有用量统计的上海午夜与月末测试保持通过。日期显示统一由 ui-core（共用界面核心）负责，用量原有设备时区与账户预算接线保留。

Windows「界面密度」与静态「通知」行已移除：没有可配置行为的项目不占据设置。真实系统通知与既有开机自启继续运行；安卓已有实际通知控制保留。密度搜索关键词同步移除。新增可配置密度应由后续产品包定义完整令牌与各端行为。

内部操作名称和参数显示名集中于 `src/ui-core/timeline-model.js`；来源、进展、审批与手机动作复用这套名称。未知扩展显示「扩展服务」，未知参数使用中文附加信息编号。宿主字段、请求和身份校验保持原样；文件正文、命令和实际输出保留内容。

验证命令：

```powershell
node tests/integration/ux-1-consistency.mjs
node tests/integration/ui-p3-inline-progress.mjs --verify-only
node --test tests/ui-copy-consistency.test.ts tests/ui-core.test.ts tests/personal-access-ui-interaction.test.ts tests/personal-timeline-native.test.ts tests/design-tokens.test.ts tests/mobile-ui-core-assets.test.ts tests/personal-usage.test.ts tests/personal-settings.test.ts tests/personal-desktop-motion.test.ts apps/mobile-ui/tests/chat-interactions.test.mjs apps/mobile-ui/tests/approval-interactions.test.mjs apps/mobile-ui/tests/queue-interactions.test.mjs apps/mobile-ui/tests/visual-interactions.test.mjs apps/mobile-ui/tests/motion-interactions.test.mjs
node scripts/check-ui-copy.mjs
npm run typecheck
node apps/mobile-ui/src/build-ui-core.mjs
node scripts/review-gallery/capture.mjs --out .local/review-gallery-ux1
node scripts/review-gallery/build.mjs --out .local/review-gallery-ux1
node tests/integration/review-capture-gallery.mjs --out .local/review-gallery-ux1
node --test tests/integration/review-capture-evidence.mjs
```

定向回归 241 项分批通过，最后重跑的核心 / 界面 / 资源 / 文案集合 223/223；UI-P3（输入区审批与进展）真实程序和两种手机界面回归通过。审稿页 48 个实时合成场景全部通过，四种视口 / 主题、公开证据检查通过。完整测试由本包 PR（合并请求）的 CI（持续集成）执行。

Apple 交接清单：

1. macOS / iOS 把提问卡移到输入区上方，与审批共用位置；审批优先并提示剩余问题。逐题填写，最后按现有问题回答契约整批提交；回执成功后移除，只在原位置留一行回答。保留原请求重试、账户 / 设备 / 来源约束；回车只在提交按钮聚焦时提交。
2. 来源列表、详情、审批、进展、错误提示和设置采用同一中文操作表与参数显示名；未知扩展中文兜底，禁止内部工具名作为显示名。Watch 的审批描述同步中文。
3. 日期使用本人设备时区、中文年月日和 24 小时制；用量统计继续传设备时区，月份使用原生共用选择器。
4. 清理 macOS「开机自启 · 即将支持」；实现真实行为或移除静态行。密度与通知同样按实际能力显示；Windows 本包选择移除空壳行。
5. 原生 Apple 浅 / 深重新截图并做相同的可见文本扫描；本包没有修改 `apps/apple/`。
