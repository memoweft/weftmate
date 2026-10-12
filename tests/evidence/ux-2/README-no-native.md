# UX-2：程序内确认与后台命令窗口

本页是本次 `wp/ux-2-no-native-popups` 的证据说明；本目录原有侧栏与账户菜单证据保留在原 `README.md`。全部使用合成账户、`synthetic-host`、独立临时数据目录和随机端口，没有访问本人安装版的 18186 端口或日用数据。

确认框复用现有程序弹层的边框、间距、圆角和主题变量，共用 `src/ui-core/dialogs.js` / `dialogs.css`。危险按钮使用警示色并保持可读的白字，取消取得初始焦点，Tab（制表键）留在弹层内，Enter（回车键）确认、Esc（取消键）取消。异步确认期间切换账户或对话不会保存旧选择；界面尚未绑定提示监听时，preload（界面预加载层）先保留提示，绑定后再显示。

- [真实 Electron（桌面程序框架）浅色确认框](allow-all-electron-light.png)
- [真实 Electron 深色确认框](allow-all-electron-dark.png)
- [真实 Electron 窄窗确认框](allow-all-electron-360.png)：内容宽度请求 360px，实际视口 375px，弹层高 236.85px；[实际尺寸与行为记录](dialog-checks.json)保留测量值。
- [真实安卓浅色整屏](no-native-mobile-android-light.png)与[深色整屏](no-native-mobile-android-dark.png)：Android（安卓）15 / SDK（软件开发工具包）35，实际 WebView（原生网页视图）360×780，原图 720×1560。系统与页面主题一致，状态栏高 48px、与页面顶栏的背景色差均为 0，初始取消焦点、Tab、Esc 与无横向溢出通过，详见[原生记录](no-native-mobile-android-checks.json)。MuMu（安卓模拟器）硬件配置 `qemu.hw.mainkeys=1`，底部导航区不存在；仅测试 Activity（活动页面）请求显示系统栏后仍为 0。**这些图证明确认框和状态栏，不能代替带手势／导航区的完整验收。** 机器没有可直接使用的另一个 AVD（安卓虚拟设备），没有新建环境或下载镜像。

`node tests/integration/ux-2-dialogs.mjs` 使用生产 `createPersonalDesktop` 与隔离宿主。它验证真正设置入口、取消不保存、回车保存、焦点循环、减少动态效果及主进程 IPC（进程间通信）提示的界面接收。窗口开在屏幕外，不接管本人桌面。`tests/integration/ux-2-mobile-native.mjs` 通过隔离测试包、真实原生桥和生产权限页取证；测试包通知授权预先授予，合成夹具不产生无关待办通知，避免系统授权框或通知横幅遮挡。

原生确认／错误消息框仅保留 `src/main.mjs` 的 `requestFatalStartupExit` 中一处 `dialog.showErrorBox`：界面还没有成功加载或已经无法启动时，才能用操作系统报告致命启动错误。有可用界面时改由程序显示，关闭后退出。托盘更新提示不再调用 `dialog.showMessageBox`。原有文件／目录选择器和操作系统自身的权限授权保留各自职责。

控制台验证脚本为 `scripts/probe-console-windows.mjs`，窗口采样器为 `scripts/console-window-monitor.cs`。采样器是 GUI subsystem（图形子系统）程序，先断开它可能继承的控制台，再启动应用；通过 `AttachConsole` 的错误码 6 确认被测 GUI 父进程没有控制台。它只读取 `EnumWindows`、窗口类别／可见状态、进程创建时间与归属，支持 `ConsoleWindowClass`、`CASCADIA_HOSTING_WINDOW_CLASS` 与 `PseudoConsoleWindow`。Windows Terminal（Windows 终端）可能复用外部窗口，归属同时使用控制台客户端列表与本包唯一合成标题，未匹配的用户窗口标题不会写入证据。

JSON（结构化数据格式）将 `applicationWindows` 与用于校准的 `controlWindows` 分开。校准强制创建本包自己的控制台，以最小化且不激活的方式启动；[校准记录](console-calibration.json)及[实际 preview.3 普通路径](console-before.json)、[超时路径](console-timeout-before.json)记录了三种窗口类别的识别。真正旧发布载荷来自 `af819a0c` 的 0.2.0-preview.3；只复制小型 GUI 外壳并使用既有测试身份元数据，应用源代码保持原样，运行时资源以只读联接复用；没有运行安装器或改动本人安装启动记录。普通和超时模型调用均经过真实 DSH（助手运行时）的工具加载、`pwsh` 执行与工具输出返回。

另一个实际漏项在 `@deepseek-ai/dsh-sandbox-windows-acl` 的原生 `CreateProcessAsUserW` 启动器；Node（脚本运行环境）的 `windowsHide` 不覆盖这层。[修前原生启动器记录](console-native-sandbox-before.json)包含合成模型与命令，并在原生受限启动器补充场景抓到自己的 `powershell.exe`、`PseudoConsoleWindow` 和 `IsWindowVisible=true`。这个补充场景直接调用真实 SDK 原生启动器，**不声称它已被证明是本人安装版现场的同一条路径**；旧包普通／超时路径的实际窗口数仍为 0。补丁仅添加窗口显示设置，保留受限令牌、目录 ACL（访问控制列表）和进程创建标志。

`tests/ux-2-program-dialogs.test.ts` 固定阻止界面调用浏览器确认／提示 API；`tests/hidden-subprocesses.test.ts` 检查 `src` 中子进程导入、别名、封装与隐藏选项；`tests/vendor-hidden-subprocesses.test.ts` 在 vendor（固定运行时集成）套件检查实际编译的 DSH、MCP（模型上下文协议）与原生 Windows 启动设置。唯一有意可见的应用动作是经校验的 `System32/notepad.exe`：用户要求打开记事本时显示它的 GUI，不会产生控制台；检查只允许这一处既有动作，不能扩大到命令外壳。

[修后原生启动器与全部补充路径](console-native-sandbox-after.json)中，同一原生层仍成功执行，`applicationWindows` 从 1 变为 0；两种记忆桥通过真实虚拟环境启动器和真正解释器，MCP、git、命令垫片及 `shell:true` 都完成。[修后实际打包载荷](console-after.json)使用原官方 GUI 外壳、本树源代码和新固定运行时，实际模型调用与命令超时终止通过，`applicationWindows=0`。这两轮均另有 1 个最小化原生控制台校准窗口，记录在 `controlWindows`，未混入应用窗口计数。实际平均／最大采样间隔分别为 20.06／48ms、19.93／38ms，JSON 保留全部测量值。

复跑前按 `parallel-rules.md` 取得重活名额；典型命令为 `node scripts/probe-console-windows.mjs --native-sandbox --positive-control --expect-zero --out <结果路径>`，带 `--python <虚拟环境 python.exe> --python-path <Core/src>` 增加真实记忆桥。`--release <官方 win-unpacked>` 测原载荷，另加 `--updated --command-timeout` 测本树打包源代码与超时终止；`--expect-zero` 会在任一非校准可见控制台出现时失败。源目录只读，被测应用与记录使用本次临时目录。

取证完成后，测试 APK（安卓安装包）、应用、临时构建目录、临时打包外壳、合成数据、转发和本包进程均清理；联接先解除再删目录。原有 MuMu 早于本包创建，因此不关闭它；屏幕大小、密度和系统主题恢复原值。新固定运行时只读缓存 253MB，两个构建临时目录已自动清理。最终完整测试计数与云端检查以本次交付结果和 PR（拉取请求）为准。此包包含主进程、preload 和 DSH 变更，需要更新桌面程序本体；手机变更仅为已有界面资源，不需要新壳版本，没有新业务路由或 Core（记忆核心）目录修改。

本地 `node .github/scripts/ci-unit-tests.mjs required` 完整通过：308 文件、1710 通过、0 失败、14 个既有平台条件跳过，[完整必过记录](no-native-required.json)。合入 MOB-2 主线后，Windows 命令行超长只采用主线的相对文件参数和 `--report-directory=<本次临时目录>` 归属标记；原有预加载辅助模块方案已撤掉，选择测试同步主线。只有本机 Windows required（`process.env.CI !== 'true'`）使用两个文件工作线程，云端及 vendor 仍使用一个。前述完整通过记录发生在合并前；本次按调度要求只做启动与前段检查，完整必过交云端。测试选择、筛选与断言未改；先前启动格式错误和单线程触及时限的未完成轮次不计为验收通过。

本地固定运行时整轮最终通过：33 文件、232 通过、0 失败、0 跳过（[运行时记录](no-native-vendor.json)）；手机 CI 同组五文件 113 通过、0 失败、0 跳过（[手机记录](no-native-mobile-tests.json)）。类型检查与公开身份扫描通过，8042 文本、0 命中。两次运行时未通过轮次分别出现原有 HTTP 竞态探针的进程异常退出与合成认证准备连接重置；后者单独复跑通过，完整最终轮无失败，未更改产品或断言来消除红灯。

合入 MOB-2（7c6d0851）后：类型检查、主线选择器和本包固定检查以及生成资源／令牌检查共19项通过。按调度要求仅做完整入口的前段启动检查，89个文件出现通过断言，TAP通过条目711、失败条目0，受控停止并清理，未声称完整必过已完成；[前段记录](no-native-merged-required-startup.json)。云端保持并发1，完整结果由调度方检查。
