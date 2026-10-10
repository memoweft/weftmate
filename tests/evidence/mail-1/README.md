# MAIL-1 · 验证码与账号通知邮件

六种邮件共用 WeftMate 卡片：既有品牌 → 用途标题 → 正文 → 连续验证码（通知省略）→ 分隔线 → 小字。参照只用于结构、留白和层级，未复制参考图片、品牌或文案。

## 可复现证据

在仓库根运行 `node tests/evidence/mail-1/render.mjs`。使用主仓已有 Playwright（浏览器自动化）与 Chromium（浏览器引擎），直接打开 `html/` 中的原始生成邮件；固定品牌图片请求在发出前被拦截并从本地 PNG（位图）提供，真实外部网络调用为 **0**。所有内容均为合成值，验证码 `012345`、设备 `synthetic-device`；测试收件人 `user@example.com` 不进入 HTML（网页邮件）。

这些图是**邮件阅读内容区**，不是手机 App（应用）整屏；没有验收系统栏、QQ／163／Gmail／Outlook／Apple Mail（苹果邮件）的真实投递或客户端自动反色。后者需本人授权上线后验收。本包没有连接生产服务器、没有发送真实邮件。

- **24 张**：六种 × light / dark（浅／深）× 640 / 360 阅读窗；高度 780，完整页面截图。
- **4 张**：图片被拦截、移除 `<style>`（增强样式），各按浅／深系统偏好拍一张 360 图。去掉增强样式时，深色系统偏好也保持整封浅色。
- **4 张**：注册邮件 480 / 390 × 浅／深补验。
- 128 字符合成设备标识在 360 深色下额外做几何与复制断言。
- [render-checks.json](render-checks.json)：每张图的尺寸、颜色、对比度、资源拦截与复制记录；正文／小字最低对比度 **5.69:1**，全部高于 4.5:1。
- **25 次选区与剪贴板检查**：用 `Range.selectNodeContents` 选中验证码，确认它只有一个文本节点；`window.getSelection().toString()` 和按 `Control+c` 后 `navigator.clipboard.readText()` 都严格等于 `012345`。断言六位、无空格、无换行、前导零保留。

| 邮件 | 浅色 640 | 深色 640 | 浅色 360 | 深色 360 |
|---|---|---|---|---|
| 注册验证邮箱 | [图](screenshots/register-light-640.png) | [图](screenshots/register-dark-640.png) | [图](screenshots/register-light-360.png) | [图](screenshots/register-dark-360.png) |
| 找回密码 | [图](screenshots/reset-light-640.png) | [图](screenshots/reset-dark-640.png) | [图](screenshots/reset-light-360.png) | [图](screenshots/reset-dark-360.png) |
| 新设备登录 | [图](screenshots/device-light-640.png) | [图](screenshots/device-dark-640.png) | [图](screenshots/device-light-360.png) | [图](screenshots/device-dark-360.png) |
| 新邮箱验证 | [图](screenshots/email-light-640.png) | [图](screenshots/email-dark-640.png) | [图](screenshots/email-light-360.png) | [图](screenshots/email-dark-360.png) |
| 密码已更改 | [图](screenshots/password-changed-light-640.png) | [图](screenshots/password-changed-dark-640.png) | [图](screenshots/password-changed-light-360.png) | [图](screenshots/password-changed-dark-360.png) |
| 邮箱已更改 | [图](screenshots/email-changed-light-640.png) | [图](screenshots/email-changed-dark-640.png) | [图](screenshots/email-changed-light-360.png) | [图](screenshots/email-changed-dark-360.png) |

| 退化／补验 | 浅色系统 | 深色系统 |
|---|---|---|
| 图片被拦截 | [图](screenshots/register-light-360-blocked-image.png) | [图](screenshots/register-dark-360-blocked-image.png) |
| 去掉增强样式 | [图](screenshots/register-light-360-no-style.png) | [图](screenshots/register-dark-360-no-style.png) |
| 480 阅读窗 | [图](screenshots/register-light-480.png) | [图](screenshots/register-dark-480.png) |
| 390 阅读窗 | [图](screenshots/register-light-390.png) | [图](screenshots/register-dark-390.png) |

## 图片与客户端兼容取舍

选定自有云服务的固定 HTTPS（加密连接）PNG：`https://api.weftmate.com/assets/mail/weftmate-mark.png`，无参数、无第三方资源、无收件人标识、无图片请求日志或 Cookie（会话信息），公共缓存 24 小时。所有邮件共用同一张图，不是跟踪像素。文件由既有 `favicon.svg` 转换成 128×128，白底保留深色品牌环，显示为 56×56 的圆角方块。

相较 CID（邮件附件引用），普通图片 URL（资源地址）更适合跨网页邮箱显示，也不增加附件；代价是客户端首次显示需读取图片，并可能被图片策略拦截。Resend 官方说明 CID 也可能被网页邮箱拒绝；Gmail 通常显示图片，经典 Outlook 默认可拦截图片，因此保留显式宽高、替代文字和独立可读标题。[Resend CID 说明](https://resend.com/docs/dashboard/emails/embed-inline-images)、[Gmail 图片说明](https://support.google.com/mail/answer/145919)、[Outlook 图片说明](https://support.microsoft.com/en-us/outlook/block-or-unblock-automatic-picture-downloads-in-classic-outlook-email-messages)

Gmail / Outlook / Apple Mail / QQ / 163 均以普通 `<img>` 读取 PNG 为目标方案；各端用户图片策略仍可拒绝。不能保证在任何用户设置下自动显示，也没有以浏览器截图冒充五家客户端的实测。上线验收应逐家确认图片允许／拦截、文字版、主题与预览，以及深浅／自动反色。

表格布局与行内样式保证基本版式，媒体查询只增强深色与窄屏。经典 Outlook 有条件固定宽度表格，圆角可能退化为直角；移除增强样式后仍无横向滚动、预览保持隐藏、验证码不换行、复制保持连续。未声明自动深色全局元数据，减少不支持媒体查询时出现半深半浅的机会；客户端主动强制反色无法由模板完全控制。

上线只需发布完整 `services/cloud/`（包含 PNG 和生成令牌快照）并重启云服务；无新增环境变量、无数据库迁移、无账号／登录流程或客户端契约变更。现有 nginx（反向代理）配置转发 `location /`，无需新增 nginx 配置。新增资源仅为精确的公开品牌图片，不是客户端业务接口。

## 第 8 条自查

- [x] 1 没有浏览器／系统原生控件残留：邮件无按钮、输入、下拉或折叠控件，段落与标题明确设置边距／字重／字号。选择复制使用邮件客户端自身行为，不新增网页控件。
- [x] 2、3、5、8 不适用：没有可点入口、菜单、弹层、加载流程或控件状态。
- [x] 4 对齐与间距：卡片居中，品牌／标题／正文／验证码／分隔线左边缘一致；使用既有令牌，几何断言无裁切、重叠或横向滚动。
- [x] 6 浅／深与 640／480／390／360 均检查；对比度 5.69:1 起，代码一行，128 字符设备标识能换行。
- [x] 7 与只读参照对比：品牌、粗标题、用途正文、最醒目的连续数字、分隔线与两行小字顺序相同；沿用 WeftMate 颜色和标识，无参考品牌与话术。
- [x] 9 当前截图未发现上述可适用条目的问题。
- [x] 10 不适用：这是邮件内容区截图，本包不改手机 App 或系统栏，明确不将其作为原生整屏验收。
- [x] 第 11 条：未接管本人桌面，使用无界面浏览器。
- [x] 第 12 条：公开证据无本机用户名、机器名；收件人与设备为合成值。

## 测试与遗留

云服务全套 `node --test --test-concurrency=1 services/cloud/test/*.test.mjs`：**70 通过／0 失败／4 个既有可选集成跳过**；邮件／HTTP（网络请求）与更新记录相关 **23/23**，五文件云登录／手机交互 **109/109**，类型检查通过，公开身份扫描 **0 命中**。主仓 required（完整必过）1429通过／0失败／14个既有跳过；vendor（固定运行时集成）203通过／0失败／0个跳过。四种 `text` 的 `/验证码：(\d{6})/` 断言通过，已静态确认 `identity-helpers.mjs` 及三个 Apple（苹果端）夹具仍使用同一正则；未运行苹果端夹具。

为完成 Windows 云服务全套测试，修复了既有目录 `fsync` 在 Windows 报 `EPERM`（文件同步仍保留，生产 Linux 仍同步目录）、数据库关闭前清理目录以及 POSIX 路径断言。入口测试精确断言 Windows 的强制 SIGTERM（进程终止信号）退出结果，再读回持久数据库；Linux 原有正常退出断言保持。这些不改变验证码有效期、账号行为或数据库结构；没有删除测试、增加跳过或放宽业务断言。

收尾清理：**已清理进程：11**。创建时间、可执行文件、命令行与进程真实工作目录共同核验，命令行中的相对测试文件按工作目录解析；未按父进程编号匹配。两次数据库夹具挂起测试与内存不足时的本包测试运行器已结束，其他工作树／本人程序未触碰。剩余必过测试按单文件并发度运行，完成后复查残留。

独立视觉审查已逐张检查 32 图；换邮箱非本人提示经修正，四张刷新截图的 verdict（判定）为 ship（可交付）。额外范围仅为更新记录及其两处必需生成副本：`docs/changelog/2026-10-10.json`、`src/ui-core/release-notes.js`、`apps/mobile-ui/www/ui-core/release-notes.js`，未改界面行为或版本号。

遗留：真实邮箱送达、客户端预览提取与强制自动反色需本人授权后验收；参考图片未进入仓库。没有新增依赖或配置项，没有修改安卓／界面包版本号。

合主线后复验：基线 `4bae7d49`，相关32/32、更新记录生成副本12/12、类型检查通过、公开身份扫描0命中。邮件源码／设计令牌未被主线修改，32图仍对应最终模板；STATE（当前状态）以主线整页为底只增加本包一行。GitHub（代码托管）最新门禁见[PR #207](https://github.com/memoweft/weftmate/pull/207/checks)，未把排队／运行中标成全绿。

<!-- generated-copy -->

## register

Subject（主题）：验证 WeftMate 邮箱

预览文字：完成邮箱验证，开始使用 WeftMate。

HTML（网页邮件）可见文案：

- 验证你的邮箱
- 欢迎使用 WeftMate。在注册页面输入下面的验证码，完成邮箱验证。
- 012345
- 10 分钟内有效，只能使用一次。
- 如果不是你发起，请忽略此邮件。

Text（纯文字邮件）全文：

```text
验证 WeftMate 邮箱
验证码：012345
10 分钟内有效，只能使用一次。
如果不是你发起，请忽略此邮件。
```

## reset

Subject（主题）：找回 WeftMate 密码

预览文字：确认是你在找回密码，再设置新密码。

HTML（网页邮件）可见文案：

- 设置新的密码
- 你正在找回 WeftMate 密码。在找回密码页面输入下面的验证码，再设置新密码。
- 012345
- 10 分钟内有效，只能使用一次。
- 如果不是你发起，请忽略此邮件。

Text（纯文字邮件）全文：

```text
找回 WeftMate 密码
验证码：012345
10 分钟内有效，只能使用一次。
如果不是你发起，请忽略此邮件。
```

## device

Subject（主题）：确认 WeftMate 新设备登录

预览文字：确认这台新设备是你在登录。

HTML（网页邮件）可见文案：

- 确认新设备登录
- 一台新设备正在登录你的 WeftMate 云账号。如果是你，在这台设备的登录页面输入下面的验证码。
- 设备标识：synthetic-device
- 确认只授权云账号登录，内容权限须另行配对。
- 012345
- 10 分钟内有效，只能使用一次。
- 如果不是你发起，请忽略此邮件。

Text（纯文字邮件）全文：

```text
确认 WeftMate 新设备登录
验证码：012345
10 分钟内有效，只能使用一次。
设备标识：synthetic-device
确认只授权云账号登录，内容权限须另行配对。
如果不是你发起，请忽略此邮件。
```

## email

Subject（主题）：验证 WeftMate 新邮箱

预览文字：完成验证，将这个邮箱用于 WeftMate 登录。

HTML（网页邮件）可见文案：

- 验证你的新邮箱
- 你正在更换 WeftMate 账号邮箱。在更换邮箱页面输入下面的验证码，确认使用这个新邮箱。
- 012345
- 10 分钟内有效，只能使用一次。
- 如果不是你发起，请忽略此邮件。

Text（纯文字邮件）全文：

```text
验证 WeftMate 新邮箱
验证码：012345
10 分钟内有效，只能使用一次。
如果不是你发起，请忽略此邮件。
```

## password-changed

Subject（主题）：WeftMate 密码已更改

预览文字：密码更改已完成，原有云账号登录已退出。

HTML（网页邮件）可见文案：

- 你的密码已更改
- 你的 WeftMate 云账号密码已更改。原有云账号登录已退出，请用新密码重新登录。
- 如果不是你操作，请立即在 WeftMate 登录页面找回密码，设置新密码。
- 本机密码和内容密钥不受影响。

Text（纯文字邮件）全文：

```text
你的 WeftMate 云账号密码已更改。原有云账号登录已退出，请用新密码重新登录。
如果不是你操作，请立即在 WeftMate 登录页面找回密码，设置新密码。
本机密码和内容密钥不受影响。
```

## email-changed

Subject（主题）：WeftMate 邮箱已更改

预览文字：邮箱更改已完成，下次请用新邮箱登录。

HTML（网页邮件）可见文案：

- 你的邮箱已更改
- 你的 WeftMate 账号邮箱已更改。原有云账号登录已退出，下次请用新邮箱登录。
- 如果不是你操作，请立即更改这个邮箱的密码，并检查邮箱中是否有陌生登录。
- 本机的对话、记忆与应急密码不受影响。

Text（纯文字邮件）全文：

```text
你的 WeftMate 账号邮箱已更改。原有云账号登录已退出，下次请用新邮箱登录。
如果不是你操作，请立即更改这个邮箱的密码，并检查邮箱中是否有陌生登录。
本机的对话、记忆与应急密码不受影响。
```
