# 五端夜间回归（R0-3）

Windows 主控每轮刷新专用 Git worktree（独立工作树）到 `origin/main`，构建后先拍真实 Electron（桌面程序框架）、390×844 手机网页与 MuMu（安卓模拟器），再拍 Mac 原生窗口、iPhone 和配对 Apple Watch；避免 Apple 长批次耗尽安卓的执行时间。全部使用合成账号、合成模型目录与执行夹具、随机端口和临时数据；不连接真实模型，不访问日用宿主。审稿场景与浅深主题沿用 `scripts/review-gallery/scenes.json`，不使用仓库历史截图补位。

## 手动运行

在交互登录的 Windows 桌面，用 PowerShell（命令行工具）7：

```powershell
pwsh -NoProfile -File scripts/nightly/run-nightly.ps1
# 可配置整晚时限（默认90分钟）、像素差异阈值（默认8%）
pwsh -NoProfile -File scripts/nightly/run-nightly.ps1 -MaxMinutes 90 -DiffThreshold 0.08
# 合并前验证本包：两台电脑都构建同一当前提交
pwsh -NoProfile -File scripts/nightly/run-nightly.ps1 -Candidate
```

Windows 专用目录为 `D:\AIProjects\WeftMate\Worktrees\nightly`，Mac 为 `~/Desktop/WeftMate/weftmate-nightly`。不使用 `Repository` 或 `weftmate-h3`，不重置有未提交修改的回归工作树。候选模式通过临时 Git bundle（代码传输包）传输已提交代码；默认模式只获取主干。依赖安装与类型检查在专用目录内执行。计划任务注册参数保持原样；`run.mjs` 只准备专用工作树、检出被测提交，再以 `--nightly-engine` 转交给该提交自己的 `run.mjs`。引导层独占报告根目录的总锁并在子编排退出后释放；被测编排独占阶段、临时目录、设备锁与 finally（最终清理），截止时间和报告目录从引导层传入，不重置计时、不重复清理。旧提交没有 `NIGHTLY_HANDOFF_V1` 入口时明确失败；报告同时列引导层提交与被测提交。合并本次改动后只需将计划任务所在 tools 工作树更新一次，以后增加阶段无需同步 tools。

Android 原生壳使用 `-PweftmateApplicationId=com.memoweft.weftmate.mobile.nightly`，不改版本号。

Mac 子进程显式补 PATH（命令搜索路径） `/opt/homebrew/bin`、`/usr/local/bin`、`$HOME/.local/bin`，不依赖交互式配置；缺工具归为一项「环境问题」，各端应拍数量仍列出。

依赖：Node 24、Git、PowerShell 7、Windows OpenSSH（安全远程连接工具）、配置好的 `ssh mac`、Mac Xcode（Apple 开发工具）及现有 iOS/watchOS 运行时、MuMu Android 15。Android 使用 `docs/SETUP.md` 已有 JDK（Java 开发工具）／Gradle（安卓构建工具）／SDK（开发工具包）激活脚本；不重建工具链。首次运行会安装本工作树的 npm（Node 依赖管理工具）依赖与 Chromium（浏览器引擎）。Mac 需要已有登录图形会话；不能在未登录桌面时声称实拍成功。

`-SkipApple`／`-SkipAndroid` 可用于只验证 Windows／网页；跳过也会产生缺图报警，不作为五端通过。运行日志保存在本轮 `logs/`。

设备空闲时可用 `-DevicesOnly -Scene login` 做安卓单场景浅深冒烟；该模式只做准备、安卓和清理，其它阶段明确未执行，仍保留缺图报警。`-DevicesOnly` 不传 `-Scene` 会跑全部安卓适用格；`-Phases vendor-tests,installed-smoke` 可验证指定阶段，准备与清理始终执行。模拟器有其它测试占用时仍跳过，不因冒烟模式抢占资源。缺图／旧时间／失败注入可对已完成批次执行 `node scripts/nightly/validate-alerts.mjs --run <批次目录> --out <证据目录>`；脚本只修改临时副本。

## 固定 DSH 测试

准备完成后先执行 `node .github/scripts/ci-unit-tests.mjs vendor --report <批次目录>/vendor-test-results.json`，再拍各端界面。专用工作树缺少 vendor（固定运行时依赖），或现有清单的固定提交／补丁身份与当前仓库不同，运行器自动调用 `npm run vendor:dsh`。装配器在独立 LF（单字符换行）检出副本中按文件名顺序打全部 `patches/dsh/*.patch` 并编译，只读使用共享 DSH 主检出的 Git 对象；不改变其工作区、分支或配置。固定提交与全部补丁的内容哈希共同标识缓存，Windows 工作树共享 `Worktrees/_shared/dsh-runtime-<提交前缀>-<补丁哈希前缀>`，各 `vendor/dsh-runtime` 用联接指向完整缓存。没有补丁身份的旧缓存明确过期，夜间重建，本机 vendor 测试直接报“运行时过期”。准备失败归为环境问题并继续收集其它阶段，不把未运行测试记为通过。详见 [VENDOR-PACKAGING.md](VENDOR-PACKAGING.md)。

`nightly-status.json` 的 `phases[name=vendor-tests].tests` 含通过、失败、跳过数和失败名单；`nightly-report.md` 有独立测试段落，失败标红并触发既有汇总报警。完整输出在 `logs/vendor-tests.log`。新步骤沿用整晚截止时间和进程清理，不改计划任务；可以用 `tests/nightly-vendor-tests.test.ts` 的合成成功／失败结果验证报告。

## 报告与报警

报告根目录为 `D:\AIProjects\WeftMate\Runtime\Nightly\<本地日期>\`，不进入仓库。当天 `nightly-report.md` 指向最新审稿页；`latest.json` 指向最新批次。每次运行保存在独立批次目录，含 `gallery/index.html`、`gallery/manifest.json`、`nightly-report.md`、`nightly-status.json`、设备清理与通知回执。审稿页格式与 CI（持续集成）一致，每格标明拍摄时间、代码提交和来源。只保留今天及之前13天的日期目录，非日期目录不清理。

安装版阶段保留原打包校验；已生成的隔离 win-unpacked（未封装安装目录）若只在最终包校验失败，仍收集该合成测试程序的独立原生冒烟计数，记录 `buildPassed=false` 并保持整阶段红灯。`--install` 不允许安装校验失败的包；未生成程序或更早构建失败不启动冒烟。

阶段表固定列准备、vendor（固定运行时测试）、安装版冒烟、Windows、手机网页、Apple（苹果端）批次、Mac、iPhone、Watch（苹果手表）、Android（安卓端）、清理；未执行阶段写原因，总结果分别计数未运行与执行后失败，安装版冒烟列实际检查项数。

任一适用格缺图、拍摄时间超过24小时／明显在未来、提交不一致、场景或构建失败、设备被占用、像素比较失败，均报警。Windows 桌面发一条汇总通知；退出码 `0` 表示本轮无报警，`1` 表示报警／失败，`2` 表示另一个夜间批次持有锁。通知的 `supported` 只证明系统接口可用，不证明本人已经看到通知。

像素比较只使用报告根目录 `approved-baseline/` 中人工认可的同端／同场景／同主题原图，夜间运行不会自动替换。审阅审稿页后执行 `node scripts/nightly/approve-baseline.mjs --reports <报告根目录> --run <已审阅批次目录>`；可加 `--platform mobile-web` 或 `--scene outputs-sources` 只认可部分格，缺图／失败格不会认可，基线图片独立复制并不受14天报告保留期限影响。没有认可的格明确表示未比较；认可后差异只有修复回归或再次明确认可才消失。PNG（图片格式）解码后，任一 RGBA（红绿蓝与透明度）通道变化超过24的像素计为变化；变化比例大于阈值报警，尺寸变化为100%。报告按比例列出最大十格。尚无人工认可基线，会明确说明；不会把没有基线称为没有差异。视觉变化报警用于审稿，不能自动判定产品错误。清单明确的「此端尚无」不算缺图，不伪造该端画面。

## 互斥、停止与清理

夜间批次原子获取报告根目录的 `nightly.lock`，同机重入立即退出。设备运行前检查 Orchestrator（工作包编排目录）的 `lan.lock`、原子 `mumu.lock`，Mac 检查是否有开发包在用（正在运行的 `codex -m` 进程或 `xcodebuild`）、已启动模拟器与原子目录锁 `nightly.lock`。Mac 已有模拟器或任一锁存在时写「被占用，未拍」，保留他人的资源，不等待、不抢占、不删除开发锁。安卓调试地址每轮从 `D:/Software/MuMuPlayer/nx_main/MuMuManager.exe info -v 0` 的 `adb_port` 读取，仅连接该地址，不枚举或试探端口。工具缺失、返回无效端口或模拟器未开启都记“环境问题：未拍”，不会替本人启动模拟器。占用检查、实拍、兜底清理共用本轮地址，用完立即 `adb disconnect` 并释放 `mumu.lock`。已启动 MuMu 可以复用：持有 `mumu.lock` 后，检查设备进程无运行中的 WeftMate／UI（界面）测试、无活动 instrumentation（仪器测试），Windows 无安卓构建／测试命令；构建后再查一次。正式包和其它已安装但未运行的包仅列清单，不卸载；预先已装 nightly 独立包则跳过。无法核实占用就失败，不猜空闲。不改系统主题、输入法或模拟器设置，不关闭复用的模拟器。拍图始终留在真实 HybridActivity（安卓网页容器）的 appassets（内置资源）来源，合成桥接在 Node（运行时）侧切换夹具，遵守原生导航限制；不把 WebView（网页视图）导航到被原生安全策略拒绝的随机 HTTP 页面。

Mac 使用 A10／A15 App 自有 AX（辅助功能控件树）运行器，不依赖失败的 Mac XCUITest（Apple 原生界面测试）自动化初始化；iPhone 和 Watch 使用 XCUITest；某个主题或端的真实断言失败保留红灯及已拍图片，继续独立的其它主题／端，不因一处失败取消整批余项。编译 `-jobs 2`，关闭并行测试。iPhone 独立阶段只启动一台；Watch 阶段仅启动本次创建的配对手机和手表，这是 WatchConnectivity（手机手表通信）的必要伴随设备。用完关闭并删除本次创建的设备；只有所有启动设备均属于本轮时才允许 `shutdown all`。

手动运行按 `Ctrl+C` 停止。控制端默认90分钟总时限，Mac 同时设置本机截止时间，SSH（安全远程连接）中断也会执行清理。所有结束路径汇总报告；Windows 进程兜底清理同时核对创建时间、可执行文件与命令行中的本包目录，并重读进程身份避免进程编号复用。MuMu 只在本轮从关闭状态启动后才关闭；仅卸载本轮装入的独立包，撤销本轮端口映射，不停止后台服务。

异常断电后先查看 `nightly.lock` 的运行身份及报告，确认原进程已结束再手动删除该夜间锁。脚本不自动抢遗留锁。不要删除 `lan.lock` 或其他开发包的锁。

## 定时注册与停用

本包只提供脚本，**不执行注册**。Claude 征得本人同意后，在将保留的主干脚本目录执行：

```powershell
pwsh -NoProfile -File scripts/nightly/register-task.ps1
# 只查看计划操作，不注册
pwsh -NoProfile -File scripts/nightly/register-task.ps1 -WhatIf
# 停用持久定时配置
pwsh -NoProfile -File scripts/nightly/unregister-task.ps1
```

任务名「WeftMate Nightly Regression」，当前用户、每天03:00、仅交流电、不提权、交互登录运行。Mac 没有单独定时任务。用户未登录或图形桌面不可用时，计划任务不会获得可实拍的交互环境；检查任务历史与最新报告时间。`unregister-task.ps1` 只删除此任务，不删除报告或回归工作树。

## 顺手清理测试临时目录

每晚收尾时运行 `scripts/nightly/prune-temp.ps1 -Hours 48 -Apply`（本人 2026-10-10 同意）：删除系统临时目录、`C:\Temp` 与 `C:\` 根下名字为 `weftmate-*`、创建和最后修改都早于 48 小时、没有被任何运行中进程的命令行引用、也不是已登记 git 工作树的目录。目录连接点只删除链接本身，不进入其目标。结果写入报告状态的 `cleanup.staleTemp`（找到 / 删除 / 保留各多少）。不带 `-Apply` 只预览；想停用就从 `run.mjs` 去掉这一步或把任务停掉。


## 重活名额与临时目录（NIGHT-3a）

每个实际执行的阶段原子取得 Orchestrator（工作包编排目录）的三个 `heavy-*.lock` 之一，阶段完成或失败清理后立即释放，下阶段重新排队；等待按两分钟重试。单阶段主动命令限制在占用的28分钟以内，为清理留一分钟，单次占用不超过30分钟。报告阶段记录名额、取得时间及占用秒数；超过45分钟的遗留名额按并行规则回收并写日志。专项跳过阶段不占名额。失败会保存退出码、最后阶段、提交内存与 TCP（传输控制协议）连接总数，并按创建时间、可执行文件和本轮目录三条件清掉本阶段进程。

合成目录由 `tests/helpers/managed-temp.mjs` 统一创建：Windows 固定匿名父目录 `C:/weftmate-temp`，随机子目录一律 `weftmate-` 开头。CI（持续集成）与夜间为本次子进程设置独立范围，成功、失败和可处理的中断先停止并等待自己的进程，再删除该范围。强制结束来不及清理的目录，下次运行开头用同一安全清理器回收24小时以上、无活动所属进程或命令行引用的子目录。24小时远大于正常夜间两小时上限；父目录本身保留，联接根不遍历，删除前仍做路径边界、工作树和在用检查。`prune-temp.ps1` 默认24小时，可用 `-Prefixes` 仅选择获准的历史前缀。

`tests/nightly-temp.test.ts` 在必过组内验证代表性成功、失败、中断后本次目录无遗留，以及强杀遗留的下次回收；夜间清理还记录 `cleanup.temp.removed`，删不掉时清理阶段失败。公开日志写入前去除本机用户名与机器名。

本机 MuMu 的 WebView（网页视图）110 未提供 `AbortSignal.any`；当前共同请求层的下一步建议路径使用该 API，会在请求发出前失败。夜间保留原等待与截图断言，并在对应格明确记录产品兼容原因；不通过合成夹具补齐浏览器 API 来冒充产品通过。兼容修复属于产品包。模拟器隐藏底部导航区域时，整屏图和侧车元数据明确记录 `bottomNavigationVisible=false`，这些图只能验收可见状态栏，不能声称底部系统栏已验收；夜间不修改模拟器导航设置。
