# W-1 Windows 程序验收

执行 `node tests/integration/personal-desktop-electron.mjs`，通过 Playwright（自动化测试工具）的 `_electron.launch` 启动本仓库真实 Electron（桌面程序框架）主进程和固定 DSH 运行时。账号、文件、模型服务均为临时目录中的合成数据，模型请求只访问测试创建的回环服务，没有付费请求，也没有访问日用宿主。

截图由 Electron `desktopCapturer` 按测试窗口的原生句柄获取操作系统窗口缩略图，包含原生标题栏与最小化/最大化/关闭按钮；没有使用浏览器页面代替程序。截图只包含合成账号/消息，不包含凭据或个人信息。

| 场景 | 结果与证据 |
|---|---|
| 原生窗口打开并登录 | [01-login.png](01-login.png)；在程序表单输入已有测试账号的密码 |
| 消息、真实 DSH 审批与处理 | [02-approval.png](02-approval.png)；程序内允许本次，原工具继续执行 |
| 时间线与成果 | [03-timeline.png](03-timeline.png)；成果经已有存储校验与下载接口读取 |
| 桌面启动设置 | [04-settings.png](04-settings.png)；开关调用主进程，参数含当前数据目录与 `--start-in-tray` |
| 真实 DSH 提问与回答 | [05-question.png](05-question.png)；程序内选择答案并提交 |
| 三类系统通知 | 捕获原生 `Notification` 的 `show` 事件：审批、提问、完成；见 [verification.json](verification.json) |
| 通知打开对应对话 | 在第二段对话中触发第一段的通知点击事件，窗口唤出并切换到第一段消息 |
| 关窗、托盘、第二实例 | 关窗后同一进程仍在；触发真实托盘对象点击事件唤出；第二次启动正常退出，第一窗口 ID 保持不变 |
| 桌面精灵与显式 DSH 管理入口 | 托盘唤醒真实 `desktop-pet.html` 精灵窗口并休息；独立 `--dsh-window` 确实加载官方运行时页面 |
| 原生成果操作 | 真实调用 `shell.openPath` 与 `shell.showItemInFolder`，打开合成文本与其所在目录；读取导出文件确认内容一致；拒绝任意路径参数 |
| 重启与窗口恢复 | 重启无需再次登录；大小/位置按保存值恢复，允许 Windows 分数 DPI（高像素密度缩放）至多 2 像素的取整差异 |
| 最大化后启动到托盘 | 保存最大化状态的窗口仍在后台启动，唤出后恢复最大化 |
| 无窗口与默认首次启动 | `--headless` 无窗口；不传 `--personal-host` 也打开 WeftMate，空目录使用现有原账户设置链接 |

开机设置测试拦截了 Windows 注册表写入，避免覆盖日用启动项；真实系统登录周期和安装形态留 W-2。通知/托盘的点击由测试向真实原生对象发出点击事件，系统通知的展示则通过实际 `show` 事件独立确认；没有用假通知代替。默认程序打开与资源管理器调用均委托真实系统 API（应用程序接口）。

`npm run typecheck` 通过；`node --test tests/personal-host.test.ts tests/personal-access-ui-interaction.test.ts` **68/68**。另跑 `tests/personal-access-ui.test.ts` 时，其固定静态资源检查通过；该文件既有「public account shell keeps secrets out of markup and code-generated HTML」失败仍属于 `.github/ci-test-exceptions.json` 登记例外。完整测试由 GitHub CI 执行。

旧 DSH 窗口保留为显式 `--dsh-window`：它仍承担运行时设置、模型路由诊断和旧精灵管理，不作为默认界面。桌面精灵窗口和托盘唤醒/休息代码保留。安装包、桌面快捷方式、原生云登录回跳及真实开机登录周期不在本包。
