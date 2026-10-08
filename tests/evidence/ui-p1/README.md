# UI-P1 桌面动效（D28）

真实 WeftMate 主程序通过 Playwright（界面自动化工具）`_electron.launch` 启动仓库 `.`，1200×800 窗口、随机端口、系统临时标记目录与合成账号。改前基线为 `014924a51e04e679b631dde354dfbb9fef194dbd`（以 `verification.json` 的完整提交号为准）；静态响应从该提交读取，工作树不回退。改后和系统减少动态效果使用当前代码。

个人入口和认证使用真实隔离服务；运行内容来自既有合成 DSH（模型执行框架）日志模型。新增步骤、队列卡与注册验证码 / 密码页使用生产组件的合成呈现投影；第二个空白会话使用合成接口响应。审批提交与消息完成仍经过隔离服务。这是外观与交互验收，不重新声称真实模型推理、云账号注册或队列调度已经验证。模型请求为零；未读取日用目录、真实账号或凭据。

每种场景有改前、改后、减少动态效果三组，每组 0 / 60 / 120 / 240 毫秒四帧，共 204 张 PNG（无损图像）。截图时把 Web Animations API（网页动画接口）动画暂停在精确采样时间，保留真实组件、窗口与布局，便于检查短动画；它们是确定性时间采样，不是录屏，也不用于推导帧率。既有 CSS（层叠样式）控件过渡仍按真实时钟运行。主线程性能另在动画正常运行、无截图和无暂停时测量。

## 时长、缓动与连续帧

以下全部时长和缓动来自 `design/tokens/tokens.json`，由生成脚本输出 CSS 变量。曲线统一为 `shared.easing.desktop`：`cubic-bezier(.16,1,.3,1)`，无弹跳。表中链接到 60 毫秒帧；同名前缀的 `-0.png`、`-120.png`、`-240.png` 组成完整连续帧组。

| 动效 | 时长令牌 | 改前 | 改后 | 减少动态效果 |
|---|---|---|---|---|
| 登录 → 注册邮箱 | `base` 200ms | [前](before-login-step-60.png) | [后](after-login-step-60.png) | [瞬时](reduced-login-step-60.png) |
| 注册 → 验证码 | `base` 200ms | [前](before-login-code-60.png) | [后](after-login-code-60.png) | [瞬时](reduced-login-code-60.png) |
| 验证码 → 设置密码 | `base` 200ms | [前](before-login-password-60.png) | [后](after-login-password-60.png) | [瞬时](reduced-login-password-60.png) |
| 执行块展开 | `base` 200ms；步骤 `fast` 180ms | [前](before-execution-expand-60.png) | [后](after-execution-expand-60.png) | [瞬时](reduced-execution-expand-60.png) |
| 执行块收起 | `exit` 120ms | [前](before-execution-collapse-60.png) | [后](after-execution-collapse-60.png) | [瞬时](reduced-execution-collapse-60.png) |
| 新步骤逐条出现 | `fast` 180ms；`stagger` 24ms；`staggerLimit` 60ms | [前](before-steps-enter-60.png) | [后](after-steps-enter-60.png) | [瞬时](reduced-steps-enter-60.png) |
| 审批卡进入 | `base` 200ms | [前](before-approval-enter-60.png) | [后](after-approval-enter-60.png) | [瞬时](reduced-approval-enter-60.png) |
| 审批提交后收成一行 | `exit` 120ms | [前](before-approval-resolve-60.png) | [后](after-approval-resolve-60.png) | [瞬时](reduced-approval-resolve-60.png) |
| 右侧面板打开 | `240ms` 240ms | [前](before-panel-open-60.png) | [后](after-panel-open-60.png) | [瞬时](reduced-panel-open-60.png) |
| 右侧面板收起 | `exit` 120ms | [前](before-panel-close-60.png) | [后](after-panel-close-60.png) | [瞬时](reduced-panel-close-60.png) |
| 标签切换 | `fast` 180ms；控件颜色 `160ms` 160ms | [前](before-panel-tab-60.png) | [后](after-panel-tab-60.png) | [瞬时](reduced-panel-tab-60.png) |
| 会话列表更新 | `fast` 180ms；整列表一次淡入 | [前](before-session-list-60.png) | [后](after-session-list-60.png) | [瞬时](reduced-session-list-60.png) |
| 切换另一会话后返回 | `base` 200ms | [前](before-session-switch-60.png) | [后](after-session-switch-60.png) | [瞬时](reduced-session-switch-60.png) |
| 对话 → 设置页面 | `base` 200ms | [前](before-page-switch-60.png) | [后](after-page-switch-60.png) | [瞬时](reduced-page-switch-60.png) |
| 排队卡进入 | `fast` 180ms | [前](before-queue-enter-60.png) | [后](after-queue-enter-60.png) | [瞬时](reduced-queue-enter-60.png) |
| 排队卡退出 | `exit` 120ms | [前](before-queue-exit-60.png) | [后](after-queue-exit-60.png) | [瞬时](reduced-queue-exit-60.png) |
| 新回复 / 记忆标签、停止 → 发送状态 | `160ms` 160ms；停止退出 `exit` 120ms | [前](before-reply-and-send-stop-60.png) | [后](after-reply-and-send-stop-60.png) | [瞬时](reduced-reply-and-send-stop-60.png) |

展开与新步骤的最大序列时长为 180 + 60 = 240ms。退出更快；输入不等待动画。步骤 / 排队卡按身份识别，重复刷新不重新播放旧卡。超过 20 项不做逐项动画；会话列表超过 20 项也直接显示。消息接口当前提供 `assistant.message` 消息块，因此只淡入收到的新块，不制造逐字播放、重绘旧文字或增加传输功能。

布局和原生 `details` 状态在操作时立即到位。收起使用 `inert`（不可交互）且 `aria-hidden`（对辅助技术隐藏）的固定定位副本，清除重复 ID（节点标识），不保留可操作按钮、不参与滚动尺寸，不延迟审批或停止。审批提交后的核对与来源按钮仍可使用；确认终态继续沿用原有回执行。减少动态效果禁用全部桌面 CSS 过渡及脚本动画，运行中切换偏好也取消动画并清理副本。

## 验证与性能

`verification.json` 保存每帧实际动画参数、主线程长任务、`requestAnimationFrame`（动画帧回调）间隔，以及减少动态效果、动态切换偏好、21 项长列表、键盘、草稿与滚动尺寸断言。

正常运行测量覆盖执行块展开 / 收起、右侧标签切换、右侧面板打开 / 收起，使用 Performance API（性能接口）的 `PerformanceObserver` / `longtask` 和动画帧回调。三组均没有 >50ms 长任务；实际采样数和最大帧间隔见 JSON。性能记录是本次隔离 Windows（微软桌面系统）程序的短场景结果，长期稳定性与其他设备帧率不属于本包。


| 正常运行动作 | 帧回调数 | 最大帧间隔 | >50ms 长任务 |
|---|---|---|---|
| `execution-expand-collapse` | 107 | 10.10ms | 0 |
| `panel-tab` | 104 | 10.00ms | 0 |
| `panel-open-close` | 106 | 10.10ms | 0 |

相关验证：桌面领域交互 59/59、静态界面 / 记忆 / 桌面呈现和语义交互 8/8、新减少动态效果行为 1/1、令牌 3/3、共享核心 / 云认证 39/39；`npm run typecheck` 与生成令牌检查通过。完整测试由 PR（合并请求）的 CI（持续集成）执行。

```powershell
# 真实 WeftMate 主程序：重新生成全部前后 / 减少动态效果帧组与性能记录
node tests/integration/ui-p1-desktop-motion.mjs
# CI 使用最小隔离 Electron 窗口，跑同一组行为，不写截图
node --test tests/personal-desktop-motion.test.ts
node --test tests/personal-access-ui-interaction.test.ts tests/personal-access-ui.test.ts tests/personal-access-memory-ui.test.ts tests/personal-desktop-ui.test.ts tests/design-tokens.test.ts tests/ui-core.test.ts tests/ui-core-cloud-auth.test.ts
npm run typecheck
node scripts/generate-tokens.mjs --check
```

仅桌面 / 远程网页接入新动效。手机 / Android（安卓）生成常量随母版同步，但本包没有改手机组件、原生行为或共享功能层；手机动效与 Apple（苹果客户端）动效留后续包。
