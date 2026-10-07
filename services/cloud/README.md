# WeftMate Cloud · S1a

独立的 Node **24.x** ESM 服务。S1a 实现云账号、邮箱验证、密码找回、新云设备邮件确认和 OIDC；设计见 [CLOUD.md](../../docs/CLOUD.md)，接口见 [CLIENT_API.md 第 7 节](../../docs/CLIENT_API.md#7-云端账号s1a客户端接入在后续包)。**客户端与个人宿主接入在后续包**。不接收对话、记忆、健康或宿主密码，不实现宿主认领、内容授权、DPoP 或会话交换。

## 本地运行

只安装本服务锁定的依赖，不需要主仓 Electron/DSH：

```sh
cd services/cloud
npm ci
npm test
npm start
```

默认监听 `127.0.0.1:8787`，健康检查 `GET /healthz` 返回 `{"status":"ok","service":"weftmate-cloud","schemaVersion":2}`。Ctrl+C / SIGTERM 关闭 HTTP 和数据库。默认 issuer 为 `http://localhost:8787/personal/v1/cloud/oidc`，账号交互须通过这个 origin 访问。随机端口测试先分配端口再配置 issuer；`CLOUD_PORT=0` 只用于健康检查启动测试，账号登录须配置实际公开端口。

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

不要将数据/邮件目录指向现有个人资料、仓库根、系统或共享目录：服务将目录设为 0700。数据库、开发邮件和 `identity-keys/keys.json` 为 0600；入口 umask 0077，SQLite WAL/SHM 随之保持私有。Windows 本地还依赖系统 ACL。测试与服务开发均不使用日用数据。

## 账号与邮件

`cloudAccountId` 是随机 UUID、数据库禁止修改，也是 OIDC public `sub`。邮箱 trim、NFKC、ASCII 小写规范化，唯一且可经新邮箱验证码修改；不折叠加号或服务商特有点号。密码 15–128 个 Unicode code points；记录独立随机 32 字节盐、64 字节 verifier 和 `scrypt N=131072,r=8,p=1,maxmem=192MiB`。异步派生与宿主成本相同，独立记录；不存在的账号也做同成本派生。

注册只建 pending 账号，验证码通过才 active；重发不替换 pending 密码。验证码为随机六位、10 分钟、最多 5 次错误、单次使用，数据库只存由独立服务秘密生成的 HMAC。purpose、账号 epoch、新设备登录 interaction 都绑定在 challenge 中；找回/重发对不存在账号返回同形随机 challenge，实际不会发邮件。登录失败、验证码失败均按账号与来源持久限速；小时窗口内第 5 次失败起 1 秒指数退避，上限 1 小时。邮件请求同样按账号/来源限制，第 5 次后退避 10 分钟；不限制账号的设备总数。

每次授权要求密码交互，SSO Cookie 不能绕过当前设备确认。新标识或同标识下的新公钥均发确认邮件，确认后才产生授权码。设备公钥只登记公开 JWK，拒绝私钥字段。S1a 的标识/公钥来自调用方，此处没有设备私钥持有证明；不能当成宿主内容信任或 DPoP。

密码重置与换邮箱事务递增 `auth_epoch`，撤销该账号旧云会话、授权码、刷新族与 pending 验证码。已发 JWT 最多 5 分钟有效；本服务 `/account` 和邮箱变更接口还检查实时 epoch，因此重置立即拒绝旧 access token。本地宿主密码和数据不变。重置后尝试发送「密码已更改」；通知服务失败不回滚已提交的重置，响应 `notificationAccepted=false` 并记录无邮箱的操作错误。本包未实现通知补投递队列。

`createMailer(config).send({to,subject,text}) → {id}`：file 每封写独立 JSON 并 fsync，供查看验证码，**不会发送真实邮件**。Resend 固定 HTTPS API、10 秒超时、幂等请求标识，凭据与明确发件人缺任一项不可启用。返回 provider id 表示服务商接受，不保证送达。模板覆盖注册、找回、新设备确认、新邮箱验证、密码已更改。测试 Resend 使用注入 mock fetch，不连接服务商。[Resend API](https://resend.com/docs/api-reference/emails/send-email)

## OIDC、存储与密钥

锁定 `oidc-provider 9.12.2` 和 `jose 6.2.12`，自己的 package-lock；不手写 OAuth/JWT。Authorization Code + 强制 PKCE S256，授权码 60 秒、单次使用；访问/ID token 300 秒，访问 token 的 audience 仅 `<issuer origin>/personal/v1/cloud`。scope 为 `cloud:account`；JWT 不包含邮箱或内容。请求 `openid offline_access cloud:account` 且 `prompt=consent` 才有离线刷新；原生客户端须校验 state、ID token nonce/issuer/audience/RS256/exp，并将刷新凭据放系统凭据库。浏览器不把刷新凭据放 localStorage。[oidc-provider](https://github.com/panva/node-oidc-provider)、[jose](https://github.com/panva/jose)

刷新由 provider 管理，强制每次轮换、绝对族寿命 30 天。复用撤销整个授权族及后继刷新；SQLite 原子 consume 同时处理并发复用，防止两个有效后继。RS256 access token 自包含，刷新族撤销不会让外部离线 JWT 验证即时失效；剩余短 TTL 是明确边界。云账号 Cookie host-only、HttpOnly、SameSite=Lax，HTTPS 时 Secure；密码/验证码写入要求 issuer 同源 Origin；交互登录额外检查签名 Cookie、interaction 与 CSRF。token/revocation 为标准 form POST，可供无 Origin 的原生客户端使用；有 Origin 时仅允许云同源。

SQLite `node:sqlite`：WAL/FK/FULL 同步、连续 SQL 迁移；账号、验证码、设备、失败桶和 OIDC adapter 状态可重开。已应用迁移不可修改，版本/名称/校验和不符拒绝启动。001 保持原样，002 增加身份表；升级前备份，无自动向下迁移。短小控制面记录用同步 SQL，scrypt/密钥生成/文件和邮件异步，不写用户内容。

签名私钥与 Cookie/验证码 HMAC 秘密单独存 `identity-keys/keys.json`，随机生成、私有权限和原子持久化，不使用 provider 的开发共享密钥。维护轮换在**停服务**后、相同配置/专属数据目录运行：

```sh
node --env-file=.env src/rotate-keys.mjs
```

然后重启服务；新 `kid` 用于 access/ID token 签名，旧 JWKS 公钥保留至少 300 秒 + 60 秒时钟余量，再次加载时移除到期旧 key。轮换不改变 Cookie 秘密或刷新族。不可在旧进程仍签发 token 时运行轮换，否则旧 key 的保留时间会计算错误。密钥与数据库须分别做加密运维备份，不能提交或放进内容备份。

日志只有操作 ID、状态、固定路由标签、耗时和错误代码；不记录 URL/query/body/headers、邮箱、来源地址、token、验证码或邮件内容。`/healthz` 只代表 DB 可读，不代表邮件送达或宿主在线。没有审计框架、全局设备上限或宿主 token。

## 验证与未做项

```sh
node --test test/*.test.mjs
npm audit --audit-level=high
```

30 项使用临时目录、example.com 邮箱和随机回环端口：注册→验证→新设备确认→授权码/PKCE→登录/刷新→找回→新设备→重开；验证码过期/重放/错误上限，账号/来源/邮件限速，issuer/audience/算法/type/到期，刷新轮换/复用/并发，JWKS kid 轮换/旧 key 验签/重开，邮箱变更/唯一/ID 不可变，HTTPS Cookie、Origin/CSRF/redirect URI、通知失败、Resend mock 与原 S0 健康/迁移/权限/进程测试。输出实际 runner 的 scrypt 耗时，Linux CI 用相同测试。依赖缺失时测试 helper 通过互斥锁执行本服务 `npm ci --ignore-scripts`，适配既有 Linux cloud 步骤在主仓安装前直接调用 `node --test`；不在生产入口自动安装，不依赖主仓锁文件。

Mac Node 24.21.0 本地 30/30 通过，独立依赖审计 0 漏洞。[Linux Cloud foundation tests](https://github.com/memoweft/weftmate/actions/runs/37617343451/job/112778774483) 通过（同一套 30 项测试）；主仓后续检查另见 PR，不与 cloud 结果混算。

未做：五端客户端接入、宿主验签/认领/DPoP/会话交换/内容设备授权（S1b）、中继/推送/备份/共享；真实邮件投递、服务器/systemd/Caddy/DNS 部署。本包未连接服务器、未发真实邮件。部署文件仍是 [审查草稿](deploy/README.md)。
