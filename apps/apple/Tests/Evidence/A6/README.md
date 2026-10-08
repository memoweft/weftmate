# A6 · Apple 统一设置

按 PLAN D31 / UI_SPEC 6c 迁移设置分类。Mac 使用独立原生设置窗口、分类搜索和 NavigationSplitView / Form；iPhone 使用系统分组列表和子页导航。分类名称、顺序与图标沿用统一规格与 UI-4；Watch 不增加设置。

账户 / 设备、外观、审批、记忆、用量、关于及更新均保留领域能力。对话菜单「本对话用量」进入设置 → 用量并显示所属对话，Mac 可返回全部用量。SCH-1 提醒管理、BK-1 自动备份 / 保留策略 / 立即备份 / 确认恢复和 3.15 系统状态 / 确认重启 / 后台模型接已有个人接口，没有新增服务端路径或 wire 字段。

## 验证范围

- Swift 定向分类、搜索、深链、提醒 / 备份 / 系统 / 后台模型契约，以及 A5 既有客户端回归：21 项通过。
- 共享设置注册表、控件契约、设计令牌与图标：21 项通过；macOS 测试目录使用 `/private/tmp`。
- iPhone 原生 UI 最终 7 次执行通过、0 失败 / 跳过（含两轮标题精修后的浅深补拍）；Mac 最终 Debug 构建通过，12 分类 × 浅深共 24 张窗口图。结果见本目录对应 `validation-*.json`。
- 完整仓库测试交 PR 的最终提交 CI；本地没有重复执行完整单测。

所有 UI 验收使用真实隔离 cloud main（文件邮件传输）与个人宿主 / 本地备份管理器；DSH、系统状态、模型和 Core 管理器为合成夹具。提醒暂停 / 恢复 / 单次运行 / 确认删除通过真实个人接口；自动备份与保留设置读到真实备份管理器默认值。没有调用真实模型、真实邮件、生产云 / 中继或本人日用数据。备份与服务管理的 SDK 契约检查不替代真实安装版的恢复 / 重启验收。

iPhone 截图来自 XCUIApplication，Mac 截图来自实际运行的原生 App 自身设置窗口，仅捕获本进程窗口，不枚举或截取其他应用。Mac 截图使用隔离的本机合成账号，云账号全操作在 iPhone 真实隔离流程中验证。每张审稿图按 docs/review/README.md 的场景 / 外观 / UTC 命名，带准确源码提交与时间的同名 JSON；不把拍摄源码改标为后续证据 / 文档提交。

本机始终只开一个 iPhone 模拟器，xcodebuild 使用 `-jobs 2` 串行构建与 UI 执行。每轮 UI 完成立即关闭全部模拟器；未启动 Watch 模拟器。正式设备、生产服务、真实模型 / Core 和长期稳定性另行验收。

## 功能边界

Apple 开机自启尚未接入，常规显示「即将支持」；关闭 Mac 主窗口后程序保留在 Dock。通知沿用系统权限。外观颜色模式在设备上持久化，主题色 / 系统字号 / 标准密度显示实际状态，编辑与账号同步留对应功能包；小纬形象归外观分类。模型凭据编辑不在本包新增，主模型随新对话选择；后台模型 Mac 可选、iPhone 按契约只读。手机不显示「此电脑」。本地备份目前未加密、排除凭据，恢复有重启与重新登录确认。

## 审稿页场景

| 场景 | iPhone 浅色 | iPhone 深色 | Mac 浅色 | Mac 深色 |
|---|---|---|---|---|
| 设置 / 外观 | [截图](review-iphone-appearance-light-20261008T185628Z.png) | [截图](review-iphone-appearance-dark-20261008T185809Z.png) | [截图](review-mac-appearance-light-20261008T191029Z.png) | [截图](review-mac-appearance-dark-20261008T191219Z.png) |
| 设置 → 用量 | [截图](review-iphone-usage-light-20261008T185628Z.png) | [截图](review-iphone-usage-dark-20261008T185809Z.png) | [截图](review-mac-usage-light-20261008T191056Z.png) | [截图](review-mac-usage-dark-20261008T191246Z.png) |

## Mac 全部分类

| 分类 | 浅色 | 深色 |
|---|---|---|
| 常规 | [截图](category-mac-general-light-20261008T191019Z.png) | [截图](category-mac-general-dark-20261008T191210Z.png) |
| 外观 | [截图](review-mac-appearance-light-20261008T191029Z.png) | [截图](review-mac-appearance-dark-20261008T191219Z.png) |
| 账户 | [截图](category-mac-account-light-20261008T191038Z.png) | [截图](category-mac-account-dark-20261008T191228Z.png) |
| 设备 | [截图](category-mac-devices-light-20261008T191047Z.png) | [截图](category-mac-devices-dark-20261008T191237Z.png) |
| 用量 | [截图](review-mac-usage-light-20261008T191056Z.png) | [截图](review-mac-usage-dark-20261008T191246Z.png) |
| 模型 | [截图](category-mac-models-light-20261008T191105Z.png) | [截图](category-mac-models-dark-20261008T191255Z.png) |
| 审批 | [截图](category-mac-approvals-light-20261008T191114Z.png) | [截图](category-mac-approvals-dark-20261008T191305Z.png) |
| 记忆 | [截图](category-mac-memory-light-20261008T191124Z.png) | [截图](category-mac-memory-dark-20261008T191314Z.png) |
| 提醒与定时任务 | [截图](category-mac-schedules-light-20261008T195108Z.png) | [截图](category-mac-schedules-dark-20261008T195118Z.png) |
| 系统状态 | [截图](category-mac-system-light-20261008T195130Z.png) | [截图](category-mac-system-dark-20261008T195139Z.png) |
| 备份与恢复 | [截图](category-mac-backups-light-20261008T195151Z.png) | [截图](category-mac-backups-dark-20261008T195200Z.png) |
| 关于 | [截图](category-mac-about-light-20261008T191200Z.png) | [截图](category-mac-about-dark-20261008T191350Z.png) |
