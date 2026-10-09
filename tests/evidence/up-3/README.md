# UP-3 合成回归

全部公开图片与数据来自合成账号、合成问候和本机合成模型，不包含本人备份内容、模型凭据或真实对话。

## 验证

- `node tests/integration/up-3-desktop-mobile.mjs`：真实 `src/main.mjs`、Electron（桌面程序框架）与固定 DSH（助手运行时）；合成模型的切换状态由实际 HTTP（网络请求）状态接口返回。桌面与 390×844 远程网页在输入区上方显示「正在加载模型 Synthetic Muse…」，等待期间停止按钮可用；纯文字回复后没有工具卡。活动问候也不显示运行任务卡，排队中的后续请求继续显示排队卡。
- `tests/model-scheduler.test.ts`：实际请求租约、队列位置、模型切换状态与片段阶段；请求结束即移除状态，不误报未知 / 多槽服务为单槽，不改停止与租约释放。
- `tests/personal-memory-processing-route.test.ts`：默认召回不轮询未完成的形成任务，立即使用当前记忆；显式等待仍可单独选用，账号 / 模型路由与 outbox（待处理队列）保留。
- `tests/personal-access-ui-interaction.test.ts` / `tests/ui-core.test.ts`：纯文字在运行、完成、停止与只有来源时不显示工具卡；已有工具步骤的进展、停止、失败、迟到回执和缓存失效提示保留。阶段文案来自宿主字段，停止可用性不变。
- Core（记忆核心）[PR #94](https://github.com/memoweft/memoweft/pull/94)：合成 Python schema（数据库结构版本）18 / 19 / 20 → 当前启动及二次启动，旧原文保留；错误身份、损坏列和未来版本拒绝且不写库。

## 图片

| 界面 | 等待阶段 | 纯文字完成 |
|---|---|---|
| 真实 Windows 程序 | [加载](desktop-loading.png) | [回复](desktop-reply.png) |
| 390×844 远程网页 | [加载](mobile-web-loading.png) | [回复](mobile-web-reply.png) |

原生 Android（安卓）壳和 Apple（苹果）原生界面未在本包重新验收；手机功能包源码与共享 ui-core（界面功能核心）同时更新，发布仍需正常版本化功能包流程。本包不调整本地模型权重、上下文或启动参数；实际模型切换和预填充耗时仍由现有 8081 服务决定。
