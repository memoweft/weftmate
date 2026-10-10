# UX-P2 · Windows-6 前端过关包

本人点名的 A 项已全部实现，B 走查见 [walkthrough.md](walkthrough.md)：**584 行、107 个命名场景**。使用真实 Electron（桌面程序框架）1200 / 480px、手机网页与安卓界面包 360×780 / 390×844，以及真实 MuMu（安卓模拟器）独立包；均含浅 / 深色。

全部合成账号、随机端口、临时目录，真实模型请求 **0**。未访问本人日用程序、Runtime 日用数据、8081，未提交参考产品截图、凭据或运行数据。A 的“前”使用 `4dfcb5c5` 的原界面资源；FX-17 与原生透明文字的前图沿用已经提交的合成证据。

## A 逐条前后对比

| 本人点名 | 结果 | 修复前 | 修复后 |
|---|---|---|---|
| 1 输入框缩放把手 | 主输入一行起、约八行封顶后内部滚动、删除回缩；设置 / 弹窗 / 问题 / 记忆 / 离线 / 旧兼容页全仓多行输入去掉把手 | [原输入](before-electron-1200-light-composer-empty.png) | [一行](after-electron-1200-light-composer-empty.png)、[多行封顶](after-electron-1200-light-composer-long.png)、[手机](after-phone-web-360-dark-composer-long.png)、[原生](after-1-android-native-dark.png) |
| 2 开旁聊裸入口 | 核对桌面与手机，仅在“+”菜单内，输入下方无文字入口 | [前菜单](before-electron-1200-light-composer-menu.png) | [桌面](after-electron-1200-dark-composer-menu.png)、[手机](after-phone-web-390-light-composer-menu.png) |
| 3 无模型提示 | 标题上方提示移除；空对话为中央模型卡，有历史为输入区上方统一提示；禁用输入，占位“先添加一个模型”；目录未读到不误称无模型 | [前空状态](before-electron-1200-dark-no-model-empty.png)、[前历史](before-electron-1200-light-no-model-history.png) | [空卡](after-electron-480-dark-no-model-empty.png)、[历史条](after-electron-1200-light-no-model-history.png)、[手机空卡](after-phone-web-360-dark-no-model-empty.png) |
| 4 D49 用户消息 | 气泡只包文字；悬停 / 聚焦时气泡外下方右对齐账户时区时间与直接复制，当天为 `8:28`；手机长按仅复制 / 引用，轻点显示时间；已处理消息全部移除编辑 / 重发入口；排队编辑 / 撤回与助手版本保留 | [气泡内操作](before-electron-1200-light-user-hover.png) | [悬停](after-electron-1200-light-D49-user-hover.png)、[键盘](after-electron-480-dark-D49-user-keyboard.png)、[手机长按](after-android-bundle-390-dark-D49-long-press.png)、[手机时间](after-android-bundle-360-light-D49-tap-time.png) |
| 5 全局滚动条 | 浅深色共享令牌、细轨、悬停加粗拇指、不改轨道宽度；对话 / 侧栏 / 设置 / 菜单 / 弹窗统一，隐藏箭头 | [前设置](before-electron-1200-dark-settings-general.png) | [深设置](after-electron-1200-dark-settings-general.png)、[窄设置](after-electron-480-dark-settings-memory.png)、[原生设置](after-5-android-native-dark-settings.png) |
| 6 回复更多菜单 | 共用竖排菜单、图标、四态、阴影圆角、贴边翻转、方向键 / Esc（退出键）；换模型为子菜单并勾当前；仅有未确认请求时出现“上次发送未确认，重试”；目标页新增菜单也复用同一组件 | [默认菜单](before-electron-1200-dark-reply-menu.png) | [回复菜单](after-electron-1200-dark-D49-reply-menu.png)、[模型子菜单](after-electron-480-light-D49-model-submenu.png)、[设置下拉](after-electron-1200-dark-settings-助手-select-回答详细程度.png) |
| 7.1 用户气泡底部空白 | 操作条离开气泡，气泡高度只包括文本与正常内边距 | [前](before-electron-1200-light-user-hover.png) | [后](after-electron-1200-light-D49-user-hover.png) |
| 7.2 对话菜单滚动 / 快捷键 | 自适应自然高度、仅不足时滚动，快捷键独立右对齐 | [前 UX-P1](../ux-p1/after-05-desktop-light.png) | [浅](after-electron-1200-light-session-menu.png)、[窄深](after-electron-480-dark-session-menu.png) |
| 7.3 深入思考框 | 分隔线下的同款开关菜单项；关闭状态也显示空框，开启显示勾选 | [前](before-electron-1200-dark-composer-menu.png) | [同款菜单](after-electron-1200-dark-composer-menu.png) |
| 7.4 安卓兜底文字透出 | WebView（安卓网页视图）不透明；界面就绪回执后隐藏原生兜底；原生主对话与输入区实拍确认 | [原生前图](../ux-p1/after-14-android-native-dark.png) | [真实浅](after-1-android-native-light.png)、[真实深](after-1-android-native-dark.png) |
| 7.5 记忆筛选 / 导出 / 来源 | 导出移到刷新旁的更多菜单；筛选、搜索分开；来源为图标链接 | [前](before-electron-1200-light-memory-normal.png) | [布局](after-electron-1200-light-memory-normal.png)、[导出菜单](after-electron-1200-dark-memory-export-menu.png) |
| 7.6 纠正失败重复提示 | 与健康状态共用图标 / 数量 / 查看；展开原话、时间、来源、重试；对话回合下方共用提示条；保留 FX-17 重试接线与原请求编号 | [FX-17 前图](../fx-17/rejection-final/rejected-correction.png) | [桌面卡](after-electron-1200-dark-memory-rejected-expanded-final.png)、[对话条](after-electron-480-light-memory-turn-warning.png)、[手机卡](after-phone-web-390-dark-memory-rejected-expanded.png) |
| 7.7 手机搜索 | 两箭头同样式；更多结果改“更多” | [前](../ux-p1/after-14-web-360-dark.png) | [360 深](after-phone-web-360-dark-main-search.png)、[390 浅](after-phone-web-390-light-main-search.png)、[原生深](after-14-android-native-dark.png) |

D49 已加入 `docs/PLAN.md`，消息操作与无模型 / 记忆规范已同步 `docs/UI_SPEC.md`。宿主消息分支接口保持不变。

## B 发现并补齐

- 通用确认框此前漏了主题背景，深色时出现白底浅字；已补主题表面。480px 的桌面确认框按内容定高，设置保留自身布局。[密码深色](after-electron-480-dark-dialog-password-dialog.png)、[项目移除](after-electron-1200-dark-project-remove-dialog.png)。
- 设置弹窗内菜单挂在模态范围外会不可交互；现挂在当前弹窗内。没有可选项的下拉也能消费 Esc，关闭自己的层。子菜单选中后关闭整组菜单并恢复焦点。
- 手机旁聊重绘会丢最后回复操作，已保持最后助手回复可见；只显示用户复制图标，不让用户按钮重新进入气泡。
- 手机输入状态节点曾重复，且账户切换完成后留下“正在切换账户”；已去重并在转换完成时清除。资料字段缺失时不显示 `undefined`。
- 深色的新模型主按钮 / 重试按钮使用反差文字；健康状态保留正常绿色，失败使用警示图标。原生默认日期选择器替换为统一的日期输入，支持 Enter / Esc 与日期格式说明。
- 合最新 main 后保留目标页，统一目标菜单与消息菜单；新建定时 / 长期目标、所有下拉均有浅深与手机打开态。[目标表单](after-phone-web-390-dark-goal-schedule-form.png)。

无需要另做设计的前端遗留。产品本来尚未实现的能力保持真实禁用 / 空 / 错误状态，没有补假开关或假成功。

## 验证

- 最后相关 Node（脚本运行环境）单元 / 契约 **179/179**；手机聊天 / 视觉 / 排队交互 **97/97**；`npm run typecheck`、手机母版生成 / 一致性与语法检查通过。
- `ux-4-message-actions.mjs`：真实桌面、手机网页、安卓界面包、手机本机、长回复通过；已处理用户无编辑，助手反馈 / 引用 / 换模型重新生成 / 版本 / 脱敏导出保留。[记录](interaction/interaction-checks.json)。
- `ux-4-main-chat.mjs`：重新生成产生带来源旁聊，主对话历史不变，原分支接口保留。[记录](main-actions/main-chat-checks.json)。
- `ux-p2-final.mjs`：账户时区 `8:28`、操作条几何位置、悬停 / 聚焦、手机长按 / 时间、单条纠正提示、菜单键盘与选中态。[记录](final-checks.json)。
- `ux-p2-walkthrough.mjs`、`ux-p2-states.mjs`、`ux-p2-overlays.mjs`：全部走查截图；前图用原提交资源，后图用当前界面。确认窗口的结构验收与实际行为验证在表里区分。
- Android（安卓）独立包 `com.memoweft.weftmate.mobile.uxp2qa`：`assembleDebug / assembleDebugAndroidTest` 通过，真实 MuMu 主对话、可用输入、设置、搜索浅深通过，[记录](android-native-checks.json)。原生实拍当时为 0.8.16 / code29；最后合入 S3a 后沿用 main 的 0.8.17 / code30，本包未自行改号；两个 APK、端口转发已清除，本包启动的模拟器已关闭。
- 审稿页别名更新，构建生成 74/204 场景图片；未实现 / 未取得的其他平台格子保留原状态。impeccable（界面设计打磨）机械检查仅报告原有 Markdown（标记文本）引用块的 2px 引用线，属于正文引用语义，不是侧栏装饰；未把扫描当作视觉验收。
- 完整测试由推送后的 CI（持续集成）执行，本包只取 `gh pr checks` 快照，最终结果由 Claude 看。

## 第 8 条清单自查

- [x] C1 无原生缩放把手；滚动条 / 日期 / 下拉 / details（折叠控件）统一。
- [x] C2 可点击外观和悬停 / 按下 / 聚焦 / 禁用四态。
- [x] C3 旁聊、导出等入口回到已有工具和菜单，模型提示处于中央或输入区提示位。
- [x] C4 气泡、菜单快捷键、设置、筛选、窄窗与输入区的对齐 / 间距 / 滚动复核。
- [x] C5 模型与开关状态可见，加载 / 空 / 错误有呈现。
- [x] C6 浅深、480px、360×780、390×844 与原生安卓已看。
- [x] C7 本机对照 Codex / Claude / ChatGPT / Muse 的输入、菜单、空状态、设置密度。
- [x] C8 每类菜单 / 弹层 / 对话框 / 下拉打开态有浅深证据。
- [x] C9 发现的前端问题已修并复核；0 个设计遗留。

## Apple 对应清单

1. Mac 的输入视图由一行增到约八行后内部滚动；iPhone 同步。普通多行设置 / 纠正编辑区不提供原生缩放把手。
2. “开旁聊”只在附件 / 更多菜单中；无模型为空对话中央卡，有历史为输入区提示，输入禁用且占位“先添加一个模型”；模型目录读取失败与空目录区分。
3. D49：Mac 在用户气泡外下方右对齐显示账户时区时间和复制；今天时分、更早日期；iPhone 长按复制 / 引用，轻点显示时间。已处理消息的编辑 / 重发菜单与快捷键下线，只保留排队编辑 / 撤回；宿主接口不动。
4. 助手操作保留复制、反馈、引用、导出、重新生成 / 版本切换；更多和模型子菜单统一四态、选中标记、键盘与贴边翻转；只在确有未确认发送时显示重试。
5. Mac / iPhone 滚动指示与弹窗浅深样式统一；确认框紧凑，子菜单关闭及焦点恢复完整，深入思考为普通开关项。
6. 记忆导出收进工具菜单，筛选 / 搜索分组、来源图标链接；健康与纠正失败使用同一提示 / 展开卡，包含原话、时间、来源与重试；对应对话回合采用同款提示条。
7. iPhone 搜索箭头与更多结果语义一致。Watch（苹果手表）没有输入区，无需新增设置；它的消息展示不能恢复已处理消息的编辑入口。
8. 本包没有修改 Apple 原生代码，只生成了共享令牌清单；各端按此清单做原生验收。

**需要新壳版本**：安卓 WebView 不透明与 ready 时隐藏兜底文字涉及 Kotlin（原生壳语言）；由 Claude 发布时统一递增版本号，本包不改 versionCode / versionName 或界面包默认最低版本。
