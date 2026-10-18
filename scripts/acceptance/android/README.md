# 安卓基线跑法

对应 `docs/PLAN.md` 第 2 节，执行范围以任务书为准。这里仅有独立测试 APK 的驱动与跑法，不修改应用行为。证据、账号、验证码、模型密钥和本机工具路径均由外部输入，不能提交。

## 准备

1. 在独立工作副本读取 `PROJECT-MAP.md`、`AGENTS.md`、本机 `MACHINE.md`，检查工作区，`git fetch origin` 并记录 `origin/main` 完整 SHA。构建期间冻结该源码。
2. 给 `build.ps1` 传 `-Toolchain`、`-Evidence`、`-Locks`。构建使用独立包名 `com.memoweft.weftmate.mobile.b2qa`，保持产品版本号；`driver.init.gradle` 仅将同目录的驱动加入 androidTest。日志、原 APK 与测试 APK 均写到外部证据目录。
3. 启动 `session.ps1`，传 `-Evidence`、`-Locks`、`-Manager`、`-Adb`；首次不传 `-Instance`，新建实例并核对安装前包列表为空。后续只用 `instance.txt` 中的本包实例。禁止操作实例 0、1。实例运行时占 `mumu.lock` 和一个 heavy 名额，18 分钟自动停止并释放。
4. `session.json` 由实际 MuMu info 提供 ADB 端口，再用 `adb forward tcp:0` 申请驱动端口。不要沿用旧会话端口。给证据目录创建 `stop-session` 文件可提前结束该批；新批开始前删除它。

## 手机独立使用

用 `command.ps1 -Evidence <外部目录> -Json <JSON>` 调用驱动：`state`、`tree` 只读，`shot` 截整屏；`settings`、`input`、`click`、`clickLabel` 操作原生页面；`send`、`new`、`stop` 调用同一原生页面模型。`send` 的 actionIssued 仅表示发起动作，必须检查实际历史与模型正文才算发送成功。

首次打开设置可能还在完成账户初始化；应等待设置页稳定再打开模型编辑器。输入服务名、地址后，使用 `command.ps1 -ModelKey` 在进程内读取 `MIMO_API_KEY`（Machine 环境变量），不会将值放进调用命令或日志。点击“查询模型并继续”，选择 `mimo-v2.6-flash`，返回聊天实际问答。不要在模型密钥输入期间保存树、表单或截图。

配置完成后运行以下命令（工具路径和证据目录由执行环境提供）：

```powershell
python scripts/acceptance/android/local-suite.py --evidence <证据目录> --adb <adb.exe> --phase chat
python scripts/acceptance/android/local-suite.py --evidence <证据目录> --adb <adb.exe> --phase memory
python scripts/acceptance/android/local-suite.py --evidence <证据目录> --adb <adb.exe> --phase pages
```

- chat：生成中追加消息及停止、约 1.5 秒三连发、流式切页返回。逐条核对输入与对应回复，不能只看动作回执。
- memory：明确记住、等待 25 秒、新对话召回、纠正及对话遗忘。保留真实原话、记忆列表与来源检查；自动形成失败时，M3 删除另用页面手动新增的合成条目验证，并标明该前置条件。
- pages：五个导航页、侧栏、设置，浅深色共 14 张整屏截图和页面树。驱动推进 Compose 测试时钟并等待空闲；仍须逐张目视核对，不能只按文件名算通过。
- C2：添加错误地址的独立合成服务，核对人话错误、可重试和原模型仍可用；真实流式断连需另外测，不能由错地址替代。
- C4：`seed-history.py --evidence <目录>` 明确植入 600 轮/1200 条合成历史。随即结束该批，重开后核对最新消息与上滑后的早期消息。只用于历史场景，不能将预置回复计入模型问答。
- C5：保存原模型、原对话与历史；结束进程并确认 PID 为空；下一批新进程核对，不能重新发送来恢复内容。云登录状态另列。
- C9：没有真实软键盘时写“阻塞：需真机”。
- C10：保存真实进展行、展开步骤与相同语言标题；没有工具步骤的纯问答不能替代。

## 源码电脑端与跨端

`host.ps1 -Evidence <外部目录> -Locks <锁目录>` 启动本工作副本的隔离无界面 Electron，独立 profile、操作系统随机分配端口、26 分钟超时。它占另一个 heavy 名额。管理输入写入证据目录的 `host-command.json`；停止用 `stop-host` 文件。日志中的 origin 才是实际端口，不扫描其他端口。

电脑端须用合成账号、独立工作目录和 MiMo；手机走产品提供的登录与连接流程。电脑端是源码运行，不能报告为安装版。先验 C8 续聊与模型切换，再验 W2 批准/拒绝，W4 创建文件/读目录/执行命令，W5 离线排队/取消/上线执行，W6 保留原电脑归属；M5/M6 核对手机到电脑的记忆接续与获准召回。

云登录使用执行者会话已经绑定的 `codex_apps / microsoft_outlook_email`：先用 `get_profile` 在进程内取得测试地址；每次提交注册或登录请求前记录UTC时间，只检索该时间之后、主题含WeftMate的邮件，并在进程内核对收件人属于本次测试请求后提取唯一验证码。不要读取无关正文、发送邮件或修改邮箱状态。地址、验证码、密码和模型密钥不写入跑法文件、证据、PR或issue；云账户页用匹配布尔值留证，不能直接截图邮箱。

`cloud-session.mjs <外部证据目录> <锁目录>` 启动26分钟上限的隔离源码电脑端，真实Electron窗口从创建时隐藏，使用随机监听端口；按 `services/cloud/deploy/README.md` 使用已登记的程序回调参数，回调参数不另开本机监听或探测该端口。继承本机工具说明提供的只读frpc和CA文件路径，以及进程内MiMo配置。`--phone-only` 只启动轻量手机驱动控制器，不占电脑端重活名额。

控制器只监听操作系统分配的回环端口，端口和PID写入 `cloud-control.json` / `cloud-control-phone.json`，接收本机POST JSON：`email`与`code`把值保存在进程内，`run`执行实际页面操作，`close`正常关闭并回收自身进程树。调用方从邮件连接在内存中传值，不生成包含地址或验证码的临时文件；控制器输出和证据统一脱敏。`run`中的 `page` 是实际源码电脑页面，`phone` / `web` 操作实际APK；不能用它替换身份、模型或服务响应。

注册可为已绑定测试收件地址使用唯一测试别名，仍须确认对应邮件实际送达；注册和登录分别检查实际账户匹配与问答。冷启动必须在重新输入凭据前留证，不把手动重登录算恢复通过。电脑目录可见不代表内容通道在线；连接、工作、离线排队及记忆接续分别以实际状态记录。证书或中继失败时，写明真实错误和依赖关系，不能继续称“缺验证码”。禁止把注入token、替换接口或伪造云响应算作产品验收。

## 健康、提醒与收尾

H1 实际设置 5 分钟提醒并等待通知，H2 分别核对无来源提示与有合成数据时的今日数据。H5 保存明日本地 9 点提醒，在目标页查看和删除另一条提醒，长期目标须有真实进度；保存不等于到点通知。时间未到明确写阻塞。后台挂起后的通知延迟写“阻塞：需真机”。不改系统时钟、网络或安全设置。

每个场景最多 30 分钟，保留失败和阻塞继续下一项。最后一批 `session.ps1` 加 `-Uninstall`，核对候选及测试 APK 都已卸载、实例停止、ADB 断开、锁已释放。电脑端发送正常关闭后有 15 秒收尾期限，超时只终止自身进程树。公开 PR/issue 仅写合成现象、版本、源码与 APK 散列、证据文件名，不附本机路径或私密截图。
