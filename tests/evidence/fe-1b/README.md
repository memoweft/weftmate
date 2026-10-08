# FE-1b 手机共享功能层验收

改前基线为 `efce1451055271a66c5ba502ba153e55e79522b7`，由 `git show` 导出提交中全部 `apps/mobile-ui/www/` 资产到系统临时目录。390×844 Chromium（浏览器内核）与 MuMu Android 15 的真实 `HybridActivity` 运行同一套按可见名称 / 角色定位的操作。产品页面、字体、样式令牌、文案与布局均保留；验收脚本没有依据控件父节点或页面位置选择功能。

| 文件后缀 | 场景 |
| --- | --- |
| `login` | 原有登录 / 注册表单；真实账户服务连接检查 |
| `list` | 登录后的电脑会话列表 |
| `running` | 正在执行与停止按钮；停止请求保留草稿 |
| `sent` | 发送消息、原命令回执与历史回显 |
| `approval`、`mode`、`resolved-approval` | 三种审批按钮、五种审批模式、模式保存与允许一次 |
| `steps`、`raw-step` | 默认摘要、展开步骤与按需读取原文 |
| `outputs-sources`、`artifact`、`source` | 全屏输出与来源、Markdown（结构化文本）成果表格、来源使用摘要 |
| `memory`、`memory-source` | 当前账户记忆快照、详情与原始来源 |
| `settings`、`appearance`、`dark-list` | 设置、深色主题与列表；重载后主题和草稿保持 |

文件名以 `before-/after-` 与 `chromium-/mumu-` 区分阶段和真实验收表面。MuMu 截图是 `adb exec-out screencap -p` 的完整720×1280实屏，保留系统状态栏；浏览器截图是390×844。个人入口的账号创建、登录、Cookie（会话凭据）、CSRF（跨站请求伪造防护）与授权验证均实际运行。MuMu 的网络、本地持久存储、命令回执和原生桥都使用产品实现；浏览器通过测试桥映射同一隔离HTTP（网络请求）服务。

最终代码的前后浏览器各9项、MuMu各10项行为检查通过，临时换位同组9项检查通过。17对Chromium截图完整像素一致；17对MuMu完整截图每对有265或286个变化像素（0.028754%或0.031033%），均位于系统时钟的 `[40,6,64,23]` 范围，应用内容像素一致。完整逐像素结果见 `screenshot-comparison.json`，未对系统栏做遮罩或裁剪。

会话、执行事件、审批、成果与记忆使用固定的合成投影，没有请求任何模型，没有真实 DSH（助手运行时）执行任务，没有日用运行数据。网页时钟固定为合成记录时间以稳定比较；MuMu 系统栏的真实时钟未修改。完整RGBA（红绿蓝和透明度）比较不裁剪、不遮罩、不忽略区域，系统栏时钟差异也如实计入 `screenshot-comparison.json`。

每次运行均新建随机端口服务、系统临时目录、随机密码的合成账户；口令仅在进程内或临时文件中使用，不写入仓库证据。装包前核对包清单与正在运行的WeftMate进程，只安装独立 `com.memoweft.weftmate.mobile.fe1bqa` / `.test`；结束卸载本次两包、停止本次服务并移除本次随机端口映射。原有调试应用、历史验收应用和输入法设置均未修改。

## 复现

在仓库根目录运行浏览器流程：

```powershell
node tests/integration/fe-1b-mobile-layers.mjs --before
node tests/integration/fe-1b-mobile-layers.mjs
node tests/integration/fe-1b-mobile-layers.mjs --relocated
```

MuMu（安卓模拟器）已启动并连接 `127.0.0.1:7555` 后，先导出基线与构建独立应用。基线只读提交中的资产；新版本构建正常执行手机生成资产检查。基线的检查跳过是因为新Gradle（安卓构建工具）检查读取当前工作树，无法代表由提交导出的旧资产。

```powershell
$baseline = node tests/integration/fe-1b-baseline.mjs
. D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1
$env:FE1B_BASELINE_ASSETS = $baseline
Push-Location apps/android
gradle --offline -I ../../tests/evidence/fe-1b/isolate.gradle :app:assembleDebug :app:assembleDebugAndroidTest -x :app:checkMobileUiAssets --console=plain
Copy-Item -LiteralPath app/build/outputs/apk/debug/app-debug.apk -Destination "$baseline/before.apk"
Copy-Item -LiteralPath app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk -Destination "$baseline/probe.apk"
Pop-Location
Remove-Item Env:FE1B_BASELINE_ASSETS
node tests/integration/fe-1b-mobile-layers.mjs --before --device --apk "$baseline/before.apk" --probe-apk "$baseline/probe.apk"
Push-Location apps/android
gradle --offline -I ../../tests/evidence/fe-1b/isolate.gradle :app:assembleDebug :app:assembleDebugAndroidTest --console=plain
Pop-Location
node tests/integration/fe-1b-mobile-layers.mjs --device --apk apps/android/app/build/outputs/apk/debug/app-debug.apk --probe-apk apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
python tests/integration/fe-1b-compare-screenshots.py
```

`Fe1bWebViewProbeTest` 仅在显式 `fe1bProbe=1` 且目标是本次独立包时启用CDP（浏览器调试协议），结束恢复关闭；没有替换设备桥或网络响应。脚本使用Playwright（界面自动化工具）读取当前可见名称与角色对应的坐标，再用ADB（安卓调试桥）真实点击。输入值经字段输入事件填写；并未把网页点击替代为业务函数调用。相关行为与实际请求断言见每个阶段的 `*-verification.json` 和 `*-requests.json`。

`--relocated` 仅在测试服务返回的 `layout.js` 响应中把「输出与来源」原按钮移动到输入区；产品文件与截图组不改动。相同的登录、发送停止、审批、步骤、成果来源、记忆、外观与重载流程通过，见 `relocated-chromium-verification.json`。这项检查确认操作按照可见名称与角色运行，不依赖原按钮所在位置。

Android JVM（Java 虚拟机）27/27、标准调试包、独立调试包与设备测试包构建通过，并正常执行共享生成副本检查，见 `android-build-verification.json`。设备清理及探针结果见 `before-mumu-cleanup.json` 与 `after-mumu-cleanup.json`。

隔离服务故意让最近活动列表读取不可用，验证原有审批与问题读取、任务来源核对继续独立运行，审批三个按钮仍可用并产生实际回执。允许一次仍通过原生桥发送 `outcome: allowed-once / scope: once`；发送、停止与审批都核对实际请求，未将界面状态变化当作回执。

这组证据覆盖共享功能层接线和界面行为，不宣称真实模型质量、真实文件删除、实体手机软键盘或生产云登录通过；这些继续由其对应工作包验收。完整检查以本包PR（拉取请求）当前提交的CI（持续集成）结果为准。
