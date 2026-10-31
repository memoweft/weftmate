# 前端框架

> 加功能、加页面、发版，所有端都按这一页。产品该是什么看 [PRODUCT-RULES](PRODUCT-RULES.md)（D125 指到这里），任务怎么走看工作流 `WORKFLOW.md`。
> 覆盖 Windows 桌面与远程网页、安卓、iPhone；Mac 和手表跟苹果一栏走。

## 一句话

一份规格，多个窗口。页面、状态和交互只定一次，颜色、字号、间距、圆角、动效和图标只从母版生成；每端用自己平台的原生控件把它画出来。

## 一、四层

| 层 | 管什么 | 在哪 | 不许 |
|---|---|---|---|
| 产品规格 | 页面清单（第三节）、交互规则（PRODUCT-RULES「界面」）、文案 | 本页 + PRODUCT-RULES | 只写在某一端的代码里 |
| 令牌与图标 | 颜色、字体、字号、行高、间距、圆角、阴影、动效；应用与功能图标 | `design/tokens/tokens.json`、`design/icons/`，用 `npm run tokens:generate` / `npm run icons:generate` 生成各端产物 | 手改生成文件；页面里写死色值、尺寸、时长、自画图标 |
| 共享逻辑 | 状态、请求、动作、恢复、请求身份核对 | 网页 `src/ui-core/`（手机网页副本由 `apps/mobile-ui` 的 `npm run build` 生成）；安卓 `*Model.kt` / `*State.kt`；苹果 `apps/apple/Packages/WeftMateCore` 与 `apps/apple/UI/*Model.swift` | 呈现层自己发请求、存数据、另存一份业务状态 |
| 各端呈现 | 布局、控件、动效、平台手感 | Windows / 远程网页 `src/personal-access-ui/`；手机网页 `apps/mobile-ui/www/`；安卓 `apps/android/app/.../mobile/Native*.kt`；iPhone `apps/apple/UI/` + `iOS/`（Mac `macOS/`，手表 `watchOS/`） | 改业务语义；自创另一套页面结构 |

功能先落共享逻辑和接口，再画各端。某端还没画的，给一个明确去处（例如「在电脑上打开」或原网页入口），不放半成品。

## 二、各端视觉语言

**所有端一样的**：页面清单与导航结构、对话 / 工作两种模式（D92）、过程在上回答在下（D124）、待批准在输入框上方一次一项（D5）、排队与引导（D7）、令牌语义（`canvas` / `surface` / `ink` / `accent` / `brand` 等）、图标、五档时长四条曲线（D28）、浅深色且深色用中性灰（D65）、减少动态效果。

**各端自己的**：

| 端 | 照什么 | 控件从哪来 | 材质 |
|---|---|---|---|
| Windows 桌面 + 远程网页 | D124：Claude / Codex 桌面版的紧凑，MiMo 桌面版的布局和右侧六面板 | `src/ui-core/controls.js` 公共控件（按钮、表单、分组、列表行、菜单、对话框、侧滑面板、骨架），用法见 `design/tokens/README.md` 末节 | 实底，浮层用 `--shadow-float` |
| 安卓 | [zafiro](https://github.com/niki914/zafiro) 那套 Material 3 Expressive：顶栏圆形按钮、大圆角分组卡片、设置列表推子页、底部选项弹层、液态玻璃浮动栏 | `:ui-kit` 模块，以 zafiro 的 `ui-kit` 为蓝本；新控件先进 `:ui-kit` 再用 | 玻璃 / 模糊只给固定栏和浮层，随列表滚动的卡片不模糊；Android 12 以下用实色 |
| iPhone | `design/ios/` 本人已认可的原型和 `design/tokens/ios-prototype.json` | SwiftUI 系统控件 + `PhoneActionMenu`、`.phonePopover`、`.phoneSheet` | 系统材质与系统动画 |
| Mac / 手表 | Mac 用桌面的信息结构、SwiftUI 控件；手表只做短交互（冻结中） | 同 iPhone 共用的 `apps/apple/UI/` | 系统材质 |

安卓配色仍取令牌（`android.colors` / `android.darkColors` 映射成 Material 3 的 `ColorScheme`），zafiro 的动态取色只作外观选项（D14），默认不开。

zafiro 是 MIT 许可：复制过来的文件保留原版权头，`:ui-kit` 模块根目录放一份它的 `LICENSE`；图标仍用 `design/icons/`（D90），文案自己写。

## 三、页面清单

新页面先加进这张表，再开任务包。和 PRODUCT-RULES 冲突就停下问本人。

| 页面 | 内容 | 哪些端有 |
|---|---|---|
| 聊天 | 对话与工作两种模式、输入区、模型菜单（D91）、附件、过程与回答、审批、提问、排队、下一步建议（D51） | 全部 |
| 对话列表与侧栏 | 搜索在最上（D53）、对话菜单（D34）、状态位（D55）、项目 | 全部 |
| 动态 | 待批准、提问、失败、完成回执、周回顾 | 全部 |
| 目标与提醒 | 进行中、定时、长期目标 | 全部 |
| 成果库 | 文件预览、保存、分享、旧版本 | 全部 |
| 记忆 | 理解、来源、纠正、停用、遗忘（D16、D33） | 全部；手机读电脑同步来的副本（D119） |
| 健康 | 指标、趋势、解读（冻结） | 手机、手表 |
| 设置 | 常规、外观、模型服务、审批、账户、设备、已归档、系统状态、关于（D31） | 全部 |
| 登录与配对 | 账号、邮箱验证、扫码或输入码配对（D93、D23） | 全部 |
| 桌面右侧面板 | 审查、终端、浏览器、文件、侧边聊天、子任务（D124） | Windows、Mac |

手机底部导航按 D56 五项。iPhone 设计稿提议三项（聊天 / 动态 / 健康）加侧栏，本人确认后改 D56，两部手机一起改。

## 四、加功能、加页面

按工作流开包，任务书「要成的样」和证据按下面写：

1. **范围**：写清动哪几端。默认顺序 Windows → 安卓 → iPhone（D118）；只做一端的，写明其他端的去处。
2. **先逻辑后界面**：新状态、请求和动作进共享逻辑层；手机网页副本用 `apps/mobile-ui` 的 `npm run build` 生成，不手抄。
3. **只用令牌和图标**：缺值先改 `tokens.json` 再生成；缺图标按 `design/icons/README.md` 画（24 网格、线宽 1.75、只用 `currentColor`）再生成。新控件进各端的公共控件层（网页 `ui-core/controls.js`、安卓 `:ui-kit`、苹果 `apps/apple/UI/`）。
4. **每页五种状态**：正常、空、加载（骨架）、出错（人话加重试）、离线（电脑不在线或没网，D13）。外加浅色、深色、减少动态效果，窄屏和宽屏。
5. **文案**：人话，不露内部编号和错误码。
6. **证据**（`wfm prove`）：每个动到的端，真实程序的浅色和深色截图，加一条真实操作路径（点了什么、看到什么）。

| 端 | 在哪截 | 注意 |
|---|---|---|
| Windows | 真实 Electron 程序，用测试身份 | 不碰本人日用安装和数据（D115） |
| 手机网页 | Chromium 390 × 844 | |
| 安卓 | MuMu 模拟器上的独立测试包（`-PweftmateApplicationId=com.memoweft.weftmate.mobile.<短名>qa`） | 不覆盖已有应用；构建见 `apps/android/README.md` |
| iPhone | Mac 上的模拟器，393 × 852 | 这台 Windows 只能跑 `generate_project.py` 和 Python 检查；Swift 编译和截图要 Mac 或 `apple.yml` |

## 五、上线

按改了什么选路，不确定就按更重的那条走。

| 改了什么 | 走哪条 | 怎么发 | 何时生效 |
|---|---|---|---|
| 桌面 / 远程网页界面（`src/personal-access-ui/`、`src/ui-core/`） | Windows 界面包热更新（D32） | `node scripts/release/package.mjs --layer ui …`，再 `node scripts/release/verify.mjs …` | 下次打开 |
| 手机网页（`apps/mobile-ui/www/`） | 手机界面包 | `package.mjs --layer mobile-ui --min-native-version-code <N> …` | 安卓壳连电脑时下载校验，下次打开 |
| 安卓原生（Kotlin、资源、权限、桥） | 新壳 APK | Gradle 构建后作为 `android-candidate.apk` 放到 `desktop-config.json` 的 `androidPackagePath`，手机从 `/personal/v1/downloads/android` 下载；官网也放一份（D46） | 装新壳后 |
| Windows 主进程、Electron、安装器 | 程序本体 | `npm run release:windows`；手动发布用 `package.mjs --layer app …` | 重启后 |
| 苹果端 | 原生构建 | Mac 上 `make build-phone` / `make build-mac`；Mac 更新入口 `scripts/release/apple-manifest.mjs` | 重新安装（7 天签名，D38） |

完整参数见 `scripts/release/README.md`。发版前：

- `node scripts/generate-tokens.mjs --check` 通过（生成物和母版一致）。
- 界面包用到新原生能力的，`--min-native-version-code` 写到那一版；新桥、新权限一定出新壳。
- 安卓版本号在合并时统一加一次（`versionName` / `versionCode`）。仓库里没有正式签名配置，出正式包前先确认签名方式，密钥不进仓库（D115）。
- 本人能感觉到的改动，在 `docs/changelog/<短名>.pending.md` 写一句人话。
- 合并后的 Windows 全量与打包检查要绿（工作流 L2）。
- 修好的 Windows 版本推到 weftmate.com 更新目录（D115）；本人日用程序何时重启由本人定。

## 六、谁定什么

本人定：各端视觉方向、页面清单增删、底部导航、解冻功能、什么时候发版。其余在这页之内由干活的人定。

文档冲突时：产品行为看 PRODUCT-RULES，技术事实看 ARCHITECTURE，界面怎么做、怎么上线看这页。
