# DS-1 设计令牌验收

2026-10-08，Windows-3。基线为 `31a71a4e542a82acf31b3a0114680749a7fea9ce`，本包从该提交的现有界面取值，不改变外观。

## 外观对比

真实 Electron（桌面程序框架）经 Playwright（自动化测试工具）的 `_electron.launch` 启动仓库主程序和固定 DSH（执行运行时），使用系统临时目录中的隔离宿主、合成账号与本机合成模型。截图来自真实程序的渲染页面，包含程序自己的标题栏 / 输入区；未截图 Windows（微软桌面系统）外部边框与任务栏。本包未使用本人日用数据或收费模型。

手机 Web（网页界面）使用 390×844 Chromium（浏览器引擎），通过现有合成原生桥测试夹具验证列表、运行、审批、步骤、成果与来源。它证明手机页面渲染与交互，不代表本包进行了安卓真机 / 模拟器仪器测试。

15 对截图均为 **0 个像素差异**，无需放宽到允许的 1 像素。桌面实时「几分几秒」文字在两侧统一为 `0分0秒`，截图前鼠标移出控件，截图工具暂停现有动画；颜色、字体、尺寸、布局、圆角与阴影均未修改。初始基线采集在改造前完成；桌面最终对照由脚本读取上述提交的原始 HTML（页面标记）与 CSS（层叠样式表），经测试路由送入同一个真实程序后重拍，保证计时 / 悬停条件一致。

| 场景 | 浅色：改造前 → 改造后 | 深色：改造前 → 改造后 |
|---|---|---|
| 真实程序：执行与待审批 | [前](before-desktop-light.png) → [后](after-desktop-light.png) | [前](before-desktop-dark.png) → [后](after-desktop-dark.png) |
| 手机：会话列表 | [前](before-mobile-light-list.png) → [后](after-mobile-light-list.png) | [前](before-mobile-dark-list.png) → [后](after-mobile-dark-list.png) |
| 手机：运行 | [前](before-mobile-light-running.png) → [后](after-mobile-light-running.png) | [前](before-mobile-dark-running.png) → [后](after-mobile-dark-running.png) |
| 手机：审批 | [前](before-mobile-light-approval.png) → [后](after-mobile-light-approval.png) | [前](before-mobile-dark-approval.png) → [后](after-mobile-dark-approval.png) |
| 手机：步骤与原始详情 | [前](before-mobile-light-steps.png) → [后](after-mobile-light-steps.png) | [前](before-mobile-dark-steps.png) → [后](after-mobile-dark-steps.png) |
| 手机：Markdown（结构化文本）成果 | [前](before-mobile-light-artifact.png) → [后](after-mobile-light-artifact.png) | [前](before-mobile-dark-artifact.png) → [后](after-mobile-dark-artifact.png) |
| 手机：来源阅读 | [前](before-mobile-light-source.png) → [后](after-mobile-light-source.png) | [前](before-mobile-dark-source.png) → [后](after-mobile-dark-source.png) |

另有真实程序深色完成态：[前](before-completed.png) → [后](after-completed.png)。逐像素指标见 [comparison.json](comparison.json)。桌面浅深 × 石墨 / 蓝 / 绿 / 紫的预设值及字号设置一致，重载后紫色 / 19 字号保存正常，见 [前](before-desktop-settings.json)与[后](after-desktop-settings.json)。

## 相关验证

| 验证 | 结果 |
|---|---|
| 桌面 / 手机全部样式声明与基线比较 | 4,016 项值一致，覆盖截图中未显示的样式与图片关闭曲线；仅归一化空白与负间距的等价 `calc`（计算表达式）。[报告](stylesheet-comparison.json) |
| 真实程序 | 实际登录、模型配置、发送、待审批、允许一次、完成通知与发送按钮恢复；浅 / 深 / 四种主题色 / 字号与保存通过 |
| 手机视觉交互 | 列表搜索、运行、三种审批按钮、步骤 / 原始详情、来源分页 / 去重 / 重试、成果表格、返回滚动位置、草稿与重载、更早历史、跟随系统主题、减少动态效果、窄屏与横屏通过 |
| 相关交互 / 手机发布测试 | `personal-access-ui-interaction`、`personal-desktop-ui`、`personal-mobile-ui-release`、手机 `chat-interactions` / `approval-interactions`：158/158；字号引用调整后相关偏好测试再次通过 |
| 令牌来源与静态资源 | 2/2 令牌测试；公开 `tokens.css` 与原有安全头的资产服务测试通过 |
| Android（安卓）JVM（Java 虚拟机） | 27/27 |
| Android 构建 | `:app:assembleDebug` 通过；0.8.6 / code19；未安装、覆盖或卸载本人应用 |
| 生成重复运行 | 生成后 `--check` 全部逐字一致；生成物固定 LF（换行符），Windows 检出也能核对 |
| 类型检查 | `npm run typecheck` 通过 |
| 界面机械检查 | 已运行 impeccable（界面设计）检测器；仅报告手机原有代码引用块的 2px 侧边框，本包保持它的视觉原值 |
| 完整测试 | 交 GitHub（代码托管平台）PR（拉取请求）的 CI（持续集成）门禁；不在本地重复全量单测 |

`tests/personal-access-ui.test.ts` 的 `public account shell keeps secrets out of markup and code-generated HTML` 仍命中现有草稿存储；它在 `.github/ci-test-exceptions.json` 中已登记，本包未改动源码中的草稿路径或例外名单。其余资产服务测试通过。

## 复现与边界

```powershell
npm run tokens:generate
node scripts/generate-tokens.mjs --check
node --test tests/design-tokens.test.ts
node tests/integration/ds-1-tokens-electron.mjs --before
node tests/integration/ds-1-tokens-electron.mjs
node tests/integration/ds-1-tokens-mobile.mjs --before
node tests/integration/ds-1-tokens-mobile.mjs
node tests/integration/ds-1-styles.mjs
node tests/integration/ds-1-compare.mjs
npm run typecheck
. D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1
# 以下在 apps/android/ 执行：
gradle --offline :app:testDebugUnitTest :app:assembleDebug --console=plain
```

Apple（苹果客户端）只生成 `design/tokens/generated/apple/` 的交接产物，没有修改 `apps/apple/`；原生接线 / Apple 构建由 Mac 后续工作包完成。动画本体、重设计、账号外观同步以及新的安卓真机视觉验收均未包含在 DS-1。本包未改变客户端业务契约，未发布安装包或服务器更新包。
