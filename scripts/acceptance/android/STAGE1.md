# 安卓同提交候选验收跑法

产品候选取冻结的 main 提交。这里的 androidTest 驱动仅操作安装 APK 的真实模型、原生页面和内置网页，不替换模型、云、账号、中继或记忆服务。阶段结果、账号、截图和日志全部放仓库外。

## 构建、启动、结束

```powershell
& scripts/acceptance/android/stage1-build.ps1 -Toolchain <工具链根目录> -Evidence <外部证据目录> -Locks <锁目录>
& scripts/acceptance/android/stage1-emulator.ps1 -Evidence <外部证据目录> -Locks <锁目录> -Manager <MuMuManager.exe> -Adb <adb.exe> -Uninstall
```

不传 Instance 时创建全新 Android 15 实例，拒绝实例 0、1。显式传入本包创建的 Instance 才可在批次间保留数据做冷启。每批 18 分钟，占 mumu 和一个 heavy 名额；创建 stop-session 文件可提前收尾。最终批次必须传 Uninstall，并检查 session-cleanup.json 的 packagesAbsent、locksReleased；不要只停脚本而不核对清理。

build 脚本保存 APK SHA-256、版本和源码 HEAD；每次重建后都核对这些值。它使用隔离包名 com.memoweft.weftmate.mobile.b2qa，Gradle 15 分钟超时，结束时回收所拥有的进程树。产品 APK 和 androidTest APK 分别保存。

```powershell
node scripts/acceptance/android/stage1-session.mjs <外部证据目录> <锁目录> --phone-only
```

手机会话从 session.json 读取动态 adb forward 端口。电脑使用同一源码提交的候选安装包或隔离源码实例，并记录身份；需要自行起电脑时可按 [RELAY.md](RELAY.md) 的 --desktop-executable / --use-env-proxy 操作。不要把另一端的不同提交或源码运行说成安装版验收。

Windows 控制令牌文件使用 CurrentUser DPAPI（当前用户数据保护）加密，仅保存 controlTokenProtected；HTTP Bearer 校验和拒绝 Origin 的行为沿用 main。调用端在进程内解密，不打印令牌：

```powershell
$p = Get-Content <外部证据目录>/cloud-control-phone.json -Raw | ConvertFrom-Json
Add-Type -AssemblyName System.Security
$token = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect(
  [Convert]::FromBase64String($p.controlTokenProtected), $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser))
$body = @{op='run';id='observation';script="return await phone({action:'state'});"} | ConvertTo-Json
Invoke-RestMethod -Uri ("http://127.0.0.1:" + $p.controlPort + "/") -Method Post -ContentType application/json -Headers @{Authorization=("Bearer " + $token)} -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

email / code 操作只把值放进控制器内存。只读本次请求后的对应 WeftMate 验证邮件；不要把邮件地址、码或请求头写进脚本、结果、PR、issue。close 操作结束控制器；26 分钟到期也会收尾，单次动作 180 秒超时。

## 可重跑动作与判定

- stage1-command.ps1 可直接发送 JSON 驱动请求；不带 ModelKey 时不会读取模型密钥。响应要核对 ok 和真实结果，发出动作不等于通过。
- Stage1Driver 每次请求重新取当前 RESUMED NativeActivity，报告 foreground、submitting、workBusy。通知权限对话框、网页登录、页面切换后，先核对可见页面和当前状态再继续；不能拿旧 Activity 的状态代替当前画面。
- stage1-cases.mjs 导出 chat、memory；用于手机独立使用，memory 可分 start / finish。重跑时用 save 包装器增加文件前缀，保留首次证据。模型应答、形成、纠正、删除和来源读回分别核对；超时保存当前状态，不推断通过。
- stage1-remote.mjs 的 observe 保存状态、可见树、整屏图；queueAndStop 先确认前台单机状态，保留排队和停止证据。第二条排队回复的耗时不等于停止当前回复的延迟，应另量单个活动回复的停止时间。
- createWork 只选择真实已授权 projectId，等待新工作、文件夹及审批设置就绪。审批应核对 pending 记录和电脑上的实际文件；禁止只凭模型说已完成或审批回执算通过。系统文件夹选择器可用仅返回本包测试目录的测试替身。
- C8 在两端同一个 chatId 续聊；M6 两个方向各用新对话核对。W4 实际检查创建文件、目录内容与命令输出。W5 先确认离线任务入口可用，再分别提交执行与取消；已有工作离线的 W6 另测，不用 W5 代替。
- stage1-history.py 通过实际 WebView 的 androidBridge.call 保存 600 个明确标注的合成 turn（1200 条消息），保存回执、字节数与读回条数。只有 persistedTurns=600 才继续冷启、打开最新、向上加载。未保存时记录准备历史被产品桥阻塞，不能把合成内容当模型应答，也不能宣称分页通过。
- rerun2-cases.mjs 的 historyScroll 在冷启读回后发出实际触摸下滑，保存手势前后的可见树与截图；比较末尾标记与较早标记，不能只凭状态含有1200条就判浏览通过。formedDialogueForget 等到真实条目出现后才测试删除，避免固定延时结束时条目尚未形成。
- 任务书明确允许时，可用 absoluteReminder 生成当天几分钟后的绝对时刻替代 H5 的明天9点；把日期、时区、目标时刻和原话写入外部证据，实际等待调度投递、安卓系统通知，再验查看与删除。该助手只生成请求，不代替通知送达证据。
- 设置首页调用 settings 的空名称；进入后等“搜索设置”出现再截图。home 字符串可能进入网页子页，刚打开的骨架屏也不能当首页完成。长侧栏不应依赖未组合进可见树的底部“设置”文字。
- 所有结果按 PLAN 原条件判定。五页、侧栏、设置首页共 14 张浅深色整屏图须实际查看。真实软键盘、后台挂起通知延迟留给真机；提醒保存成功不等于到点收到通知。

验证驱动改动时重建 androidTest，核对产品 APK hash 不变，再实际调用 observe、树、截图和所改动作。运行 node --check、Python 编译检查、仓库 typecheck 和 public-hygiene；控制器还要实际检查无 Bearer 返回 401、带 Origin 返回 403。不得把逐场景结果加入本目录文档。
