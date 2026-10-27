# WeftMate 设计令牌

`tokens.json` 是颜色、字体、字号、行高、间距、圆角、阴影与动效参数的唯一来源。桌面与手机网页共用 `src/ui-core/controls.js` / `controls.css` 的公共层；原生兼容令牌仍从同一母版生成。

## 修改与生成

在仓库根运行 `npm run tokens:generate`。脚本与图标生成脚本一样，用 Node（脚本运行环境）的文件接口从母版生成并提交各端产物；没有新增依赖。用 `node scripts/generate-tokens.mjs --check` 核对生成物是否与母版逐字一致，不写文件。

| 生成位置 | 消费方式 |
|---|---|
| `src/personal-access-ui/tokens.css` | 桌面与远程网页先加载令牌，再加载组件样式；静态资产由现有个人入口提供 |
| `apps/mobile-ui/www/tokens.css` | 手机 Web 先加载令牌；Android 内置资源与服务器更新包自动包含该文件 |
| `apps/android/app/src/main/res/values/design_*.xml` | 颜色、dp（密度无关像素）/ sp（字体缩放像素）尺寸、毫秒时长与曲线资源；网页背景对应显式选择的浅深模式 |
| `apps/android/app/src/main/res/values-night/design_colors.xml` | C4 品牌色的系统深色资源 |
| `apps/android/app/src/main/java/com/memoweft/weftmate/mobile/DesignTokens.kt` | 现有原生辅助函数需要的无上下文颜色与 dp / sp 数值，同一母版生成 |
| `design/tokens/generated/apple/DesignTokens.json`、`DesignTokens.swift` | Apple（苹果客户端）原生接入：三个 Xcode 目标直接编译生成的 Swift 文件；`AppleTokens` 提供 pt（点）尺寸、系统字体、动态颜色与秒制原生动画，JSON / `WeftDesignTokens` 保留毫秒与跨平台配方 |

精修某个用途时，改下列对应字段，再生成、检查相关交互、比较真实程序截图，一并提交母版与产物。不要手改生成文件。新增用途先复用现有语义；有实际不同的用途才新增名称。与几何相关的视口断点、百分比、网格比例和功能计时器仍属于组件布局与业务逻辑。

## 颜色与主题

`surfaces.desktop.themes`、`surfaces.mobile.themes` 保存现有主题选择器及其语义变量。默认项为浅色，`data-theme="dark"` 为深色；桌面的蓝、绿、紫预设和各自深色项保持原优先级。主题色主按钮继续使用石墨 / 既有预设；C4 天蓝是独立的 `--brand`，浅色 `#0A7AFF`、深色 `#4DA3FF`。

| 语义变量 | 用途 |
|---|---|
| `--canvas` | 页面 / 导航背景中性色 |
| `--window-frame` / `--sidebar` | 窗口外框与侧栏；工作区左侧拖动区与侧栏连续，原生窗口按钮跟随主内容与当前弹层 |
| `--panel` / `--panel-divider` | 独立主面板与侧栏之间的细分隔；桌面与手机网页共用语义 |
| `--surface` | 内容、输入区与浮层表面；也用于主按钮反色文字 |
| `--surface-soft`（桌面）、`--soft`（手机） | 次级区域、代码与执行块底色 |
| `--ink` | 正文与标题 |
| `--ink-secondary` / `--secondary` | 次级文字、次级操作 |
| `--ink-muted` / `--muted` | 说明、占位、时间 |
| `--line` | 中性色边框和分隔线 |
| `--accent`、`--accent-hover`（桌面）、`--accent-soft` | 主题色主按钮、悬停与选中底色 |
| `--brand` | C4 品牌强调色；不替换用户所选主题色 |
| `--success`、`--success-soft` | 完成 / 可用状态及底色，保留现有实际颜色 |
| `--warning` | 审批 / 待处理状态点 |
| `--danger`、`--danger-soft`（桌面） | 错误、危险操作与提示底色 |
| `--shadow`、`--shadow-float`（桌面） | 现有基础与浮层阴影；随主题保留原值 |
| `--ease`（手机） | 现有手机展开曲线 |

`shared.color` 中每一项输出为 `--wm-color-<名称>`：

| 名称 | 用途 |
|---|---|
| `brand-light`、`brand-dark` | C4 浅深品牌色 |
| `header-translucent` | 旧页头半透明白色背景 |
| `control-border`、`control-border-hover` | 旧表单边框与悬停边框 |
| `on-action`、`white` | 固定白色文字 / 表面，包括图片查看器 |
| `danger-hover` | 危险按钮悬停 |
| `desktop-scrim`、`mobile-scrim`、`approval-scrim` | 桌面抽屉 / 对话框、手机抽屉、审批风险说明遮罩 |
| `image-canvas`、`image-close` | 桌面图片查看器背景与关闭按钮 |
| `success`、`success-soft`、`warning` | 桌面完成标签 / 底色、审批状态点 |
| `fallback-ink`、`fallback-line`、`fallback-soft`、`fallback-action-line`、`fallback-accent` | 共用时间线已有的颜色回退 |
| `composer-send-icon` | 手机旧发送图标颜色 |
| `code-canvas`、`code-ink`、`code-heading`、`code-copy` | 手机旧代码块及代码复制控件颜色；现有后续样式覆盖照常生效 |
| `syntax-keyword`、`syntax-string`、`syntax-comment` | 手机旧代码高亮，保留现有层叠覆盖 |
| `toast-danger` | 手机错误提示 |
| `mobile-preview-canvas`、`mobile-preview-ink` | 手机图片查看器基础颜色 |
| `preview-topbar-scrim` | 图片查看器顶部渐变的遮罩色 |
| `preview-close`、`preview-close-active` | 图片关闭按钮常态与按下状态 |
| `mobile-success`、`mobile-warning` | 手机共享回合完成点、待审批点 |
| `mobile-image-canvas` | 手机图片查看器最终背景 |

`android.colors` 保留 `Weave` 兼容原生页实际使用的 `accent / ink / secondary / muted / canvas / surface / soft / accentSoft / line / lineStrong / danger / dangerSoft / overlay / success`；`webSurfaceLight / webSurfaceDark` 对应当前手机 Web 背景。兼容页此前没有深色调色板，本包保留该行为；新入口的深浅主题由 Web 令牌与显式原生窗口背景共同控制。

## 字体、字号与行高

| 字段 | 用途 |
|---|---|
| `shared.fontFamily.body` | 当前系统正文字体栈，含中文回退 |
| `mono` | 执行详情、原始输出、资源文档的等宽字体栈 |
| `mono-extended` | 代码块含 SFMono-Regular（苹果等宽字体）的回退栈 |
| `mono-desktop` | 桌面已有 Consolas 优先的代码字体栈 |
| `system` | Windows（微软桌面系统）标题栏字体 |
| `shared.fontSize.<数值>` | 当前实际字号阶梯；名称对应当前 px（页面像素）值，原生输出为 sp / pt |
| `shared.lineHeight.<数值，点写作下划线>` | 无单位行高比例，例如 `1_65` 为正文 / 原始输出的 `1.65` |
| `shared.fontRelative.body / heading1 / heading2 / heading3 / inlineCode / table` | 消息正文、Markdown（结构化文本）标题、行内代码和表格的相对字号，保持用户字号缩放 |

常用字号：10–12 为紧凑说明，13–15 为控件与正文，16–19 为消息 / 小标题，20–34 为较大标题。完整阶梯以母版为准；保留实际用过的中间值，不在抽取时强制凑整。桌面 `--text-size` 引用所选字号令牌，保留原有设备偏好与任意历史字号的像素回退。

## 间距、尺寸与圆角

`shared.space.<数值>` 输出 `--wm-space-<数值>`，供 padding（内边距）、margin（外边距）、gap（间隙）及焦点偏移使用；数字名称表示当前阶梯位置，精修可以改变对应值。常用阶梯为 2 / 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / 64；其余项保留现有界面的细微差异。`shared.size` 是相关布局计算的宽度基准与标题栏保留区域。

Windows 外壳使用 `shared.size.sidebar`（256px）和 `reading`（760px）；设置默认外框 880×660px、导航 196px、内容 620px。它们是排版基准，随窗口和内容适配。默认浅色为纸白与暖灰，默认深色为中性石墨；颜色预设与使用者字号选择保留。

`shared.radius.<数值>` 输出 `--wm-radius-<数值>`。8–12 常用于控件，14–16 常用于卡片和浮层，18–32 为已有输入区 / 抽屉 / 图片卡；`999` 为胶囊，`circle` 为 `50%` 圆形。圆角和间距分组独立，原生抽屉顶部角引用圆角值。

`android.dimensions` 是原生辅助函数实际使用的布局 / 字号值，记录数值与单位；生成的整数 dp 常量保留原有截断计算，字体常量保留 Float（浮点数），不会改变现有缩放行为。`fallbackPadding / fallbackTop` 保留错误回退页原有的物理 px 内边距。

工作区使用 `workspace-row`（36px）、`workspace-header`（52px）、`workspace-menu`（208px）与 `workspace-panel`（380px），导航行 `workspace-nav-row` 为38px，输入外宽 `composer-measure` 为790px，右侧入口 `panel-launcher-row` 为52px；输入框外层圆角为 `shared.radius.composer`（20px）。

## 阴影

| `shared.shadow` 名称 | 用途 |
|---|---|
| `desktop-model-menu` | 模型选择浮层 |
| `desktop-active-tab` | 已有标签底部内阴影指示 |
| `desktop-composer` | 桌面输入区 |
| `desktop-resource-picker` | 输出 / 来源选择器 |
| `mobile-composer-focus` | 手机输入区焦点指示 |
| `mobile-popover` | 手机旧弹层基础阴影 |
| `mobile-composer` | 手机旧输入区阴影 |
| `mobile-toast` | 手机提示消息 |
| `mobile-approval-menu` | 手机审批模式菜单 |
| `mobile-attachment-remove` | 手机附件删除按钮 |

各端现有后续覆盖中的 `none` 保持有效；抽取不会重新开启已经取消的阴影。

## 动效参数

`motion.duration` 与 `motion.easing` 是动效数值的唯一来源，来自本人提供的动效库。桌面和手机网页直接生成下列变量；原生兼容名称从相同引用解析，不维护第二套数值。

| 时长 | 用途 |
|---|---|
| `--dur-1` 130ms | 悬停、按压反馈 |
| `--dur-2` 220ms | 列表错峰 |
| `--dur-3` 320ms | 内容替换、菜单、状态变化 |
| `--dur-4` 420ms | 页面、弹窗、展开与抽屉 |
| `--dur-5` 640ms | 加载占位循环 |

曲线为 `--ease-out`（`cubic-bezier(.16,1,.3,1)`）、`--ease-in-out`（`cubic-bezier(.4,0,.2,1)`）、`--ease-in`（`cubic-bezier(.4,0,1,1)`）、`--ease-linear`（`linear`）。原有 `shared.duration` / `shared.easing` 名称使用 `{motion.duration.dur-…}` / `{motion.easing.ease-…}` 引用；CSS 保留为变量别名，Android 和 Apple 解析为原生数值。新增动效直接用这五档时长和四条曲线。

共用配方在 `src/ui-core/reply-motion.css`：`data-motion="enter-rise"`、`enter-fade`、`stagger-rise`、`view-enter`、`sheet-in`、`unfold`、`text-shimmer`，关键帧统一以 `m-` 开头。`unfold` 用一个子元素包内容，以 `.open` 或 `aria-expanded="true"` 展开；列表错峰延迟复用最短档并封顶。原生 `<details data-motion="unfold">` 通过 `[open]` 和 `::details-content` 展开正文，`summary` 留在原生布局中，正文仍用一个子元素包裹。`stream-type` 由 `WeftReplyMotion.stream` 使用 requestAnimationFrame（逐帧回调）合并同一帧收到的更新，复用正文渲染器和稳定的段落节点，只追加变化的文字；不另排逐字播放队列，历史消息直接显示。流式内容跟随滚动位置，不叠加平滑滚动。

减少动态效果默认跟随 `prefers-reduced-motion`。设置通过全局 `WeftReplyMotion.setPreference('system' | 'reduce' | 'full')` 接入，并同步根元素的 `data-reduced-motion` / `data-motion-full`；`body.calm` 也可减弱 CSS 配方。减弱时消息只留最短档淡入，页面、抽屉、列表和展开直接到位，扫光停为静态文字，正文整段显示；窗口隐藏会暂停视觉反馈并清空逐帧积压。

## Apple 原生接入（DS-1b）

`apps/apple/Scripts/generate_project.py` 把 `design/tokens/generated/apple/DesignTokens.swift` 作为三个原生 App 的共享编译源，工程不复制它，也不手改生成文件。先在根目录运行 `npm run tokens:generate`，新增工程源文件时再运行 `python3 apps/apple/Scripts/generate_project.py`；两者可重复生成，`--check` 校验 Swift 与 JSON 和其他平台产物。

| 母版 / Swift 引用 | 保留的行为 |
|---|---|
| `apple.colors` → `AppleTokens.Colors` → `Weave` | A4c 实际使用的 12 对浅深颜色；继续使用原来的 `NSColor` / `UIColor` 动态提供器和 RGB / 255 转换，响应浅色、深色和系统外观 |
| `apple.systemColors` / `hierarchicalStyles` → `Colors` / `Styles` | 原生错误红、透明色、反白及系统层级样式；Watch 仅替换这些引用，字体、尺寸和交互不改 |
| `apple.textStyles` → `Fonts` / `TextStyle` | 系统 `body`、`caption` 等语义字体，保留各平台字号与 Dynamic Type（动态字体）；不把系统字体改成固定 pt。已有 28 pt 标题引用共享 `FontSize.f28` |
| `shared.space` + `apple.spacing` → `Space` | 现有内边距、栈间距、行间距与描边；Apple 独有的 0 / 23 pt 由 `apple.spacing` 补齐，不改变 Web / Android 阶梯 |
| `shared.radius` → `Radius` | 现有圆角与连续圆角样式 |
| `apple.tracking` / `opacity` / `scale` | 两处字距、按钮与提示的现有透明度、按压缩放 |
| `apple.animation` + `shared.duration` / `easing` → `Motion` | 现有展开 200 ms、连接区 180 ms 的 `ease-in-out` 动画；Swift 常量自动转秒，未增加动画或改变减少动态效果行为 |

Apple 当前没有手写 `.shadow`，系统菜单 / 导航 / 按钮的原生效果继续由系统绘制，不启用 Web 阴影配方。视口断点、栏宽 / 窗口大小、图标光学尺寸、比例和功能计时仍属于布局 / 图标 / 业务契约；SwiftUI 未显式指定的系统控件默认值继续使用原生默认值。以后新增自定义样式，先补对应母版令牌。

前后原生截图与逐像素报告见 [DS-1b](../../apps/apple/Tests/Evidence/DS-1b/README.md)。

## 页面包怎么用公共层（FIX-DESIGN-BASE）

先加载 `tokens.css`、`ui-core/controls.js`、已有的 `popovers.js` 和 `reply-motion.js`；`ui-core/controls.css` 放在页面样式后。桌面与手机网页入口已接好，新增页面不需要自己复制控件。

| 用途 | 公共接口 / 样式 |
|---|---|
| 字号 | `--wm-type-body` 14、`secondary` 12、`heading` 18、`title` 22、`sidebar` / `menu` / `button` 13；聊天正文继续尊重 `--text-size`，设备界面字号继续尊重 `--ui-size` |
| 间距 / 圆角 | `--wm-space-inline` 8、`row` 12、`section` / `page` 24；`--wm-radius-control` 8、`card` 12、`panel` 16 |
| 颜色 / 阴影 | `--canvas` 页面、`--surface` 内容、`--surface-soft` 次级底、`--ink` 正文、`--ink-secondary` 次要、`--ink-muted` 说明、`--line` 分隔、`--accent` 主操作；浮层用 `--shadow-float` |
| 按钮 | `WeftControls.button('保存', {variant:'primary', action})`；`secondary` / `text` / `icon`，图标传自己的 SVG 节点，图标按钮仍提供名称 |
| 表单 | `input({label, value, placeholder})`；多行加 `multiline:true`；`toggle(checkbox)`、`select(nativeSelect)`、`segmented(nativeSelect)` 保留原控件的值与 `change` 事件 |
| 分组 / 列表行 / 标签 | `group('标题', [row('名称','说明',control)])`、`tag('标签')`；旧 `WeftSettingsControls` 接口直接转入公共实现 |
| 菜单 / 弹层 | `menu(trigger, items)` 复用 `WeftPopover`，自动避让窗口边缘、内部滚动、键盘选择和关闭后归还焦点 |
| 对话框 / 侧滑面板 | `dialog({title, content, actions})` / `drawer(...)` 返回原生模态节点；`openPanel()` 打开，`close()` 关闭；调用者负责移除用完的临时节点 |
| 加载 | `skeleton({rows:3})`；或 `const ready=loading(content)`，请求完成用 `if (ready())` 再替换内容。请求失败仍显示能重试的人话；后来的请求不会被旧 `ready()` 清掉 |

只替换内容容器，保留侧栏、页头、输入区和分类面板。当前项重复点击直接返回；主动刷新走独立的刷新动作。异步结果仍核对原有身份和请求代次。不要每次刷新都重建控件、重放入场动效。

页面进入 / 展开用 `data-motion="view-enter"` / `unfold`（420ms），浮层和内容替换用 320–420ms；列表第一次出现用 `data-motion="stagger-rise"`，错峰依次用已有时长并封顶。悬停、按压和对话内的过程 / 命令局部折叠用快档（`--dur-1`），不另写时长和曲线。减少动态效果继续由 `WeftReplyMotion` 统一处理。
