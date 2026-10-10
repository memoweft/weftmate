# MOB-P1 · 手机端细节修复

PR（拉取请求）：[#192](https://github.com/memoweft/weftmate/pull/192)。

本包用合成账号、随机回环端口与系统临时目录；模型请求0。手机网页是实际 `/personal/v1/ui`，安卓为实际 `apps/mobile-ui/www` 界面包加原生桥测试替身；桌面在真实 Electron（桌面程序框架）验收。

**原生整屏复拍待 AND-1 之后补。** MuMu（安卓模拟器）被AND-1占用，本包没有启动或操作模拟器。所有手机截图为390×844／360×780网页内容视口，**不含系统状态栏／导航栏，不能当作第8条第10项的原生整屏证据**。本包不修改安卓版本号，不需要新壳版本，不新增业务接口或权限。

`before/`以MOB-P1修改前的母版／样式运行（合入main的业务修复保留），`after/`以最终母版与生成资产运行。目录内 `verification.json` 记录截图、浏览器错误、布局和动作断言。表中的 `{surface}` 为 `phone-web`／`android-bundle`，`{width}` 为390／360，`{theme}` 为light／dark；相应尺寸高为844／780。桌面补充为 `electron-1120-*`／`electron-480-*`。

逐张可点击链接见[前后对照索引](SCREENSHOTS.md)。

| 项目 | 修复前 | 修复后／打开状态 | 验收结论 |
|---|---|---|---|
| 1 空白欢迎 | `before/{surface}-{width}-{theme}-01-empty.png` | `after/{surface}-{width}-{theme}-01-empty.png` | 同一欢迎文案、字号、字重、间距；全新／隐藏历史／加载分支回归通过 |
| 2 「+」聚焦 | `before/{surface}-{width}-{theme}-02-plus-return-focus.png` | `after/{surface}-{width}-{theme}-02-plus-return-focus.png`、`02-plus-keyboard-focus.png`、`02-plus-menu-open.png` | 程序／触摸模式无聚焦环；键盘模式聚焦环可见 |
| 3 回复贴底 | `before/{surface}-{width}-{theme}-03-completed-follow.png` | `after/{surface}-{width}-{theme}-03-completed-follow.png`、`03-user-scrolled.png` | 高度变化／增长保持贴底；用户上翻才保持阅读位置，按钮恢复跟随 |
| 4 折叠密度 | `before/{surface}-{width}-{theme}-04-collapsed-blocks.png` | `after/{surface}-{width}-{theme}-04-collapsed-blocks.png` | 相邻块的实际几何间隔8px；桌面26px容器间距不再叠加，纯思考消息同处理 |
| 5 记忆标题操作 | `before/{surface}-{width}-{theme}-05-memory.png` | `after/{surface}-{width}-{theme}-05-memory.png`、`05-memory-menu-open.png` | 右侧只留「…」，菜单有刷新；进入／重新打开／下拉读取；错误态仍有带图标重试 |
| 6 手机顶栏 | `before/{surface}-{width}-{theme}-04-collapsed-blocks.png` | `after/{surface}-{width}-{theme}-06-header-menu-open.png`、`06-output-open.png`、`06-usage-open.png` | 标题、带图标菜单、头像；两项动作都实际打开；桌面顶栏保持原布局 |
| 7 抽屉功能区 | `before/{surface}-{width}-{theme}-07-drawer.png` | `after/{surface}-{width}-{theme}-07-drawer.png` | 安卓六入口图标加名称、44px触控高、令牌分隔／按下态；网页侧栏复用既有图标行 |
| 8 其余页面 | `before/*-08-*.png` | `after/*-08-*.png` | 动态、目标、成果库、各设置分类、全屏搜索、图片画廊、文件预览均走查 |

## 走查补修与保留项

- 远程手机设置弹层原单列网格自动均分两行，搜索区被拉出一大块空白；改为搜索行按内容高度、正文填剩余空间。桌面宽布局不受影响。
- 旧版文件预览附属成果行仍显示裸字节数，改用与成果库相同的文件大小格式。
- 手机网页输出列表由新顶栏菜单打开时，以实际「…」作为锚点并恢复焦点；统一菜单选择阻止事件冒泡，避免新打开的面板被外层点击关闭。
- 键盘／审批高度变化用合成布局确定性测试；没有真的操纵系统键盘或系统文件对话框。真实键盘及安全区的系统整屏验收随AND-1补拍。
- 未新增产品取舍；Apple（苹果端）原生对应清单在编排结果中，未把网页截图当成Apple验收。

## 第8条与8a自查

- [x] 1 原生缩放柄、默认按钮／焦点框／details（折叠控件）三角没有残留，沿共享控件与滚动条样式。
- [x] 2 新入口为图标按钮、菜单项或带图标行；悬停、按下、键盘聚焦和禁用沿统一样式。
- [x] 3 顶栏动作归入已有菜单位置，没有在输入区新增一行，保持UX-7单条位及M3-1接入位置。
- [x] 4 浅深两尺寸无页面横向溢出，折叠块间隔通过实际布局断言；功能区使用令牌。
- [x] 5 三种空状态分支区分；加载、错误重试和菜单项禁用沿已有状态，不隐藏真实失败。
- [x] 6 手机网页／安卓界面包390×844与360×780浅深；真实Electron1120／480浅深均有证据。
- [x] 7 只读对照编排 `ref-products/mobile-4.jpg`（ChatGPT）与 `mobile-2.jpg`（Muse）的顶栏、工具层级及输入区密度，没有复制私人参照内容。
- [x] 8 「+」、顶栏「…」、记忆「…」、输出列表、用量、搜索、画廊、预览均有浅深打开状态；新增菜单复用WeftPopover（统一弹层组件）。
- [x] 9 最终矩阵确认通过，布局／操作断言与页面错误结果见 `after/verification.json`。
- [ ] 10 **原生整屏复拍待AND-1之后补**：系统状态栏／底部手势条颜色、图标、刘海／安全区、真实键盘遮挡尚未验。本包按明确分工使用界面包截图，不冒称系统栏已经通过。
- [x] 8a 记忆标题只有「…」；刷新在菜单／页面进入／下拉；文件大小人话；独立页面顶栏按已有家族规则，危险动作沿既有确认。

机械设计扫描只发现两处既有内容：引用正文细边线、隐藏图片预览节点尚未设置图片地址。它们不是本包新增可见缺陷；扫描结果在同目录 `design-scan.json`。

## 验证与公开边界

最终本地完整必过单测、云登录／手机交互、类型检查和清理的成绩见 `validation.json`，完整原日志同目录保存。没有删除用例、增加skip（跳过）或放宽原有保护断言；旧夹具补上实际输入事件、标准DOM（文档对象模型）接口及新菜单路径。

截图源于 `tests/integration/mob-p1-polish.mjs`。原生壳和Apple二进制未构建／发布，未请求8081／18186、未使用真实模型、未打开本人日用程序或数据。

最终成绩：完整必过1372项／1358通过／0失败／14既有跳过；云登录与手机交互102／102，桌面交互夹具62／62，定向15／15。类型检查、46项生成资产检查通过。504张前后图（200前、304后），80项布局／交互断言，页面错误0；交付前需额外终止进程0、归属复核残留0。
