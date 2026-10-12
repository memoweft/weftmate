# 登录／设备测试预期变化

| 原测试 | AUTH-1 后的预期与保留断言 |
|---|---|
| `revokedDeviceClearsLocalCredentialInsteadOfShowingEmptySuccess` | 改名为 `revokedDeviceRetainsReadingIdentityAndRejectsServerOperation`；服务器操作仍必须报 401，保留只读身份及本机缓存，不再清空界面。身份不匹配仍清除。 |
| `AppAccountTests.nativeRotationSavesOneFamilyAndRestoresDPoP` | 合成宿主资源签名增加 `device_verified:true`；仍核对 DPoP、单次刷新族、重新打开与轮换顺序。 |
| `CloudTokenTests` 的宿主资源夹具 | 同样增加邮箱核对声明；错误发行者／受众／过期／设备密钥的拒绝断言保留。 |
| LG2「注册→待批准→扫码→电脑批准→连接」界面主路 | APPLE2 原生主路改为「密码→新设备邮箱码→自动进入」和「纯邮箱码→自动进入」，不要求旧等待、二维码或批准按钮。注册、找回与账号生命周期仍沿原接口。 |
| `pendingCannotReadContentAndRetryHasFreshNonceAndProof` | 作为旧 SDK／旧服务兼容测试保留；202 不能建立内容身份。新主流程不会显示等待批准页，遇到旧服务返回 202 会提示更新电脑。 |
| 密码创建表单 | 最少 15 位，和现有云端 15–128 位要求一致；登录旧密码不在客户端强加长度限制。 |

新增 `emailOnlyLoginUsesProviderPKCEAndDPoPWithoutPassword` 核对纯验证码路径不包含密码，仍由同一提供方签发与核对 PKCE／DPoP。所有改变针对规则变化，没有删去安全拒绝断言。

新增自动连接核对：`automaticHostDeliveryPinsBeforePersistingAndRejectsChangedInstallation` 证明首次签名材料固定后可建立会话，安装公钥变化拒绝且不覆盖；`automaticHostDeliveryRejectsWrongAccountBeforeSavingContentSession` 证明收件账号不匹配不保存凭据或固定值。`unverifiedHostResourceCannotAuthorizeContent` 证明缺少邮箱核对声明的签名宿主令牌仍被拒绝。

界面测试将进入页预期从旧会话列表改为现有主对话入口，并在合成历史加载后断开登录，逐字核对缓存原文仍可见。

旧 LG2 界面与驱动已适配：首次从本机页面打开登录，已登录未连接电脑核对重试按钮；移除扫码、待批准与另一设备允许的断言，直连主路由 APPLE2 覆盖；退出、换邮箱与注销后仍从本机入口打开登录，下线确认使用新文案。合成电脑绑定先走受保护的本机免密码会话，再调用原 cloud-desktop 接口；旧驱动不再把首次绑定当作免除本机能力校验。

`S1cCloudUITests` 三项旧浏览器／二维码／待批准界面测试改为：本机进入不要求密码或设备批准、密码／邮箱码切换不出现二维码或浏览器、取消登录返回本机。底层令牌／签名／固定值拒绝断言保留；原真实连接与邮件链路由 APPLE2 的四项浅深实服务主路替代，原 S1c 文件夹只作历史证据。
