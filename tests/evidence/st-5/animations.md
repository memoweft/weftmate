# 减少动态效果走查

共享开关沿用 `weftmate.reply-motion.v1`，默认 `system`；本人开启保存 `reduce`，本人关闭保存 `full`，恢复按钮保存 `system`。浏览器媒体变化与既有原生 `weft-motion-preference` 事件都会更新开关。减少动态效果开启时，共享根属性 `data-reduced-motion` 对全部元素与伪元素强制 `animation:none`、`transition:none`、`scroll-behavior:auto`。已经运行的 Web Animations API（网页动画接口）实例会立即取消。静态旋转、展开状态保留；按压缩放归零。

| 动画点 | 开关开启后的表现 |
|---|---|
| 电脑 `WeftMotion.reveal/changed`：页面、设置分类、列表、新增步骤、预览切换 | 立即呈现最终布局与不透明度，不渐显、不交错 |
| 电脑 `snapshot/dismiss/remove/hide/details`：弹层、预览、执行步骤与审批消退 | 不建立视觉副本；立即展开、折叠或移除，不裁切消退 |
| 手机 `WeftMobileMotion.reveal/push/changed`：页面前进返回、抽屉、列表 | 立即更新页面，没有位移或渐显 |
| 手机 `snapshot/dismiss/hide`：抽屉、弹层、审批消退 | 不保留退出副本，立即隐藏 |
| `WeftReplyMotion.reveal`：发送、消息到达、失败提示 | 原文立即可读，无位移和淡入 |
| `WeftReplyMotion.fragment`：流式追加文字和代码 | 不建立文字淡入包裹，追加内容立即可读 |
| `WeftReplyMotion.status`：状态文本交替 | 立即替换文本，不留上一状态的视觉副本 |
| 状态扫光与流式末尾呼吸点 | 扫光隐藏；已有呼吸点立即移除，新呼吸点不建立 |
| `WeftConversationScroll`：跟随新回复、回到底部 | 停止在途滚动，直接到最终位置；用户已向上阅读时仍保留位置 |
| 手机旧纯文本流式呈现备用路径 | 复用 `WeftMobileMotion.reduced()`，全部待呈现文本一次到达；当前富文本主路使用共享 `WeftContent` |
| 手机记忆页分段导航 `scrollIntoView` | 使用共享减少动态效果偏好，手动开启也立即滚动到目标分段 |
| 按钮按压缩放 | 保持正常大小，颜色状态立即切换 |
| CSS（层叠样式表）过渡与动画的逐处清单 | 见下表，全部变为无动画／无过渡；加载与任务状态仍由文字和静态标记表达 |

`verification.json` 中 12 个界面组合实查：关键属性为 `animation:none / transition:0s / scroll:auto`，调用共享回复、电脑／手机动画入口新增动画数为 0；同时验证系统默认、本人开／关覆盖以及恢复系统默认。已有回复动效与对话滚动单测保护文本即时可读、取消在途动画、原生偏好事件和阅读位置。

| 来源 | 元素／选择器 | 原有动画／过渡 | 开启后 |
|---|---|---|---|
| `src/personal-access-ui/controls.css` | `.settings-switch::before` | `transition: transform var(--wm-duration-160ms) var(--wm-easing-desktop)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/goals.css` | `.goals-page .settings-switch::before` | `transition:transform var(--wm-duration-160ms) var(--wm-easing-desktop)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/next-suggestions.css` | `.next-suggestions` | `transition:opacity var(--wm-duration-160ms) var(--wm-easing-desktop),transform var(--wm-duration-160ms) var(--wm-easing-desktop),visibility 0s` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/next-suggestions.css` | `.next-suggestions[hidden]` | `transition:opacity var(--wm-duration-exit) var(--wm-easing-desktop),transform var(--wm-duration-exit) var(--wm-easing-desktop),visibility 0s var(--wm-duration-exit)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/next-suggestions.css` | `.next-suggestion-chip` | `transition:background var(--wm-duration-160ms) var(--wm-easing-desktop),color var(--wm-duration-160ms) var(--wm-easing-desktop)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/rendering.css` | `.render-code-actions>.render-action` | `transition:opacity var(--wm-duration-160ms)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/search.css` | `.search-palette` | `animation:search-enter var(--wm-duration-160ms) var(--wm-easing-desktop)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/search.css` | `.search-palette.is-closing` | `animation:search-exit var(--wm-duration-exit) var(--wm-easing-desktop) forwards` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/search.css` | `.search-skeleton-icon,.search-skeleton-line` | `animation:search-loading var(--wm-duration-working) ease-in-out infinite alternate` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/styles.css` | `.model-trigger svg` | `transition: transform var(--wm-duration-base) var(--wm-easing-desktop)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/styles.css` | `.model-popover` | `animation: model-menu-in var(--wm-duration-slow) var(--wm-easing-desktop)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/styles.css` | `.session-rail` | `transition: transform var(--wm-duration-fast) var(--wm-easing-standard)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/styles.css` | `.timeline-status.is-running::before` | `animation: working var(--wm-duration-working) var(--wm-easing-smooth) infinite` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/styles.css` | `.execution-block summary > .wm-icon:first-child` | `transition: transform var(--wm-duration-base) var(--wm-easing-desktop)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/styles.css` | `.preview-tab-select` | `transition: color var(--wm-duration-160ms) var(--wm-easing-desktop), background-color var(--wm-duration-160ms) var(--wm-easing-desktop)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/styles.css` | `.composer-send, #cancel-turn` | `transition: color var(--wm-duration-160ms) var(--wm-easing-desktop), background-color var(--wm-duration-160ms) var(--wm-easing-desktop)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/styles.css` | `.progress-chevron` | `transition: transform var(--wm-duration-base) var(--wm-easing-desktop)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/styles.css` | `.inline-progress-text.is-running` | `animation: progress-breathe var(--wm-duration-working) var(--wm-easing-smooth) infinite` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/styles.css` | `.session-list .session-running-dot` | `animation:sidebar-spin var(--wm-duration-working) linear infinite` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/styles.css` | `.session-status .session-running-dot` | `animation:sidebar-spin var(--wm-duration-working) linear infinite` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/personal-access-ui/styles.css` | `.status-entering .session-unread-dot` | `animation:session-status-enter var(--wm-duration-status) ease-out` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.scrim` | `transition:opacity var(--wm-duration-fast) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.drawer` | `transition:transform var(--wm-duration-slow) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.popover` | `animation:popover-in var(--wm-duration-fast) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.page.active` | `animation:page-settle var(--wm-duration-240ms) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.popover` | `animation-duration:var(--wm-duration-240ms)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.send-button,.icon-button,.nav-primary,.popover button` | `transition:background-color var(--wm-duration-160ms) var(--wm-easing-standard),color var(--wm-duration-160ms) var(--wm-easing-standard),transform var(--wm-duration-fast) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.attachment-popover` | `transition:opacity var(--wm-duration-260ms) var(--ease),transform var(--wm-duration-260ms) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.scrim` | `transition:opacity var(--wm-duration-280ms) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.drawer` | `transition:transform var(--wm-duration-300ms) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.toast` | `transition:opacity var(--wm-duration-420ms) var(--wm-easing-standard),transform var(--wm-duration-420ms) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `#chat-page .composer-card` | `transition:border-color var(--wm-duration-base) var(--ease),box-shadow var(--wm-duration-base) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `#chat-page .model-button` | `transition:background-color var(--wm-duration-fast) var(--ease),color var(--wm-duration-fast) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.image-preview` | `animation:preview-in var(--wm-duration-fast) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.image-preview.closing` | `animation:preview-out var(--wm-duration-160ms) var(--wm-easing-enter) forwards` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `#chat-page .composer-card` | `transition:border-color var(--wm-duration-fast) var(--wm-easing-standard)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.drawer` | `transition:transform var(--wm-duration-240ms) var(--wm-easing-desktop)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.scrim` | `transition:opacity var(--wm-duration-base) var(--wm-easing-desktop)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.popover[popover]` | `transition: opacity var(--wm-duration-fast) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.progress-chevron` | `transition: transform var(--wm-duration-base) var(--wm-easing-desktop)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.inline-progress-text.is-running` | `animation: progress-breathe var(--wm-duration-working) var(--wm-easing-smooth) infinite` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.mobile-tab` | `transition:background-color var(--wm-duration-fast) var(--ease),color var(--wm-duration-fast) var(--ease)` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.mobile-session-status.is-running:after` | `animation:mobile-status-spin var(--wm-duration-working) linear infinite` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.mobile-session-status.status-entering:after` | `animation:mobile-status-enter var(--wm-duration-status) ease-out` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `apps/mobile-ui/www/styles.css` | `.search-result-end .session-running-dot` | `animation:mobile-status-spin var(--wm-duration-working) linear infinite` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/ui-core/reply-motion.css` | `.reply-sheen-part` | `animation:reply-sheen var(--wm-duration-working) var(--wm-easing-replySweep) infinite；animation-delay:calc(var(--wm-duration-working) * var(--reply-offset))` | 无动画／无过渡，滚动为即时；最终状态保留 |
| `src/ui-core/reply-motion.css` | `.reply-indicator` | `animation:reply-breathe var(--wm-duration-working) var(--wm-easing-smooth) infinite` | 无动画／无过渡，滚动为即时；最终状态保留 |
