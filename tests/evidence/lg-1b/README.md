# LG-1b 手机登录与设备验收

`tests/integration/lg-1b-login-devices.mjs` 启动真实 `services/cloud/src/main.mjs` 云服务、真实 Electron（桌面程序框架）个人宿主，以及 390×844 Chromium（浏览器内核）手机网页或 MuMu（安卓模拟器）的实际 `HybridActivity`。不请求模型；账号只用随机 `example.com` 合成邮箱，密码、邮件验证码、令牌、配对码与可信交付码只保存在进程内。服务端文件邮件只存在本次临时目录；流程结束关闭子进程并删除隔离数据。

Windows（视窗操作系统）的云服务用 WSL Ubuntu（适用于 Linux 的 Windows 子系统）避开文件同步权限错误，随机端口通过本次进程的字节转发连接。个人宿主使用随机端口和系统临时目录，不读取日用数据。手机网页仅将 `/mobile-ui/` 静态资源响应映射到实际 `apps/mobile-ui/www` 构建资产；所有 `/personal/v1` 认证、目录、宿主连接、Cookie（会话凭据）、DPoP（持有者证明）与云服务请求均使用真实网络和产品代码，不替换业务响应或桥接。

测试网页的静态文档由 Playwright（界面自动化工具）提供，Chromium 因该文档缺少远端地址信息而错误将它归入公共地址空间。此隔离浏览器仅关闭 `LocalNetworkAccessChecks`，使本次回环地址间的实际网络请求可执行；产品、云端 CORS（跨域访问控制）、签名与身份验证不变。电脑只将测试 setup（准备阶段）的原生身份元数据设为「合成电脑」，其原生签名、凭据存储与网络实现保留，避免机器名称进入公开证据。

流程按可见名称与 role（语义角色）操作：完整登录、密码显隐和错误；应用内条款与隐私阅读；注册文件邮件和 60 秒重发倒计时；电脑同账号绑定宿主；手机等待批准；真实电脑允许与可信交付；设置设备目录和连接，确认实际宿主会话交换成功并进入主页；换绑邮箱；找回密码；退出其他设备；注销说明与云凭据清除。新账号注册先创建云账号，首次电脑绑定完成后才有可供手机连接的隔离宿主。

Android（安卓）的测试只安装独立 `com.memoweft.weftmate.mobile.lg1bqa` 与 `.test`。安装前检查包清单与正在运行的 WeftMate 进程；结束卸载本次包、移除本次随机端口映射并恢复运行前的系统夜间模式。`Lg1bWebViewProbeTest` 只在显式 `lg1bProbe=1` 且目标为独立包时启用 CDP（浏览器调试协议），不替换原生网络、Keystore（系统密钥库）或凭据实现。定位控件后由 ADB（安卓调试桥）按实际屏幕坐标点击；截图由 `adb exec-out screencap -p` 获取完整实屏。注销清除检查通过仅返回布尔值的调试状态桥，不读回刷新令牌。

Android 完整流程还按当前设备的 group（分组）名称改名，并由真实电脑的「添加设备」取得一次性配对码，在手机「输入电脑的配对码」与「配对连接」中使用。必须收到新增真实 `/personal/v1/cloud/pairings/redeem` 成功响应并进入主页；配对材料存在时不截图、不写报告，结束清空手机输入并关闭电脑配对码。原生请求观察仅原样转发桥接并记录路径与状态，不保存请求体或认证信息。

在仓库根目录执行：

```powershell
node tests/integration/lg-1b-login-devices.mjs --cloud-smoke
node tests/integration/lg-1b-login-devices.mjs
node tests/integration/lg-1b-login-devices.mjs --device --apk apps/android/app/build/outputs/apk/debug/app-debug.apk --probe-apk apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
```

`--visual-smoke` 只运行注册、批准、设备与连接。`--review` 在源码提交后生成审稿页约定的 `review-<平台>-login-<外观>-<UTC时间>.png` 与同名来源 JSON（结构化数据），记录实际源码完整提交；正常开发运行的普通文件名截图不冒充已提交源码。浅深主题分别切换并检查页面实际主题，安卓不靠系统背景推测外观。

验证结果分别写入 `cloud-smoke.json`、`mobile-web-verification.json`、`android-verification.json`；仅记录请求路径、状态与已完成步骤，不保存请求体、认证头、私人信息或绝对路径。完整测试由本工作包 PR（拉取请求）的 CI（持续集成）执行。

390×844 手机网页已完成上述全部真实业务流程，见 `mobile-web-verification.json` 的 `passed: true`。登录与等待页浅色主按钮文字对比为 12.83，深色为 11.58；登录、等待与设备目录六次检查均无横向溢出。登录浅深审稿图记录源码提交 `be219bc0be69156bead4089c61a4f1ad55e949ef`。等待页与设备页已目视核对，只含「合成电脑」「合成手机」及空的配对 / 交付输入，不含配对材料。

MuMu Android 15 的完整原生流程也已通过，见 `android-verification.json` 的 `passed: true`，共记录 11 个步骤，包含本机改名和真实手输配对码兑换。源码提交为 `d73e9646f6b477e8aba383928b64e9ee9f7b0683`；最终登录浅深审稿图使用同一准确来源提交。保留登录、等待、设备目录各两套外观的 720×1280 完整实屏，均已目视检查，没有凭据或个人信息。两端正式报告的来源分别对应实际执行版本，没有将旧图片改标为新源码。

原生报告中的 `nativeErrors` 保留状态切换期间后台 `cloud.pending` 返回的 `LOGIN_REQUIRED` 与 `ACCOUNT_SWITCHED`。这些是旧会话在退出或身份切换后被拒绝的保护结果；实际注册、批准、连接、配对、换绑、找回、退出其他设备与注销步骤全部成功。清理报告确认应用卸载、端口映射移除、探针通过，并将系统夜间模式恢复到运行前的 `no`。

`native-security.json` 的独立设备测试验证不可导出私钥、原生签名、刷新令牌只在原生加密存储、凭据句柄轮换与清除，以及旧桥接口不能绕过保护；同时确认代码版本 21 将旧缓存页面切回内置页面而不删除文件。该测试保留自身实际源码提交和执行时间。

这组实屏验证了真实手输配对码与原生兑换路径，并有 QR decoder（二维码解码器）相关测试。没有进行实体相机对电脑二维码的物理扫码验收，不宣称该场景已通过。证据目录只保留两端最终正式报告、最终登录来源元数据与当前浅深截图，开发中失败轮次的旧审稿图已移除。
