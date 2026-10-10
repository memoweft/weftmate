# WeftMate 设计令牌

`tokens.json` 是颜色、字体、字号、行高、间距、圆角、阴影与动效参数的唯一来源。DS-1 从实际使用的桌面、手机 Web（网页界面）与 Android（安卓）兼容原生页取值，保留它们现有的差异。本包保持外观；UI-P1 再决定动画与精修参数。

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
| `--window-frame` / `--sidebar` | 窗口外框与侧栏；UI-P5 标题栏全宽使用外框，左段与侧栏连续 |
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

`shared.radius.<数值>` 输出 `--wm-radius-<数值>`。8–12 常用于控件，14–16 常用于卡片和浮层，18–32 为已有输入区 / 抽屉 / 图片卡；`999` 为胶囊，`circle` 为 `50%` 圆形。圆角和间距分组独立，原生抽屉顶部角引用圆角值。

`android.dimensions` 是原生辅助函数实际使用的布局 / 字号值，记录数值与单位；生成的整数 dp 常量保留原有截断计算，字体常量保留 Float（浮点数），不会改变现有缩放行为。`fallbackPadding / fallbackTop` 保留错误回退页原有的物理 px 内边距。

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

`shared.duration` 输出 `--wm-duration-<名称>`。`fast / base / slow` 分别为已有的 180 / 200 / 220 毫秒；数字名称保留已有 160 / 240 / 260 / 280 / 300 / 420 毫秒的用途。`working` 为现有工作状态点的 1.8 秒周期；`reduced` 为手机现有减少动态效果时的 0.01 毫秒；`0ms` 为已有零时长覆盖。Android 模型弹层保留 160 毫秒时长和原有原生默认插值。

`shared.easing.standard / smooth / enter / desktop / mobile` 分别保存现有 `ease`、`ease-in-out`、`ease-in`、`cubic-bezier(.16,1,.3,1)`、`cubic-bezier(.2,.8,.2,1)`；`enter` 沿用手机图片预览关闭时的已有曲线。本包仅换参数来源，不增加动画、修改关键帧或重新设计减少动态效果行为；UI-P1 定稿时在这里调整。


UI-P1 桌面在现有 `fast / base / 160ms / 240ms` 上接入 180 / 200 / 160 / 240 毫秒动效，曲线统一使用 `desktop`。新增 `exit` 为 120 毫秒退出，`stagger` 为新步骤 24 毫秒错开，`staggerLimit` 把错开总延迟限制为 60 毫秒，因此完整步骤序列最多 240 毫秒。系统减少动态效果时跳过动画；这些新增常量同步生成到各端，但手机与 Apple 未在本包消费新动效。详见 [UI-P1 证据](../../tests/evidence/ui-p1/README.md)。

UX-8 共用回复动效新增 `replyFragment`（120 毫秒）、`replyChange`（150 毫秒）、`replyScroll`（160 毫秒），复用 `working` 的 1.8 秒周期；位移沿 `space-2 / space-8`。微光使用五段静态渐变遮罩，`replySweep` 的 `steps(7,end)`（分段缓动）在各 243 毫秒淡亮 / 淡出区间约每秒更新 29 次，不移动遮罩或文字；呼吸沿 `smooth`，其它过渡沿 `desktop`。全部令牌生成到手机、Android（安卓）和 Apple（苹果）清单；减少动态效果与页面 / 原生窗口隐藏会暂停或取消动画。详见 [UX-8 证据](../../tests/evidence/ux-8/README.md)。

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
