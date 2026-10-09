# UI-P2 第一轮验收

基线：`d2f188deb7b15087a9d7202c66222fe59588b96e`。所有图片来自隔离宿主、临时程序配置与合成账户，没有复制本人反馈截图。桌面由 Playwright `_electron.launch` 驱动生产 `createPersonalDesktop` 窗口；手机为 390×844 网页。记忆、系统状态与长模型列表使用合成接口投影，未测试记忆形成或遗忘服务。

复现：`node tests/integration/ui-p2-polish.mjs`。文件名中的 `before` / `after` 为改前 / 改后，`light` / `dark` 为浅 / 深色，每个场景均有对应图片。

| 反馈 | 图片后缀 | 验证 |
|---|---|---|
| 1 会话行按钮 | `01-session-row` | 两种主题整行高亮；按钮透明底，保留名称、键盘与菜单动作 |
| 2 记忆主题与入口 | `02-memory`、`07-memory-detail` | 桌面记忆管理内嵌设置分类，旧入口进入同一浮层；手机设置子页保留原生返回结构 |
| 3 设置导航重叠 | `03-navigation` | 4px 间距令牌；悬停使用中性背景，选中使用主题色背景，实际几何断言通过 |
| 4 桌面下拉 | `04-dropdown`、手机 `04-models` | 设置共用 combobox（组合框）/ listbox（列表框），复用 FIX-5 定位；长列表搜索、上下键、Enter、Esc、后台模型保存通过；手机保持系统选择器。改前图记录原生控件，原生操作系统展开层不在页面截图内 |
| 5 标题栏缺口 | `05-confirmation`、`05-native-caption` | 复核 FIX-7，不再改标题栏布局；确认浮层位于标题栏下方，间距至少16px。`native-caption` 通过 desktopCapturer（桌面窗口捕获）捕获该程序窗口，含 Windows 原生标题栏按钮 |
| 6 通知应用身份 | `identity-verification.json` | 临时目录创建真实快捷方式，回读 `com.memoweft.weftmate`，重复执行、撤销、恢复原快捷方式通过；未写本人开始菜单 |
| 7 深色巡检 | `07-appearance`、`07-memory-detail`、`07-legal`、`07-image` | 桌面与手机设置、记忆详情、法律文本、图片预览检查；另跑 UI-4 全部设置分类浅深色与窄窗回归 |

巡检发现并修复：通用页页头仍用浅色透明背景；完成状态直接引用浅色成功底；手机图片预览固定深色画布和黑色顶栏；桌面同步图片预览固定深色画布和关闭按钮。现改用当前主题的表面、文字、成功与交互令牌。当前 main 的主题令牌已经覆盖文档，旧截图中的整页主题错位没有直接复现；本包保留主题继承并统一记忆入口。

通过的相关检查：现有桌面 UI-1 浅深色交互、UI-4 全部设置分类/搜索/窄窗/用量/更新/备份/提醒/手机返回、FIX-5 菜单边缘定位、账户与会话交互、记忆身份隔离、令牌生成、手机生成资产、身份脚本、`npm run typecheck`。完整套件交 PR（拉取请求）CI（持续集成）。Impeccable（界面精修技能）机械检查只报告原有 Markdown（轻量标记语言）引用线，本包未改该引用样式。

**通知验证边界**：临时目录中的快捷方式不会注册到 Windows 通知身份库。本机没有 Windows Sandbox（Windows 沙箱）或独立 Windows 虚拟机，且本人明确禁止在日用用户下安装。因此没有第6项真实通知横幅截图，也不宣称实际通知名称已经验收。Claude 与本人可在仓库根执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-desktop-identity.ps1
# 撤销本次注册，并恢复之前的同名快捷方式（如有）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-desktop-identity.ps1 -Undo
```

脚本按 [Microsoft 的桌面通知快捷方式说明](https://learn.microsoft.com/zh-cn/windows/win32/shell/enable-desktop-toast-with-appusermodelid) 写入快捷方式的 `System.AppUserModel.ID`；主进程原有 `app.setAppUserModelId` 已使用同一值。未增加权限、变更契约、安装本人开始菜单、运行真实模型或修改 UP-3 工具进展卡。
