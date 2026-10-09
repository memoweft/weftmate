# A7 · Apple 对话菜单、已归档与遗忘确认

D34 的七个动作共用 `SessionMenuAction`：置顶 / 取消置顶、标记为未读 / 已读、行内重命名、分叉、移至分组、归档、删除。Mac 侧栏悬停菜单与右键使用同一 `SessionActions`，菜单快捷键为 P / U / R / F / A / D；iPhone 长按与左滑打开同一动作集合。分组按宿主返回顺序显示，置顶独立在上，其余分组可折叠。分叉成功后刷新并打开子对话。

「已归档」按 UI_SPEC 6c 接入 A6 设置注册表（Mac 13 类 / iPhone 11 类），有搜索、恢复和删除；最近对话侧栏已移除旧入口。设置窗口或子页自行呈现删除确认，保留所在设置页。

D33 的记忆「忘掉」和会话删除勾选遗忘均先读取既有 `forget-preview`。确认框列出名称、类型、记忆项数与来源数；「同时删除对话里含这句话的原话」每次打开或重新读取默认不勾。预览失败、与记忆详情修订不同、关闭详情或账户切换均不能确认；服务端返回版本冲突后需要重新读取。记忆操作沿用不可变请求和本机操作记录，选项随原请求持久化；兼容旧操作记录未带选项的原始请求体。

## 验证

- Swift 定向 SDK / 菜单 / 分组 / 预览 / 请求记录 / 内存清理回归：78 项通过。
- 独立 Swift 状态检查：AppleContractStateChecks、AppleTaskEntryChecks、MemoryWorkspaceStateChecks 通过；包含没有预览、失败、修订变化均不发送删除，以及重新读取重置原话选项。
- 共享设置注册表 / 控件 / 设计令牌：18 项通过。
- 隔离真实个人接口冒烟：重命名、置顶、未读、分组、分叉、记忆与会话预览 / 删除通过。
- iPhone 浅色 / 深色两轮完整原生操作均通过（各 1/1，0 跳过）：长按七项、置顶与已读切换、行内重命名、分组新建 / 移入 / 移出、分叉立即打开并发送、左滑同一动作集合、设置已归档搜索 / 恢复 / 删除、两类遗忘范围与默认不勾、记忆请求主动勾选原话选项。
- Mac 最终 Debug 构建通过；菜单、已归档、记忆遗忘确认、会话遗忘确认各浅 / 深，8 张 App 自身窗口图。Mac 截图展示工具栏中同一动作集合；侧栏悬停 `Menu` / 右键 `contextMenu` 的实机快捷键交互没有宣称为自动化验收。
- 16 张原生 PNG 的名称 / 来源 / 场景 / 主题矩阵完整；审稿页菜单四格均选择 A7 最新来源。独立审稿来源测试 4/4 通过；页面在 1600 / 390 宽、浅 / 深下无横向溢出，图像可解码。

所有操作仅用隔离合成账户和内容，没有本人日用数据、环境凭据、真实邮件、付费模型或生产服务。复用 A5 / A6 的真实隔离 cloud main、个人宿主与鉴权；Apple A7 原生操作使用隔离本机合成账号；cloud 用真实注册 / 宿主绑定引导夹具，云登录 UI 保留 A6 验证。DSH 事件 / 分叉执行和 Core 级联为确定性合成夹具，验证 Apple 接线、请求与原生界面，不宣称真实 DSH 历史分叉或真实 Core 物理清除。真实后端行为见 UI-5 与 FG-1 的各自证据；真机、安装版、生产与长时稳定性另验。

## 重跑

生成工程后用 `xcodebuild ... -jobs 2 build-for-testing` 构建 WeftMatePhone；通过 `run_a5_ui.py --phase a7-light` / `a7-dark` 执行 A7SessionMenuUITests。Mac 使用 WeftMateMac Debug 构建与 `A5MacCapture.swift` / `run_a5_mac.py`，审稿菜单用 `--scene session-menu`，已归档用 `--settings-categories --scene archived`，两类遗忘确认用 `--scene memory-forget` / `conversation-forget`。

每次仅开一个隔离 iPhone 模拟器，最终构建与 UI 执行串行且 `-jobs 2`；UI 完成立即 `xcrun simctl shutdown all`，未开 Watch 模拟器。Mac 图仅捕获当前原生 App 自身窗口，不枚举其他应用。审稿菜单图按 docs/review/README.md 命名，元数据保留实际拍摄源码提交与 UTC 时间。

首轮 UI 发现行内编辑和已归档搜索被外层可访问性标识覆盖，修正容器后重验，不放宽控件断言。Mac 首轮窗口截图对嵌套面板排序不正确，已改为 App 自身窗口前后顺序并重拍；菜单删除使用危险色，浅色分组标签完整显示。旧 A5 合成测试把桌面打开能力当任务能力，已按 A5 会话能力契约修正夹具并保留无任务请求断言。测试失败收尾期间曾提前开始重建，已立即中止；最终所有构建与 UI 执行按串行方式完成。

## 截图索引

| 场景 | iPhone 浅色 | iPhone 深色 | Mac 浅色 | Mac 深色 |
|---|---|---|---|---|
| 对话菜单 / 审稿 | [截图](review-iphone-session-menu-light-20261009T012927Z.png) | [截图](review-iphone-session-menu-dark-20261009T013415Z.png) | [截图](review-mac-session-menu-light-20261009T014017Z.png) | [截图](review-mac-session-menu-dark-20261009T014026Z.png) |
| 设置 → 已归档 | [截图](a7-iphone-archived-light-20261009T012927Z.png) | [截图](a7-iphone-archived-dark-20261009T013415Z.png) | [截图](a7-mac-archived-light-20261009T014038Z.png) | [截图](a7-mac-archived-dark-20261009T014047Z.png) |
| 记忆遗忘确认 | [截图](a7-iphone-memory-forget-light-20261009T012927Z.png) | [截图](a7-iphone-memory-forget-dark-20261009T013415Z.png) | [截图](a7-mac-memory-forget-light-20261009T013922Z.png) | [截图](a7-mac-memory-forget-dark-20261009T013931Z.png) |
| 会话遗忘确认 | [截图](a7-iphone-conversation-forget-light-20261009T012927Z.png) | [截图](a7-iphone-conversation-forget-dark-20261009T013415Z.png) | [截图](a7-mac-conversation-forget-light-20261009T014059Z.png) | [截图](a7-mac-conversation-forget-dark-20261009T014109Z.png) |
