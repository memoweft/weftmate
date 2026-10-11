# AUTH-1 原测试预期调整

宿主逐条说明见 [host-cloud-tests.md](host-cloud-tests.md)。以下保留了原安全断言，只有明确改变的登录规则调整。

| 文件/用例 | 原断言 → 新断言 | 原因与保留的保护 |
|---|---|---|
| `ui-core-cloud-auth` 等待批准 | waiting、定时重试后进入 → 旧宿主 pending 提示更新、无 Cookie 授权与无轮询 | 新规则不进入批准页；未知旧响应不能被当作会话 |
| `ui-core-cloud-auth` / `synthetic-cloud-binding` 签名夹具 | 无设备声明 → 正向夹具签 `device_verified:true` | 新宿主/客户端必须核对字面 true；缺声明负向用例保留/新增 |
| 云 `app-devices` / `hosts` / `offline-control` | 邮箱确认后仍 pending/202/须 allow → trusted/200、返回 hostTrust、pending队列空 | 云邮箱核对已足够；绑定/公钥/重放/撤销仍检查 |
| 云 `account-lifecycle` / `app-devices` | 云退出/重置/注销让桌面 Cookie 401 → 本机 desktop 200，远程 cloud Cookie 仍401 | 本机数据属于当前操作系统用户；远程不得沿用旧云权限 |
| 云 `app-devices` / `account-lifecycle` 第二云账号 | 自动新空 owner → 当前 owner 冲突409；测试显式建/选另一个本机账户再绑定 | 邮箱不能据此接管或替换已有数据 |
| 云 `web-login` / `relay-phone` | 等待/允许/手传可信码 → 邮箱核对后立即内容；设备下线后401 | 原真实改名、私钥不可导出、刷新凭据不入 localStorage（浏览器本地存储）、解绑和工具审批均保留；旧配对单次/重放改走兼容 API 验证 |
| 云 `mail` | “内容另行配对” → 登录后在设置管理设备 | 登录规则改变；动态值转义、验证码格式和邮件隐私断言保留 |

| `personal-access-proxy` 真实 Caddy TLS（传输层安全）代理 | 远程本地密码登录 200、可用 Cookie（会话凭据）与代理退出 200 → 登录/注册 403 `CLOUD_LOGIN_REQUIRED` 且无 Cookie；本地设置 Cookie 经验证 TLS 重放 403；合法本机退出后本机/代理读取均 401 | 非本机入口必须有效云登录加设备密钥证明。本例仍强制验证 TLS 证书；保留首次设置仅本机、跨 Origin（来源）拒绝，并补充本机缺失/错误 CSRF（跨站请求伪造防护）拒绝和合法退出失效。云会话 `Secure` / `HttpOnly` 正向保护由真实 TLS 手机云登录链路覆盖，不再由被禁止的远程密码路径产生 |
| `personal-access-account` 公开来源注册/密码登录 | 公开注册201/登录200发Secure Cookie → 403无Cookie；原完整资料/头像/改名/重启用例改直接本机注册 | 远程必须云登录；所有原资料字段、CSRF、跨账户与代际断言仍保留，HTTPS云Cookie正向由真实中继验证 |

| 两项 Electron（桌面程序框架）旧 API / CLI（命令行）兼容测试 | 默认打开窗口、等待 account.setup / device.add → 真实 headless（无窗口）宿主保留全部原 HTTP 授权/持久化断言 | 原用例没有操作窗口；新窗口自动建立本机资料，不再保持零账户。GUI（图形界面）免登、升级与同账户读取由新原生端到端测试单独验证；没有改断言或跳过旧用例 |
| 桌面动效测试 | 当前版定位“还没有账号？注册” → “注册账号”，历史 before（改动前）阶段保留旧名称 | 只跟随用户文案，保留原减少动态、键盘、时序和长列表断言 |

未删除测试、未加 skip（跳过）或放宽安全断言。新增本机来源/主frame边界、多账户和重启、登录仅在需要时、纯邮箱码/耗时枚举、声明缺失、历史pending重登、设备撤销与离线加密副本用例。
