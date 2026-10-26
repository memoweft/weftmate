# WeftMate Cloud · S1a–S2 / S1d

独立的 Node **24.x** ESM 服务。S1a 实现云账号、邮箱验证、密码找回、新云设备邮件确认和 OIDC；设计见 [CLOUD.md](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/CLOUD.md)，接口见 [CLIENT_API.md 第 7 节](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/CLIENT_API.md#7-云端账号s1a客户端接入在后续包)。S1b 已接宿主认领、安装签名与设备撤权；S2 已接官方 frp 授权与 TLS 透传。五端完整客户端在 S1c。不接收对话、记忆、健康或宿主密码。

## 本地运行

只安装本服务锁定的依赖，不需要主仓 Electron/DSH：

```sh
cd services/cloud
npm ci
npm test
npm start
```

默认监听 `127.0.0.1:8787`，健康检查 `GET /healthz` 返回 `{"status":"ok","service":"weftmate-cloud","schemaVersion":10,"capabilities":{"cloudBackup":1,"offlineTasks":1}}`。Ctrl+C / SIGTERM 关闭中继入口、HTTP 和数据库。默认 issuer 为 `http://localhost:8787/personal/v1/cloud/oidc`，账号交互须通过这个 origin 访问。随机端口测试先分配端口再配置 issuer；`CLOUD_PORT=0` 只用于健康检查启动测试，账号登录须配置实际公开端口。

配置只读环境变量，不自动加载 `.env`。可复制 `.env.example` 到被忽略的 `.env`，使用 `node --env-file=.env src/main.mjs`。没有登记客户端时仍可注册/验证，但不能开始 OIDC 授权；不会默认开放生产 redirect URI。

| 变量 | 默认 / 含义 |
|---|---|
| `CLOUD_HOST` / `CLOUD_PORT` | `127.0.0.1` / `8787`；端口 0–65535 |
| `CLOUD_DATA_DIR` | `.runtime`，本服务专属数据目录；相对工作目录解析 |
| `CLOUD_ISSUER` | `http://localhost:<port>/personal/v1/cloud/oidc`；正式环境必须 HTTPS，HTTP 仅允许 loopback；路径固定，无 query/fragment/userinfo |
| `CLOUD_OIDC_CLIENTS` | `[]`；JSON 数组，每项仅 `client_id` 与 `redirect_uris`。公开原生客户端，`token_endpoint_auth_method=none`、public subject、RS256、code/refresh grants；不接受 client secret。示例：`[{"client_id":"example-native","redirect_uris":["com.example.weftmate:/callback"]}]` |
| `CLOUD_TRUST_PROXY` | `false`；只在 Node 仅监听回环且反向代理覆盖转发头时启用 `true`。仅来自 loopback 的代理头可信；来源限速读取单个合法 `X-Forwarded-For` IP，Host/forwarded Host 必须匹配 issuer |
| `CLOUD_MAIL_TRANSPORT` | `file` 或 `resend`；其他值启动失败 |
| `CLOUD_MAIL_FROM` | `WeftMate <no-reply@example.com>`；Resend 必须显式配置 |
| `CLOUD_MAIL_DIR` | `<CLOUD_DATA_DIR>/mail-outbox`；显式相对路径按工作目录解析 |
| `CLOUD_RESEND_API_KEY` | 无默认值；Resend 必填，仅放运行环境，不进 Git |
| `CLOUD_BACKUP_ACCOUNT_BYTES` | `314572800`（300 MiB，每账号），完整备份加待传整包预留的上限 |
| `CLOUD_BACKUP_GLOBAL_BYTES` | `6442450944`（6 GiB，全站），所有账号完整备份加待传预留的总上限 |

不要将数据/邮件目录指向现有个人资料、仓库根、系统或共享目录：服务将目录设为 0700。数据库、开发邮件和 `identity-keys/keys.json` 为 0600；入口 umask 0077，SQLite WAL/SHM 随之保持私有。Windows 本地还依赖系统 ACL。测试与服务开发均不使用日用数据。

## 账号与邮件

`cloudAccountId` 是随机 UUID、数据库禁止修改，也是 OIDC public `sub`。邮箱 trim、NFKC、ASCII 小写规范化，唯一且可经新邮箱验证码修改；不折叠加号或服务商特有点号。密码 15–128 个 Unicode code points；记录独立随机 32 字节盐、64 字节 verifier 和 `scrypt N=131072,r=8,p=1,maxmem=192MiB`。异步派生与宿主成本相同，独立记录；不存在的账号也做同成本派生。

注册只建 pending 账号，验证码通过才 active；重发不替换 pending 密码。验证码为随机六位、10 分钟、最多 5 次错误、单次使用，数据库只存由独立服务秘密生成的 HMAC。purpose、账号 epoch、新设备登录 interaction 都绑定在 challenge 中；找回/重发对不存在账号返回同形随机 challenge，实际不会发邮件。登录失败、验证码失败均按账号与来源持久限速；小时窗口内第 5 次失败起 1 秒指数退避，上限 1 小时。邮件请求同样按账号/来源限制，第 5 次后退避 10 分钟；不限制账号的设备总数。

每次授权可用邮箱与密码，或邮箱与验证码。SSO Cookie（单点登录会话信息）不能绕过当前设备确认。密码登录的新标识或同标识下的新公钥均发确认邮件，确认后才产生授权码；已经核对过的同一标识与公钥只需密码。纯验证码登录本身完成邮箱与设备核对。设备公钥只登记公开 JWK（JSON Web Key，JSON 密钥格式），拒绝私钥字段。旧 S1a 无持钥证明的路径仍只可用于云账号；App 登录、宿主资源与内容交换继续要求 DPoP（设备密钥持有证明）。

### AUTH-1 登录与发布兼容

新增 `POST /personal/v1/cloud/auth/login/code/request` 与 `/confirm`。request（请求）先验证现有 OIDC（开放身份连接）interaction（登录交互）、Cookie 与 CSRF（跨站请求伪造防护），App 模式还必须匹配启动交互时登记的 `deviceId / publicJwk`。请求体为 `{interactionUid,csrfToken,email,deviceId,publicJwk,deviceName?,deviceType?}`，统一返回 HTTP 202 `{confirmationRequired:true,challengeId,expiresIn:600}`。未注册或未激活邮箱不发信；邮件投递故障也返回同形响应，不能借此查询账号是否存在。真实账号的发信在后台进行，响应不等待邮件商；避免只有已注册账号暴露投递耗时。服务关闭会等待自己仍在发送的邮件，再关闭数据库；发送失败消费对应验证码。confirm 的请求体为 `{interactionUid,csrfToken,challengeId,code}`；成功与密码流程相同，返回 `{account,resumeUrl}`，后续继续走 provider（身份协议实现）的授权码、PKCE（授权码校验）与 DPoP 交换。错码、过期、次数耗尽或交互失效统一返回 HTTP 400 `INVALID_LOGIN_CODE`；限速返回 HTTP 429 `RATE_LIMITED` 与 `Retry-After`。

登录码仍只存 HMAC（基于散列的消息认证码），六位随机数字、十分钟有效、五次错误上限、单次使用；账号与来源的验证退避、发送次数限制沿用持久限速器，假邮箱请求也消耗同样的发送限额。验证码上下文同时绑定账号 epoch（认证代次）、交互 UID（唯一标识）与具体设备标识及公钥。换密码、换邮箱、退出其它设备及注销账号会撤销或消费待用验证码；纯验证码登录不会绕过这些撤销。

每一个 access token（访问令牌），包括云账号、宿主 audience（目标服务）和 refresh（刷新）产生的令牌，签入 `device_verified:true`。签发前实时核对 `cloud_devices.confirmed_at`、账号 epoch 和 DPoP 公钥；这条声明来自云端完成的邮箱核对，客户端输入同名字段不参与签发。宿主必须拒绝缺失或非 `true` 的声明。`/hosts/connect` 对已云核对且有 membership（宿主成员资格）的设备返回 `approval:'trusted',pairingRequired:false`，不再引导另一台设备允许；历史 `revoked / denied` 仍拒绝。内容实际读取仍由宿主完成，保留绑定、撤销、nonce（单次随机挑战）、DPoP、重放检查和设备会话校验。设备目录增加 `firstUsedAt`，保留 `lastUsedAt`。

数据库仍为 schema（存储结构）8，无新增迁移、无历史数据批量改写。现有 `cloud_devices` 只在邮箱核对后写入，已确认设备可据此签新声明；旧注册流程刚完成的邮箱核对也可绑定本次交互的公钥。新登录码复用现有 `email_challenges` 的 `device` purpose（用途），上下文新增 `authMethod:'email'`；旧版云服务仍能读取这一用途，回滚不需降版本或数据迁移。原路由继续保留，旧客户端可使用密码与新设备邮箱确认流程，原 token 的五分钟寿命及旧刷新族保持原协议。

上线顺序必须先云端，再宿主与客户端。先云端后，旧客户端忽略新增声明，行为保持兼容；新宿主收到升级前旧 token 时明确提示重新登录，也可通过原刷新族换得有声明的新 token。若先升级宿主，旧云端无法签声明，远程登录会被安全拒绝；本机免登录使用由宿主原生窗口独立提供。云端回滚后新版宿主继续拒绝不含声明的登录，不会降级放行。AUTH-1 不部署、不连接线上服务器、不发送真实邮箱；新测试只使用本机随机端口、临时数据库与 file（文件）邮件夹具。

密码重置与换邮箱事务递增 `auth_epoch`，撤销该账号旧云会话、授权码、刷新族与 pending 验证码。已发 JWT 最多 5 分钟有效；本服务 `/account` 和邮箱变更接口还检查实时 epoch，因此重置立即拒绝旧 access token。本地宿主密码和数据不变。重置后尝试发送「密码已更改」；通知服务失败不回滚已提交的重置，响应 `notificationAccepted=false` 并记录无邮箱的操作错误。本包未实现通知补投递队列。

`createMailer(config).send({to,subject,text,html?,accountId?}) → {id}`：file（文件传输）每封写独立 JSON（结构化消息）并 fsync（同步落盘），包括可选 `html`，供查看验证码，**不会发送真实邮件**。Resend 固定 HTTPS API（加密发信接口）、10 秒超时、幂等请求标识，凭据与明确发件人缺任一项不可启用。`html` 必须为字符串，最多 65,536 UTF-8（字符编码）字节，发送和落盘前校验；未提供时继续只发 `text`。返回 provider id（服务商标识）表示服务商接受，不保证送达。测试 Resend 使用注入 mock fetch（模拟请求），不连接服务商。[Resend API](https://resend.com/docs/api-reference/emails/send-email)

六种邮件（注册邮箱、找回密码、新设备登录、新邮箱验证、密码已更改、邮箱已更改）共用表格卡片，同时提供 `subject / text / html`。四种验证码邮件的纯文字布局保持原样，包含 `验证码：<六位连续数字>`；网页邮件只在一个文本节点显示六位数字，以字距拉开，便于整串复制。验证码只接受六位 ASCII（基础字符集）数字；所有动态值在进入 HTML（网页邮件）时转义。主题与隐藏预览只说明用途，不包含验证码、邮箱或账号标识；设备确认保留设备标识和内容权限需另行配对的说明。通知邮件不虚构支持联系方式。

颜色、字号、间距、圆角、字体从桌面 `tokens.css` 和 `design/tokens/tokens.json` 生成独立的 `src/mail-tokens.mjs`；品牌 PNG（位图）由现有 `src/personal-access-ui/favicon.svg` 转换，原图形不变。开发时在主仓运行 `node services/cloud/scripts/build-mail-assets.mjs` 即可重新生成，使用主仓已有 Playwright（浏览器自动化），云服务运行时不依赖它或桌面源码，也没有新增依赖。

标识选用本云域名的固定图片 `https://api.weftmate.com/assets/mail/weftmate-mark.png`。服务提供这一精确 GET / HEAD（读取／仅头部）资源，使用 PNG 类型、128×128 像素、公共缓存、无 Cookie（会话信息）、无参数、无收件人级访问记录；未开放目录遍历或通用文件服务。相较 CID（邮件附件引用），普通 HTTPS PNG 更适合 Gmail、Outlook、Apple Mail（苹果邮件）、QQ 和 163 的网页／手机邮箱；CID 虽可离线显示，但服务商也明确提示部分网页邮箱会拒绝。固定资源会多一次可缓存的图片读取，所有邮件共享同一地址，不能用来识别一封信或收件人。图片被拦截时，56×56 的显式宽高、替代文字与独立标题保持版式。[Resend 内嵌图片说明](https://resend.com/docs/dashboard/emails/embed-inline-images)、[Gmail 图片设置](https://support.google.com/mail/answer/145919)、[Outlook 图片拦截说明](https://support.microsoft.com/en-us/outlook/block-or-unblock-automatic-picture-downloads-in-classic-outlook-email-messages)

版式以表格和行内样式为基础；`<style>` 仅含深色与窄屏媒体查询，无外链样式、网页字体、脚本、表单、背景图、跟踪像素或第三方资源。不支持媒体查询的客户端保持完整浅色；支持 `prefers-color-scheme: dark`（跟随系统深色）时同时改变画布、卡片、文字和分隔线。未声明全局自动深色，避免只改变部分区域。经典 Outlook 使用条件表格固定最大阅读宽度，可能将圆角退化为直角。客户端强制反色、图片策略及预览提取由客户端控制，本包不声称浏览器截图等于实际送达验收。

上线无需新增配置项或数据库迁移：按现有发布方式包含整个 `services/cloud/`（特别是 `assets/weftmate-mark.png` 与 `src/mail-tokens.mjs`），重启云服务即可；现有 nginx（反向代理）`location /` 会转发固定图片，不需修改它。上线后由本人授权验证固定图片和六种真实邮箱送达；MAIL-1 未连接服务器、未发真实邮件。完整合成截图、六种文案、选区／剪贴板断言和兼容性限制见 [邮件证据](https://github.com/memoweft/weftmate/blob/85321e89888552fb25abe95b0fc8d61f62f2ef5f/tests/evidence/mail-1/README.md)。

## OIDC、存储与密钥

S1d / D29 的 App（应用）内完整账号页、设备目录/连接和受信 pin（证书公钥指纹）交付见 [CLIENT_API 7.8](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/CLIENT_API.md#78-app-内账号与设置设备s1d--d29) 与 [CLOUD 第 14 节](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/CLOUD.md#14-s1d-app-内账号与设置设备d29)。`/auth/authorization` / resume 封装 provider 标准授权交互，不导航外部网页；新 App grant 强制 P-256 DPoP（设备密钥持有证明）。以下 S1a/S1c 表述为兼容路径。独立相关验证：`node --test test/app-devices.test.mjs test/identity.test.mjs test/hosts.test.mjs`；新 test 含真实 main 进程、file 邮件与隔离宿主闭环，数据只在系统临时目录。

锁定 `oidc-provider 9.12.2` 和 `jose 6.2.12`，自己的 package-lock；不手写 OAuth/JWT。Authorization Code + 强制 PKCE S256，授权码 60 秒、单次使用；访问/ID token 300 秒，访问 token 的 audience 仅 `<issuer origin>/personal/v1/cloud`。scope 为 `cloud:account`；JWT 不包含邮箱或内容。请求 `openid offline_access cloud:account` 且 `prompt=consent` 才有离线刷新；原生客户端须校验 state、ID token nonce/issuer/audience/RS256/exp，并将刷新凭据放系统凭据库。浏览器不把刷新凭据放 localStorage。[oidc-provider](https://github.com/panva/node-oidc-provider)、[jose](https://github.com/panva/jose)

刷新由 provider 管理，强制每次轮换、绝对族寿命 30 天。复用撤销整个授权族及后继刷新；SQLite 原子 consume 同时处理并发复用，防止两个有效后继。RS256 access token 自包含，刷新族撤销不会让外部离线 JWT 验证即时失效；剩余短 TTL 是明确边界。云账号 Cookie host-only、HttpOnly、开发回环 SameSite=Lax，HTTPS 时 Secure/SameSite=None（供 App 内跨 origin 交互）；密码/验证码写入要求 issuer 或预登记回调 Origin；交互登录额外检查签名 Cookie、interaction 与 CSRF。token/revocation 为标准 form POST，可供无 Origin 的原生客户端使用；有 Origin 时仅允许云自身或预登记回调 origin。

SQLite `node:sqlite`：WAL/FK/FULL 同步、连续 SQL 迁移；账号、验证码、设备、失败桶和 OIDC adapter 状态可重开。已应用迁移不可修改，版本/名称/校验和不符拒绝启动。001 保持原样，002 增加身份表；升级前备份，无自动向下迁移。短小控制面记录用同步 SQL，scrypt/密钥生成/文件和邮件异步，不写用户内容。

签名私钥与 Cookie/验证码 HMAC 秘密单独存 `identity-keys/keys.json`，随机生成、私有权限和原子持久化，不使用 provider 的开发共享密钥。维护轮换在**停服务**后、相同配置/专属数据目录运行：

```sh
node --env-file=.env src/rotate-keys.mjs
```

然后重启服务；新 `kid` 用于 access/ID token 签名，旧 JWKS 公钥保留至少 300 秒 + 60 秒时钟余量，再次加载时移除到期旧 key。轮换不改变 Cookie 秘密或刷新族。不可在旧进程仍签发 token 时运行轮换，否则旧 key 的保留时间会计算错误。密钥与数据库须分别做加密运维备份，不能提交或放进内容备份。

日志只有操作 ID、状态、固定路由标签、耗时和错误代码；不记录 URL/query/body/headers、邮箱、来源地址、token、验证码或邮件内容。`/healthz` 只代表 DB 可读，不代表邮件送达或宿主在线。没有审计框架或全局设备上限；S1b 的宿主 resource token 与 S2 中继凭据见 CLIENT_API。

## 验证与未做项

```sh
node --test test/*.test.mjs
npm audit --audit-level=high
```

30 项使用临时目录、example.com 邮箱和随机回环端口：注册→验证→新设备确认→授权码/PKCE→登录/刷新→找回→新设备→重开；验证码过期/重放/错误上限，账号/来源/邮件限速，issuer/audience/算法/type/到期，刷新轮换/复用/并发，JWKS kid 轮换/旧 key 验签/重开，邮箱变更/唯一/ID 不可变，HTTPS Cookie、Origin/CSRF/redirect URI、通知失败、Resend mock 与原 S0 健康/迁移/权限/进程测试。输出实际 runner 的 scrypt 耗时，Linux CI 用相同测试。依赖缺失时测试 helper 通过互斥锁执行本服务 `npm ci --ignore-scripts`，适配既有 Linux cloud 步骤在主仓安装前直接调用 `node --test`；不在生产入口自动安装，不依赖主仓锁文件。

Mac Node 24.21.0 本地 30/30 通过，独立依赖审计 0 漏洞。[Linux Cloud foundation tests](https://github.com/memoweft/weftmate/actions/runs/37617343451/job/112778774483) 通过（同一套 30 项测试）；主仓后续检查另见 PR，不与 cloud 结果混算。

未做：五端完整客户端接入（S1c）、推送/备份/共享；真实邮件投递、服务器/systemd/Caddy/DNS 部署。本包未连接服务器、未发真实邮件。部署文件仍是 [审查草稿](deploy/README.md)。

## S1b 宿主身份配合

迁移 003 增加宿主安装公钥、认领挑战、membership 与最小撤销事件；`src/hosts.mjs` 处理安装签名与签名事件 feed。OIDC host resource 只为已认领成员签发，token endpoint DPoP key 必须匹配邮件已确认设备公钥；无内容授权自动继承。宿主实现/隔离测试见 `../../src/personal-cloud/README.md`，正式接口见 CLIENT_API 7.4–7.5。云密码/邮箱 epoch 更新在同一 SQLite 事务产生撤销事件；宿主离线不宣称已收到。

## S2 中继配合

`CLOUD_RELAY_DOMAIN=hosts.example.com` 启用 S2，`CLOUD_RELAY_SERVER_NAME=relay.example.com` 固定 frpc 传输 SNI。默认回环端口：frps 7000 / HTTPS mux 7443，云 control/content ingress 7001/7444，plugin 8788；可用 deploy/cloud.env.example 的五项端口覆盖，端口必须彼此不同。HAProxy 才监听公网 443。未配置 domain 时不开中继端口，不影响 S1。

迁移 004 保存随机域名、独立 credential generation 与撤销状态，不保存内容。Plugin 单独回环 listener，接受 Login/NewProxy/Ping/NewWorkConn/NewUserConn，仅批准已认领宿主自己的 HTTPS 域名。云拥有 mandatory TCP ingress，用官方插件报告的地址关联控制/内容 socket，撤销或轮换立即关闭已存在连接；frps 官方管理 API 不能踢在线 client，不能把拒绝 Ping 当成立即关闭。见 CLOUD 3 与 CLIENT_API 7.6。

真实 DNS 在部署包接 `createIdentity({relayDns:{present,cleanup}})`；宿主安装签名只允许自己 `_acme-challenge` 的 TXT 值，不接受指定记录名/类型/zone，默认 DNS_NOT_CONFIGURED。安装证书、私钥与 DNS key 不进 Git。

`npm test` 当前常规 cloud 测试 36/36（全链路 E2E 默认显式跳过）；`.github/workflows/relay.yml` 下载已校验的官方 frp，单独跑实际 TCP 443 全链路，不使用用户运行数据。Mac 相同链路在 18443 通过，示例域名全部用 --resolve / 测试连接地址覆盖；见 `../../src/personal-relay/README.md`。

S3a：schema（存储结构）8 新增 `push_registrations`，当前 DPoP（设备持钥证明）身份绑定登记 / 轮换 / 撤销，设备撤销与账号注销级联删除。`/personal/v1/cloud/auth/push/registration` 响应不回显令牌；共享 PushProvider（推送提供方接口）当前明确未配置。未来派发只接受 `{eventId,type}`，不向云或提供方传正文；方法和接线见 CLIENT_API 9.8.2。生产升级需运行现有迁移流程，未部署。

S7：schema（存储结构）9 新增 `009-offline-tasks.sql`，不改变旧表字段与既有客户端响应。启动时原迁移账本只应用一次，反复启动保持相同迁移校验；升级需发布此服务源码与迁移文件并重启服务，不新增环境配置。迁移不能从 9 降回 8；回退服务代码时保留迁移文件与账本兼容，部署由编排安排，本包未连接或部署生产。

| POST `/personal/v1/cloud/hosts/offline/tasks/…` | 认证与请求 | 响应 |
|---|---|---|
| `submit` | 原 DPoP 已批准成员设备；`{hostId,id,generation,envelope}`，信封格式与 CLIENT_API 3.19 相同；随机任务 ID、64 KiB 信封、每账号100件尚未终结事项、默认7天 | `{id,hostId,createdAt,expiresAt,state:"waiting"}`，相同密文重试幂等 |
| `list` | 同设备；`{hostId}` | `{items:[{id,hostId,createdAt,expiresAt,state}]}`，无正文 |
| `cancel` | 同设备；`{hostId,id}` | 同条状态；云正文密文立即置空；已确认领取409 `TASK_ALREADY_RECEIVED` |
| `clear` | 同设备；`{}` | `{deleted:true}`，删除此账户当前物理设备的全部事项 |
| `claim` | 原宿主安装签名 `{hostId,proof}`，proof 的 `action` 为完整路径 | `{items:[{id,claimId,accountId,deviceId,jkt,generation,hostId,createdAt,expiresAt,state,envelope}]}`，按序最多20件，30秒租期 |
| `ack` | 安装签名载荷 `{action,id,claimId,receiptId}`，只绑定目标电脑 | `{accepted:boolean}`；成功删密文、保留回执，取消／过期胜出则false |
| `result` | 安装签名 `{action,id,receiptId,state:"started"\|"completed"\|"failed"}` | `{accepted:boolean}`，只发最小事件身份推送，不接收通知正文 |

任务接口每账户120次／分钟，安装每电脑600次／分钟；越限429 `RATE_LIMITED`。过期自动置空正文密文，领取回执保留到执行终结，最小终态7天后删除；授权／代次变更及账户／设备外键删除会立即删记录。服务日志只保留原操作字段；所有非法请求错误只返回固定代码，不能回显请求体。安全边界、原生接线与故障恢复详见 `docs/M3_OFFLINE.md` 的 S7 节。

S7兼容能力：已有 /hosts/offline/status 与 /hosts/offline/publish 回执、签名 /hosts/revocations 事件令牌兼容增加 capabilities.offlineTasks:1。旧云没有字段，新客户端不显示或请求任务功能；刷新重新判定，没有404探测或永久负缓存。

S4：结构 10 的 `010-cloud-backups.sql` 只增加云备份密文、包裹后的主钥匙、清单及配额表。精确 POST（提交）路由 `/personal/v1/cloud/backups/{key/read,key/write,start,chunk/upload,complete,list,chunk/download,delete,clear}` 使用现有 DPoP（设备持钥证明），或绑定到已登录账号成员资格的宿主安装签名；后者签名 `sub`（账号标识）和精确 `action`（请求路径），拒绝重放。`key/read {password}` 可沿现有云密码核对授权本机敏感查看，服务仍没有恢复码或解密钥匙。其他请求仅最少传输状态与密文；每块 1 MiB 加 16 字节，最多 512 块，一份待传、最近三份完整备份；7 天未完成上传自动清除。整包先预留额度，完成时按序核对密文哈希，重试返回已收索引。全部删除与账号注销核对清单、块、包裹钥匙和额度均为零。能力 `capabilities.cloudBackup:1` 加到健康检查与原签名控制回执；旧云客户端不探测新接口。完整设计／接口见 [CLOUD_BACKUP.md](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/CLOUD_BACKUP.md)，部署与回退见 [deploy/README.md](deploy/README.md#s4-云端加密备份上线尚未部署)。
