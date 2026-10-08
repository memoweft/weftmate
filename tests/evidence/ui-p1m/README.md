# UI-P1m 手机动效与新登录审稿图

生产手机呈现组件与 Android（安卓）`HybridActivity`（混合界面活动）的动效验收。改前资产从提交 `b99044dbf1ef920c5e1667f6f216f5aabf29bdc9` 读取，改后资产对应 `02db5b1`；完整提交号、视口、实际时长 / 曲线、动画帧回调和长任务保存在两个 `*-verification.json` 中。改前只读 `git show`，工作树未回退。

Chromium（浏览器引擎）使用 390×844、触摸与手机视口。MuMu（安卓模拟器）使用独立包 `com.memoweft.weftmate.mobile.uip1mqa`，通过 `UiP1mWebViewProbeTest`（实屏探针测试）打开真实产品 Activity（界面活动）。测试 APK（安卓安装包）仅在明确探针参数、独立包和指定回环来源下，为 WebView（应用内网页视图）设置临时资产通道，以相同资产服务器加载基线和当前生产组件；产品 APK 没有放宽来源权限。真实 Android 系统设置观察与减少动态效果同步仍由生产 `HybridActivity` 运行。每帧由 `adb exec-out screencap -p` 捕获完整设备屏幕，保留实际系统栏。

两端复用 FE-1b 的真实隔离个人服务认证，Cookie（会话凭据）与 CSRF（跨站请求伪造防护）仅保留在测试桥闭包内。业务画面采用合成会话 / 执行 / 审批投影；新增步骤、排队卡、审批终态和注册中间步骤直接调用生产呈现函数。原生壳内的呈现测试使用测试 JavaScript（网页脚本）桥，不声称验收真实 Android 网络、真实云注册、真实模型或调度。本包模型请求为 0；不读取日用数据或真实凭据。

## 令牌与连续帧

全部时长来自 `design/tokens/tokens.json` 的 `shared.duration`，统一曲线来自 `shared.easing.desktop`：`cubic-bezier(.16,1,.3,1)`，与桌面 UI-P1 相同且没有弹跳。页面推入距离引用 `shared.space.16`；抽屉使用自身宽度的百分比移动。现有令牌已足够，本包没有增加令牌；重新生成后输出没有差异。

每个场景有改前 / 改后 / 减少动态效果三组，每组 0 / 60 / 120 / 240 毫秒四帧。18 个场景 × 3 组 × 4 帧 × 2 个环境 = **432 张 PNG（无损图片）**。下表链接到 60 毫秒帧，同名前缀的 0 / 120 / 240 毫秒文件组成完整帧组。

| 场景 | 时长令牌 | Chromium 前 / 后 / 减少动态效果 | MuMu 前 / 后 / 减少动态效果 |
|---|---|---|---|
| 登录 → 注册邮箱 | `base · 200ms` | [前](before-chromium-login-register-60.png) / [后](after-chromium-login-register-60.png) / [瞬时](reduced-chromium-login-register-60.png) | [前](before-android-login-register-60.png) / [后](after-android-login-register-60.png) / [瞬时](reduced-android-login-register-60.png) |
| 注册 → 验证码 | `base · 200ms` | [前](before-chromium-login-code-60.png) / [后](after-chromium-login-code-60.png) / [瞬时](reduced-chromium-login-code-60.png) | [前](before-android-login-code-60.png) / [后](after-android-login-code-60.png) / [瞬时](reduced-android-login-code-60.png) |
| 验证码 → 设置密码 | `base · 200ms` | [前](before-chromium-login-password-60.png) / [后](after-chromium-login-password-60.png) / [瞬时](reduced-chromium-login-password-60.png) | [前](before-android-login-password-60.png) / [后](after-android-login-password-60.png) / [瞬时](reduced-android-login-password-60.png) |
| 会话列表进入对话 | `base · 200ms` | [前](before-chromium-session-enter-60.png) / [后](after-chromium-session-enter-60.png) / [瞬时](reduced-chromium-session-enter-60.png) | [前](before-android-session-enter-60.png) / [后](after-android-session-enter-60.png) / [瞬时](reduced-android-session-enter-60.png) |
| 执行块展开 | `base · 200ms；步骤 fast · 180ms` | [前](before-chromium-execution-expand-60.png) / [后](after-chromium-execution-expand-60.png) / [瞬时](reduced-chromium-execution-expand-60.png) | [前](before-android-execution-expand-60.png) / [后](after-android-execution-expand-60.png) / [瞬时](reduced-android-execution-expand-60.png) |
| 执行块收起 | `exit · 120ms` | [前](before-chromium-execution-collapse-60.png) / [后](after-chromium-execution-collapse-60.png) / [瞬时](reduced-chromium-execution-collapse-60.png) | [前](before-android-execution-collapse-60.png) / [后](after-android-execution-collapse-60.png) / [瞬时](reduced-android-execution-collapse-60.png) |
| 新步骤逐条出现 | `fast · 180ms；stagger · 24ms，staggerLimit · 60ms` | [前](before-chromium-steps-enter-60.png) / [后](after-chromium-steps-enter-60.png) / [瞬时](reduced-chromium-steps-enter-60.png) | [前](before-android-steps-enter-60.png) / [后](after-android-steps-enter-60.png) / [瞬时](reduced-android-steps-enter-60.png) |
| 审批卡出现 | `base · 200ms` | [前](before-chromium-approval-enter-60.png) / [后](after-chromium-approval-enter-60.png) / [瞬时](reduced-chromium-approval-enter-60.png) | [前](before-android-approval-enter-60.png) / [后](after-android-approval-enter-60.png) / [瞬时](reduced-android-approval-enter-60.png) |
| 审批处理后收成一行 | `exit · 120ms` | [前](before-chromium-approval-resolve-60.png) / [后](after-chromium-approval-resolve-60.png) / [瞬时](reduced-chromium-approval-resolve-60.png) | [前](before-android-approval-resolve-60.png) / [后](after-android-approval-resolve-60.png) / [瞬时](reduced-android-approval-resolve-60.png) |
| 输出与来源全屏页推入 | `240ms · 240ms` | [前](before-chromium-outputs-push-60.png) / [后](after-chromium-outputs-push-60.png) / [瞬时](reduced-chromium-outputs-push-60.png) | [前](before-android-outputs-push-60.png) / [后](after-android-outputs-push-60.png) / [瞬时](reduced-android-outputs-push-60.png) |
| 全屏页返回对话 | `exit · 120ms` | [前](before-chromium-outputs-back-60.png) / [后](after-chromium-outputs-back-60.png) / [瞬时](reduced-chromium-outputs-back-60.png) | [前](before-android-outputs-back-60.png) / [后](after-android-outputs-back-60.png) / [瞬时](reduced-android-outputs-back-60.png) |
| 抽屉打开与遮罩进入 | `240ms · 240ms；遮罩 base · 200ms` | [前](before-chromium-drawer-open-60.png) / [后](after-chromium-drawer-open-60.png) / [瞬时](reduced-chromium-drawer-open-60.png) | [前](before-android-drawer-open-60.png) / [后](after-android-drawer-open-60.png) / [瞬时](reduced-android-drawer-open-60.png) |
| 抽屉与遮罩关闭 | `exit · 120ms` | [前](before-chromium-drawer-close-60.png) / [后](after-chromium-drawer-close-60.png) / [瞬时](reduced-chromium-drawer-close-60.png) | [前](before-android-drawer-close-60.png) / [后](after-android-drawer-close-60.png) / [瞬时](reduced-android-drawer-close-60.png) |
| 排队卡进入 | `fast · 180ms` | [前](before-chromium-queue-enter-60.png) / [后](after-chromium-queue-enter-60.png) / [瞬时](reduced-chromium-queue-enter-60.png) | [前](before-android-queue-enter-60.png) / [后](after-android-queue-enter-60.png) / [瞬时](reduced-android-queue-enter-60.png) |
| 排队卡退出 | `exit · 120ms` | [前](before-chromium-queue-exit-60.png) / [后](after-chromium-queue-exit-60.png) / [瞬时](reduced-chromium-queue-exit-60.png) | [前](before-android-queue-exit-60.png) / [后](after-android-queue-exit-60.png) / [瞬时](reduced-android-queue-exit-60.png) |
| 发送 → 停止 | `160ms · 160ms；退出 exit · 120ms` | [前](before-chromium-send-stop-60.png) / [后](after-chromium-send-stop-60.png) / [瞬时](reduced-chromium-send-stop-60.png) | [前](before-android-send-stop-60.png) / [后](after-android-send-stop-60.png) / [瞬时](reduced-android-send-stop-60.png) |
| 停止 → 发送 | `160ms · 160ms；退出 exit · 120ms` | [前](before-chromium-stop-send-60.png) / [后](after-chromium-stop-send-60.png) / [瞬时](reduced-chromium-stop-send-60.png) | [前](before-android-stop-send-60.png) / [后](after-android-stop-send-60.png) / [瞬时](reduced-android-stop-send-60.png) |
| 长按菜单出现 | `base · 200ms` | [前](before-chromium-long-press-menu-60.png) / [后](after-chromium-long-press-menu-60.png) / [瞬时](reduced-chromium-long-press-menu-60.png) | [前](before-android-long-press-menu-60.png) / [后](after-android-long-press-menu-60.png) / [瞬时](reduced-android-long-press-menu-60.png) |

截图驱动暂停 Web Animations API（网页动画接口）与 CSS（层叠样式表）过渡，精确采样其时间，再结束动画并清理退出副本。帧组用于核对过渡外观，不用于计算帧率。默认内容可见；动画期间可以立即输入、点击或返回，不等待动画结束。

布局和 `details`（折叠内容）状态立即到位；退出画面是固定定位、`inert`（不可交互）、`aria-hidden`（对辅助技术隐藏）的视觉副本，清除重复 ID（节点标识），不参与滚动尺寸。返回全屏来源页后，滚动位置 / 尺寸和输入草稿均保持一致。新步骤按身份识别，已出现项刷新不重播；超过 20 个步骤或排队卡不逐项动画。最大步骤序列 180 + 60 = 240ms。

网页 `prefers-reduced-motion`（减少动态效果偏好）和 Android 三种动画缩放任一为 0 均瞬时显示；运行中改变偏好会取消动画和清理副本。Android 用 `ContentObserver`（系统设置观察器）同步，前台恢复与页面加载也重新读取，销毁时注销观察。测试既验证最终减少动态效果帧组，又验证运行中切换。

## 性能与验证

| 环境 / 动作 | 帧回调间隔样本 | 最大间隔 | >50ms 长帧 | >50ms 长任务 |
|---|---:|---:|---:|---:|
| chromium / `execution-expand-collapse` | 37 | 16.800ms | 0 | 0 |
| chromium / `outputs-push-back` | 38 | 16.800ms | 0 | 0 |
| chromium / `drawer-open-close` | 37 | 16.800ms | 0 | 0 |
| android / `execution-expand-collapse` | 112 | 5.556ms | 0 | 0 |
| android / `outputs-push-back` | 115 | 5.556ms | 0 | 0 |
| android / `drawer-open-close` | 112 | 16.667ms | 0 | 0 |

MuMu 实屏为 720×1280，页面实际视口 565×980，DPR（设备像素比）约 1.275；浏览器为 390×844、DPR 1。

主线程性能在动画正常运行、无截图、无暂停时独立测量。JSON（结构化数据）保留 PerformanceObserver（性能观察器）的长任务与 requestAnimationFrame（动画帧回调）的逐帧间隔。这里的帧回调来自浏览器 / 模拟器短场景，不能等同于物理设备刷新率或长期稳定性。

`android-concurrent-check.json` 保留一次并行桌面审稿截图 / 手机测试期间的失败：MuMu 抽屉有 2 个 >50ms 帧间隔，主线程长任务为 0；该次驱动在性能断言处退出，未保存逐帧时长。并行负载是可能原因；随后等待其他捕获完成，再单独运行完整 MuMu 验收，最终结果见 `android-verification.json`，没有删掉该观察或放宽门槛。

本地验证：手机 build（构建）/ check（检查）成功，104/104 交互与逻辑测试、相关桥 / 生成资产 / 令牌 13/13、Android JVM（Java 虚拟机）31/31、debug APK（调试安装包）与测试包构建、根类型检查及令牌检查均通过。新动效回归按名称 / 角色覆盖输入、滚动、运行中偏好变化、长列表与 18 个动效场景；CI（持续集成）只跑行为断言，性能门槛在本地截图验收时执行，避免把共享执行机器负载当成界面功能回归。

审稿页 `prepareLogin`（登录场景准备函数）等待夹具完成启动，显式初始化 LG-1b 登录组件，再按「登录 WeftMate」「邮箱」「还没有账号？注册」的名称 / 角色定位。新版审稿页已覆盖到指定仓库外目录；Windows（微软桌面系统）/ 手机网页 × 十场景 × 浅深 = 40 个自动截图，0 失败，1600 / 390 宽度与两套外观的页面验证通过。其他平台缺图仍按既有清单显示待补。

MuMu 安装前检查全部 WeftMate 包与活动进程；没有活动占用。每轮在 finally（最终清理）恢复原动画缩放，移除本轮反向映射 / 调试转发，卸载本轮两个隔离包。没有清理其他应用或日用数据。

```powershell
node tests/integration/ui-p1m-mobile-motion.mjs
. D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1
gradle --offline -p apps/android '-PweftmateApplicationId=com.memoweft.weftmate.mobile.uip1mqa' :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest --console=plain
node tests/integration/ui-p1m-mobile-motion.mjs --device
npm run build --prefix apps/mobile-ui
npm run check --prefix apps/mobile-ui
npm test --prefix apps/mobile-ui
node --test tests/mobile-android-bridge.test.ts tests/mobile-ui-core-assets.test.ts tests/design-tokens.test.ts
npm run typecheck
node scripts/generate-tokens.mjs --check
node scripts/review-gallery/capture.mjs --out <指定审稿目录>
node scripts/review-gallery/build.mjs --out <指定审稿目录>
node tests/integration/review-capture-gallery.mjs --out <指定审稿目录>
```

完整测试和审稿页工作流交本包 PR（拉取请求）CI；未部署、未发布手机界面包或正式安装包。
