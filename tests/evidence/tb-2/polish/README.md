# TB-2b 目标页前端返工验收

本包只改目标页呈现与必要的共用菜单 / 固定页标题调用，原生调度、目标、停止回执与接口不变。使用合成账号、系统临时目录、随机端口；未请求真实模型、未操作本人程序或日用数据。真实 Electron（桌面程序框架）窗口使用生产桌面壳，手机网页使用应用的手机界面包与隔离宿主。

## 9 条验收清单

- [x] 1. 无原生残留：最近完成使用按钮、统一箭头与 `aria-expanded`；表单日期 / 时间使用共用 combobox（组合选择框），无原生 date / time 选择器；下拉选项有勾选图标；textarea（多行文本框）无缩放把手；数字框隐藏原生步进；滚动条和焦点使用应用样式。
- [x] 2. 可点击性：内容区悬停 / 按下 / 聚焦有反馈；启用开关报告状态；更多按钮使用应用图标；新建定时任务是明确的主按钮，次级按钮有边界。不可用能力与写入期间保留禁用态。
- [x] 3. 位置：沿用侧栏固定目标入口、分区标题操作位。定时任务仅常驻启用开关和更多菜单；进行中任务常驻停止与更多；长期目标仅常驻更多。行内容可打开编辑 / 原对话 / 目标详情。
- [x] 4. 对齐与间距：布局只使用设计令牌；右侧操作不折行、不挤入正文；来源和状态分行。390×844、360×780、480px 均无横向溢出。长下拉按完整选项行滚动，选中项自动滚入视口。
- [x] 5. 状态：有加载骨架、带图标与下一步说明的空态、错误说明与重试；上次结果用状态点和文字。开关、单选下拉都有可见状态；保存通过 toast（轻提示）显示，不占页面空间。
- [x] 6. 浅深与尺寸：真实 Electron 1200×800 / 480×780；手机网页 390×844 / 360×780；每种均浅深取证。深色危险确认文字改用表面色，正文、次级文字与控件对比度沿用令牌。
- [x] 7. 参照：对照 TB-1 动态页的限宽、标题层级和行密度；只读检查 ref-products 中 Codex / Claude / ChatGPT 的现有菜单、开关、设置列表和 Muse 手机导航。该目录没有任务 / 定时 / 自动化页截图，不伪称已看过缺失参照；本页以同家族 TB-1 与已有列表控件为直接基准。
- [x] 8. 打开态：进行中 / 定时 / 目标菜单、删除确认、新建与编辑表单、目标详情、所有下拉均有桌面与手机浅深截图；长表单另存完整元素截图。复用 `WeftPopover.menu` / `bindSettingsSelect`、应用会话菜单与共用对话框样式。
- [x] 9. 截图复核：修正主对话刷新覆盖顶栏、手机裸选择按钮、下拉末项截断和深色删除确认对比度后，最终证据通过复核。失败过程截图已移除；`verification.json` 枚举最终 140 张取证图，页面错误为 0。

## 前后与尺寸

| 场景 | 浅色 | 深色 |
|---|---|---|
| 退回基线 | [桌面](before-desktop-light.png) | [手机](before-mobile-dark.png) |
| Electron 1200×800 | [浅色](desktop-light.png) | [深色](desktop-dark.png) |
| Electron 480×780 | [浅色](desktop-480-light.png) | [深色](desktop-480-dark.png) |
| 手机 390×844 | [浅色](mobile-390-light.png) | [深色](mobile-390-dark.png) |
| 手机 360×780 | [浅色](mobile-360-light.png) | [深色](mobile-360-dark.png) |
| 顶栏动态页 | [浅色](desktop-activity-header-light.png) | [深色](desktop-activity-header-dark.png) |
| 最近完成展开 | [浅色](desktop-480-recent-expanded-light.png) | [深色](desktop-480-recent-expanded-dark.png) |

## 打开态索引

下表文件族都有 `desktop-…-light.png` / `desktop-…-dark.png` 与 `mobile-390-…-light.png` / `mobile-390-…-dark.png` 四张；按名称可在本目录或 `verification.json` 定位。

| 文件族 | 打开状态 |
|---|---|
| `task-menu` / `schedule-menu` / `goal-menu` | 三类任务的更多操作 |
| `delete-confirm` | 危险删除与默认取消焦点 |
| `edit-form` / `schedule-form` | 编辑与新建定时任务 |
| `goal-form` / `goal-details` | 新建长期目标与只读详情 |
| `once-form` / `weekly-form` / `monthly-form` / `interval-form` | 一次 / 周 / 月 / 间隔字段切换 |
| `select-所属对话` / `select-到点做什么` / `select-重复` | 共用选择菜单与当前项勾选 |
| `select-日期-年` / `select-日期-月` / `select-日期-日` | 日期组合控件 |
| `select-时间-小时` / `select-时间-分钟` / `select-weekday` | 时间与星期组合控件 |
| `saved-toast` | 保存后轻提示 |

`*-form-full-*.png` 为完整表单；`desktop-480-{empty,loading,error}-{light,dark}.png` 与 `mobile-360-{empty,loading,error}-{light,dark}.png` 为三态及重试证据。表单在页面内展开，长内容由页面单一滚动区浏览。

## 验证与复现

- `node tests/integration/tb-2-polish.mjs`：真实程序 / 手机界面、名称与角色交互、三类菜单、开关、编辑、删除取消与确认、全部表单控件、轻提示、三态 / 重试 / 最近完成 / 标题，140 张最终截图、页面错误 0。
- `node tests/integration/tb-2-goals.mjs`：原有固定 DSH（助手运行时）原生行为 22 项全过；合成模型服务，不请求真实模型。最新行为报告在 [fixed-dsh.json](fixed-dsh.json)。
- `node tests/integration/tb-2-mobile.mjs`：原步骤定位、目标与定时操作等 6 项全过；原保护的行为保留，选择器更新为菜单项 / 开关 / 组合选择框。
- `node --test tests/personal-goals.test.ts tests/mobile-ui-core-assets.test.ts tests/settings-select-proxy.test.ts`：17 项全过；手机生成资源与共用控件一致。
- `npm run typecheck`：通过。设计机械检查输出 `[]`；完整测试由 CI（持续集成）执行，推送后的最终结果由 Claude 复核。

## Apple 对应要求

Apple（苹果端）当前没有 TB-2 原生目标页，本包不修改未接入的原生界面、不声称原生验收通过。IA-5 接线时沿用这份母版：三个分区、行内容打开来源 / 详情、Toggle（开关）与统一 Menu（菜单）、仅进行中保留停止、DisclosureGroup（折叠分组）与状态声明、账户 / 设备时区比较及城市文案、应用统一日期时间控件、轻提示、目标 / 动态顶栏和对话专属操作隐藏、三态与浅深 / 窄屏验收。长期目标仍只有原生新建 / 完成 / 归档，详情只读；不添加未提供的编辑接口。契约仍为 CLIENT_API 9.9。
