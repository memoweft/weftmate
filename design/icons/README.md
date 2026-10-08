# WeftMate 图标

本目录是应用与功能图标的唯一来源。应用图标采用本人 2026-10-08 确认的 C4「天蓝」，功能图标包含设计稿中的 45 个原图及现有界面需要的补充图形。

## 应用图标

`app/color-light.svg`、`app/color-dark.svg`、`app/monochrome.svg` 是三个母版。SVG（可缩放矢量图形）的 viewBox（坐标视口）为 `0 0 64 64`，两个圆心为 `(25,32)`、`(39,32)`，半径 `13`，线宽 `5.5`。中心点半径 `2.6`。

- 浅底：左环 `#1B1D24`，右环与中心点 `#0A7AFF`。
- 深底：左环 `#F1F2F6`，右环与中心点 `#4DA3FF`。
- 上交叉左环在上，下交叉右环在上。被压的环用 mask（遮罩）留真实透明缺口；交点纵坐标为 `32 ± sqrt(13²−7²)`，缺口半径为 `5.5/2+2.6`。
- 单色：使用 `currentColor`（继承文字颜色），右环与中心点透明度为 `0.55`。用于托盘、通知小图标、手表等紧凑场景。

生成的 Windows 安装器 / 快捷方式图标在浅色中性圆角底上放彩色 C4；程序窗口 / 任务栏 ICO 与托盘均为透明底单色；浅任务栏用深墨色，深任务栏用浅墨色。Android（安卓）启动图标为浅色中性背景加 C4 前景，主题图标和通知小图标使用单色母版。Android 的 clip-path（裁剪路径）以 evenOdd（奇偶填充）等价转换 SVG 的交叉遮罩，保留透明度。

## 功能图标

`ui/<英文 id>.svg`：`24 × 24` 网格，内容区通常 `20 × 20`、四边留 `2` 像素；线宽 `1.75`，端点与转角均为圆角；只用 `currentColor`。16 像素及更小尺寸用 `1.5`，通过生成的 `icons/16/` 或桌面创建函数的尺寸参数选择。实心小点显式写 `fill="currentColor" stroke="none"`。

设计稿 45 个 id：

| 分组 | id |
|---|---|
| 对话与导航 | compose、search、sidebar、settings、account、archive、back、chevron、more |
| 输入与执行 | send、stop、attach、mic、model、approval、allow、deny、plan、queue、terminal、tool |
| 文件、输出与来源 | outputs、memory、source、file、folder、web、download、open、copy、edit、trash、expand |
| 设备与状态 | desktop、phone、cloud、offline、sync、bell、info、warn、moon、sun |
| 陪伴 | pet、health |

补充 24 个 id：`battery`、`bell-off`、`book`、`bookmark`、`camera`、`chat`、`clock`、`code`、`collapse`、`filter`、`history`、`image`、`key`、`keyboard`、`loader`、`mail`、`pause`、`pin`、`play`、`plus`、`right`、`undo`、`watch`、`wifi`。沿用各现有动作的含义，并统一网格、颜色、线宽与圆角。旧手机 / 原生名称的兼容映射集中在生成脚本；新调用用规范 id。

## 生成与新增

在仓库根执行 `npm run icons:generate`。依赖仓库现有 Playwright（自动化测试工具）和 Electron（桌面程序框架），没有额外图像库；需要已安装 Electron 二进制。脚本从母版生成：

- `src/assets/icons/` 与 `build/`：PNG（位图）和含 16、20、24、32、40、48、64、128、256 像素的 ICO（Windows 图标容器）。
- `src/personal-access-ui/`：功能图标创建函数、SVG symbol（图形符号）集合、品牌图形与 favicon（网页标签图标）。
- `apps/mobile-ui/www/icons/`、`www/brand/`：规范 id、旧调用兼容文件、16 像素版本和品牌图形。
- `apps/android/app/src/main/res/drawable/`：自适应前景 / 背景、单色主题图标、通知小图标及已有原生功能图标。

新增时先查是否已有相同语义。确需新增，只在 `design/icons/ui/` 画符合上述规则的 SVG，英文 id 要描述动作或对象；不要引入表情、字符图标、另一套图标库或平台私有母版。只使用 `path`、`circle`、圆角 `rect`；不得包含脚本、外链、硬编码主题色。运行生成脚本、提交母版及生成物，并在实际使用尺寸和浅 / 深色界面查看。生成物不要手改；新增 Android 资源名的兼容映射也在脚本中维护。

Apple（苹果客户端）消费这些母版，平台接入由 Mac 工作包完成。
