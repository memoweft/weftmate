# AUTH-1 验证与证据

Windows 本机窗口免密码进入已有账户，服务器功能按需弹出可关闭的云登录；云端邮箱核对后直接授予当前绑定的内容会话，设备管理和新登录通知放在登录之后。本包不部署云端，不操作本人日用程序或数据。

说明文件：

- [改动前身份与入口](current-flow.md)：一页现状表。
- [安全依据与上线顺序](security-and-rollout.md)：每项放宽、信任依据、数据兼容及各端后续。
- [宿主原测试逐条变化](host-cloud-tests.md)与[其余测试预期变化](changed-test-expectations.md)。
- [真实迁移记录](migration-verification.json)：真实 Electron（桌面程序框架）原生壳，旧提交 `fa6d96a8` → 新宿主/界面，**同一份合成目录**；初始本机会话已过期、云绑定激活、设备等待确认。旧版卡住；新版直接进入原 owner，原会话、合成记忆文件逐字节、模型偏好、密码散列和绑定保留。记忆 API（接口）使用合成夹具，这个包不做真实记忆内核推理。

真实链路由 [auth-1-login-first.mjs](../../integration/auth-1-login-first.mjs) 重复运行：实际云服务子进程、私有文件邮件夹具、生产宿主 TLS（加密传输）适配器及合成回环中继；手机网页密码库与 PKCE（授权码校验）/DPoP（设备密钥持有证明）未替换。手机登录后实际读取原对话；安全 Cookie（会话凭据）属性、原生免登请求从中继拒绝、通知跳设备设置、确认下线后下一请求401、本机 owner 仍在均断言。没有真实模型请求、真实邮箱或线上云请求。

手动重放先准备旧源码（`.local/auth-1-baseline` 只作合成验证，依赖指向本工作树已有依赖；不要复制任何日用数据）：`git archive fa6d96a8 src scripts/review-gallery/electron.mjs docs/legal design package.json` 解到该目录，链接本工作树 `node_modules`；然后按编排规则占重活名额，执行上面的运行器。源 `vendor/dsh-runtime` 不修改。

截图按 `desktop-1200|480-light|dark-状态.png`、`phone-web-360|390-light|dark-状态.png` 命名。覆盖本机未云登录使用、云登录弹窗、验证码、错误、登录成功、设备列表、新设备通知；设备菜单、详情、改名与下线确认均为打开状态。`old-desktop-waiting.png` 是旧版真实窗口卡住。

| 证据类型 | 浅/深与分辨率 | 系统/导航区域说明 |
|---|---|---|
| Windows 原生壳 | 1200×800、480×800，浅/深 | Playwright（界面自动化工具）驱动自己的 Electron 窗口，窗口页面截图；不接管本人桌面 |
| 手机网页 | 360×780、390×844，浅/深 | Chromium（浏览器引擎）移动视口中的原始内容截图；系统深浅、Android/iOS（手机系统）版本、状态栏与底部导航区域均**未验收**，没有真实系统像素可计算栏色差；不冒充带系统栏的整屏证据 |

各端配合：Android（安卓）`CloudAppCrypto.kt` 云请求白名单加入两个纯验证码路径，`CloudAppUnitTest.kt` 增正反例；支持后 `cloud.app.configure` 返回 `nativeEmailCodeLogin:true`，并取消未连接宿主的批准投影、接 `hostTrust` 的 CA（证书机构）/域名/设备/签名校验和 pin（证书固定）。`/auth/desktop` 只用于宿主自己的原生窗口，Android 不调用；`BusinessRouteUnitTest.kt` 应保留远程拒绝。需要新壳版本，本包不改原生代码或版本号。Apple（苹果端）更新 `CloudLoginModel` / `CloudAccountClient`，接纯验证码与签名核对声明、自动宿主材料、按需登录及设备通知/下线；本包不改 `apps/apple/**`。

多账户免密切换与读取已验证；第二账户的执行/项目权限仍沿既有固定执行账户规则。云 schema（存储结构）8 无迁移；先云端后宿主/客户端，部署由 Claude 与本人安排。

最终必过、固定运行时、手机五文件、云服务、类型、公开卫生与安装包冒烟结果见交付报告与本目录最终验证汇总。最初因按钮文案与 GUI（图形界面）自动开户变化失败的旧测试均按上面的预期清单修复，不删除或跳过断言。
