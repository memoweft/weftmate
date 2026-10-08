# UI-2v · MuMu 安卓外壳验收

2026-10-08，在 MuMu **Android 15** 的真实 `HybridActivity` 中验收最新 main（`f86e2c8`）的 **0.8.4 / versionCode 17**。截图全部来自 `adb exec-out screencap -p`，分辨率 **720×1280**，包含安卓系统状态栏。没有用 Chromium（浏览器引擎）页面截图替代安卓外壳。

未发现需要修改产品代码的问题，因此产品版本保持 code17。本包只增加截图、验收夹具、测试 APK（安卓安装包）内的调试探针与输入法、开发说明；没有修改产品权限、原生连接层或 `/personal/v1` 契约。

## 结果与证据

| 验收项 | 结果 | 截图 |
|---|---|---|
| 原生登录 → 会话列表 | 真实个人服务注册/登录、Cookie（会话凭据）、CSRF（跨站请求伪造防护）与安卓网络连接层；显示运行/待审批状态 | [浅色列表](01-light-list.png) |
| 打开对话 → 运行中 | 默认收起步骤，显示进度与停止按钮 | [运行中](02-light-running.png) |
| 审批卡、模式菜单 | 五种模式完整显示；选择「每次询问」经原生连接层保存；三个按钮至少 48 CSS px（页面像素，设备缩放舍入容差 0.1px） | [三按钮](03-light-approval.png)、[模式菜单](04-mode-menu.png) |
| 处理审批 | 点击「允许一次」，宿主收到 `outcome: allowed-once / scope: once`；原位置收为已处理记录 | [处理后](05-resolved-approval.png) |
| 步骤展开 | 先展开可读摘要，再经原生连接层按需读取原文 | [摘要](06-readable-steps.png)、[原文](07-raw-step.png) |
| 成果/来源全屏 → 返回 | 列表、Markdown（结构化文本）表格成果、来源使用摘要与原文；返回后草稿和原对话滚动位置一致 | [列表](08-outputs-sources.png)、[成果](09-artifact-fullscreen.png)、[来源](10-source-fullscreen.png) |
| 真实系统软键盘 | 非零 IME（输入法）区域、点击键盘按键提交 `q`、输入区在键盘上方、标题位置不变；收起后草稿保留 | [键盘弹出](11-real-ime.png)、[键盘收起](12-ime-dismissed-draft.png) |
| 深色及重载 | 从设置选择深色；列表和对话更新；WebView（安卓网页视图）重载后主题和草稿仍保留 | [深色列表](13-dark-list.png)、[深色对话](14-dark-chat.png) |

机器断言见 [verification.json](verification.json)，原生业务请求见 [requests.json](requests.json)。相关手机交互测试 **96/96**、Android JVM（Java 虚拟机）**27/27**、标准与隔离包 `assembleDebug`、测试包 `assembleDebugAndroidTest` 均通过；真实设备调试探针 **1/1**。完整测试交 PR CI（持续集成）。

## 隔离与输入法边界

模拟器已有调试应用，因此通过 [isolate.gradle](isolate.gradle) 仅将本次构建的包名改为 `com.memoweft.weftmate.mobile.ui2vqa`，测试包为其 `.test`；产品源与 versionCode 不变。安装前核对这两个包名没有已有数据，结束只卸载这两个包。本人原有 `com.memoweft.weftmate.mobile.debug` 与其他应用没有更新、卸载或清空。

[fixture.mjs](fixture.mjs) 在系统临时目录创建独立个人服务与随机密码的合成账号；安卓壳通过 ADB reverse（安卓端口反向映射）连接本机回环 18187。认证、状态、手机本地存储和网络连接层真实运行；对话、运行状态、审批和成果来自与 UI-2 同类的合成 HTTP（网页传输协议）投影，受真实账号与 CSRF 验证保护。**没有运行真实 DSH（助手运行时）任务，没有请求任何模型，也没有访问日用宿主或个人 Runtime（运行数据）。**这项验收证明安卓界面与连接层，不宣称完整执行链路或真实删除文件通过。

MuMu 预装搜狗输入法报告可见，但 `ime frame=[0,1280][720,1280]` 高度为零；开启实体键盘下显示软键盘后仍没有键盘图像。本包使用仅存在于测试 APK 的 `Ui2vTestIme`，它是系统实际绑定的 `InputMethodService`，产生 **324 设备像素**的输入法区域，并通过 `InputConnection.commitText` 提交按键。网页高度从 **980 → 726 CSS px**，输入区底边约 **726.27px**，标题顶边保持 **0px**。没有模拟浏览器高度，也没有往产品页面注入替代连接层。预装搜狗输入法的正常软键盘兼容性仍未验证。

验收后已恢复原默认/启用输入法、子类型、输入法历史和 `show_ime_with_hard_keyboard=0`；卸载本次两个测试包、停止隔离服务并删除本次正反向端口映射。见 [cleanup.json](cleanup.json)。

## 复跑（仓库根目录）

先确认 MuMu 已启动，端口 18187/19222 可用，本次两个隔离包不存在。无需修改模拟器分辨率；当前驱动的键盘按键位置按本次 720×1280 / density（缩放密度）1.275 取证，换尺寸时需相应调整。

```powershell
$adb = 'D:\Software\MuMuPlayer\nx_main\adb.exe'
$serial = '127.0.0.1:7555'
& $adb connect $serial
& $adb -s $serial shell pm list packages com.memoweft.weftmate.mobile.ui2vqa
. D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1
Push-Location apps/android
gradle --offline -I ../../tests/evidence/ui-2v/isolate.gradle :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest --console=plain
Pop-Location
& $adb -s $serial install apps/android/app/build/outputs/apk/debug/app-debug.apk
& $adb -s $serial install apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
New-Item -ItemType Directory -Force .local/ui-2v | Out-Null
node tests/evidence/ui-2v/fixture.mjs
```

服务保持在这个终端运行。随机登录密码只写被忽略的 `.local/ui-2v/login.json`，不进证据、命令行或 Git。每个新终端先按首段设置 `$adb` 和 `$serial`。在第二个终端保存以下原始设置，然后启用本次测试输入法与调试探针（只接受隔离包）：

```powershell
$imeBefore = @{}
foreach ($key in @('default_input_method','enabled_input_methods','selected_input_method_subtype','input_methods_subtype_history','show_ime_with_hard_keyboard')) {
  $imeBefore[$key] = (& $adb -s $serial shell settings get secure $key).Trim()
}
& $adb -s $serial reverse tcp:18187 tcp:18187
& $adb -s $serial shell settings put secure show_ime_with_hard_keyboard 1
& $adb -s $serial shell ime enable com.memoweft.weftmate.mobile.ui2vqa.test/com.memoweft.weftmate.mobile.Ui2vTestIme
& $adb -s $serial shell ime set com.memoweft.weftmate.mobile.ui2vqa.test/com.memoweft.weftmate.mobile.Ui2vTestIme
& $adb -s $serial shell am instrument -w -e class com.memoweft.weftmate.mobile.Ui2vWebViewProbeTest -e ui2vProbe 1 com.memoweft.weftmate.mobile.ui2vqa.test/androidx.test.runner.AndroidJUnitRunner
```

在第三个终端连接 CDP（浏览器调试协议）并操作真实设备；[device.mjs](device.mjs) 用 DOM（页面文档结构）定位控件，再用 `adb shell input tap` 点击，所有业务仍经过产品原生连接层：

```powershell
$appPid = (& $adb -s $serial shell pidof com.memoweft.weftmate.mobile.ui2vqa).Trim()
& $adb -s $serial forward tcp:19222 "localabstract:webview_devtools_remote_$appPid"
node tests/evidence/ui-2v/device.mjs login
node tests/evidence/ui-2v/device.mjs flow
& $adb -s $serial shell run-as com.memoweft.weftmate.mobile.ui2vqa touch files/ui2v-probe.done
Invoke-RestMethod -Method Post http://127.0.0.1:18187/__fixture/stop
```

探针退出后，在保存 `$imeBefore` 的终端完成清理；异常中断时也执行：

```powershell
& $adb -s $serial shell ime set $imeBefore.default_input_method
& $adb -s $serial shell ime disable com.memoweft.weftmate.mobile.ui2vqa.test/com.memoweft.weftmate.mobile.Ui2vTestIme
& $adb -s $serial uninstall com.memoweft.weftmate.mobile.ui2vqa.test
& $adb -s $serial uninstall com.memoweft.weftmate.mobile.ui2vqa
foreach ($key in $imeBefore.Keys) {
  if ($imeBefore[$key] -eq 'null') { & $adb -s $serial shell settings delete secure $key }
  else { & $adb -s $serial shell settings put secure $key "'$($imeBefore[$key])'" }
}
& $adb -s $serial reverse --remove tcp:18187
& $adb -s $serial forward --remove tcp:19222
```

本包未发布 APK 或宿主手机更新包；生产云登录、跨设备通知、实体手机与预装输入法兼容性仍需对应集成验收。
