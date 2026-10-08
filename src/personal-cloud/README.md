# 宿主云身份（S1b）

S1d / D29 新电脑无需先本地登录：App（应用）内账号流程完成后，带云控制面 token（令牌）与宿主 nonce/DPoP（设备密钥持有证明）调用直接回环 `/auth/cloud-desktop`，创建独立 owner 并自动认领/绑定。已有本地数据仍走下面的显式绑定；已有宿主的新 key 仍等待批准。自动绑定电脑 Cookie（会话凭据）可在直接地址管理绑定/展示二维码，普通手机云 Cookie 不可。可信 pin（证书公钥指纹）交付、可选应急密码和 LG-1 / LG-2 接线见 CLIENT_API 7.8；`trust.mjs` 要求调用者提供已受信设备通道取得的外部公钥锚，不允许云目录自举信任。

`index.mjs` 处理认领/绑定事务、内容设备信任、Cookie 交换和撤销；`proofs.mjs` 用 jose 验证固定 issuer/JWKS/RS256 access token 与 ES256 DPoP；`storage.mjs` 管理私有安装/TLS 密钥、版本 1 身份日志与迁移前备份。客户端接口见 `docs/CLIENT_API.md` 7.4。

宿主启用配置：`WEFTMATE_CLOUD_ISSUER=https://api.example.com/personal/v1/cloud/oidc`。Electron 与 `run-personal-host.mjs` 的子进程沿用此环境变量；未设置时本地认证不依赖云。工厂测试可显式提供 `cloudIdentity: { issuer, allowInsecureLoopback: true }`，HTTP 仅限回环；生产环境变量没有启用 HTTP 的开关。issuer、JWKS 与 audience 从此配置确定，令牌内的 jku/x5u 不参与配置。

## 认领与恢复

先用原本的本地账号 Cookie 登录电脑直接地址，再调用 `/cloud/claims` 与 `/cloud/binding`。云账号通过标准 Code+PKCE 登录得到短期控制面 access token；绑定 POST 本身是本地账号的批准，不能由云会话替代。尚无密码的 legacy 账号先使用原直接地址 setup grant；没有新增远程 setup。

第一次启用云模块时，在原 access store 迁移之前将根目录已有 store、sync、账号/健康、附件等复制到 `cloud-identity/backup/`，完成后原子写入 `backup-complete.json`。备份仅留本机私有目录，包含原本机数据和凭据，不进 Git、不上传。复制失败不进入云初始化；中断后重新复制，完成标记存在后不覆盖最初快照。

`cloud-identity/identity.json` 是原子写入的独立日志，保留原 `hostId`，分别生成安装 ES256 与内容 TLS EC 私钥。认领顺序为 pending claim → 云挑战 → 本地 pending `(issuer,sub,ownerId,hostId,claimId)` → 安装密钥签名/云幂等 membership → 本地 active。云确认后断网或关机，再以相同本地账号请求 claims 得到原 claimId，重新云登录并提交 binding 可续做；不将云 access/refresh token 持久化来自动重试。云 pending challenge 过期后相同 claimId 可取新挑战。激活时保存新鲜云证明的 epoch 基线，不等待首次轮询才拒绝绑定前的旧 epoch。已 active 的相同绑定也幂等。冲突返回 409，不建空内容账号、不改目录、密码、Cookie、同步/健康删除水位或记忆。

## 内容授权与会话

云为已登记宿主/member 签发 host:session resource token，要求 token endpoint DPoP key 与本次邮件确认的云设备公钥相同。宿主再次检查 host_id、scope、aud、JWT 类型/算法/期限，并验证 DPoP htm/htu/ath/iat/nonce/jti。nonce 与重放记录在身份日志中持久化，重启不能复用已成功提交的证明。

陌生设备仅形成本账号的 pending 请求，返回 202，没有 Cookie。原本已认证的本地 Cookie 或已批准云设备 Cookie 可查看并决定；绑定和创建当面配对挑战只允许电脑直接地址的本地密码会话。拒绝不自动重新排队；如需重新配对，由电脑重新授权一次性挑战。配对材料含宿主安装公钥与本机 TLS SPKI，S1c/S2 负责实际二维码展示、扫码和 TLS 适配器/原生 pin 接入；本包桌面最小界面提供待批准列表、允许/拒绝与打开应用时提示。

批准后的云会话仍是宿主生成的随机 `wm_personal_session` Cookie/CSRF，原 API 的账号、DSH 任务/审批和来源 epoch 语义一致。新增设备 authKind=cloud，authEpoch 使用原本地账号 epoch，云 auth_epoch 单独保存在身份日志；云事件不修改本地账号 authEpoch/密码。身份日志先记 session 引用，原 store 再保存 tokenHash：中断只留下无凭据的引用。交换忽略浏览器自动携带的旧 HttpOnly Cookie（包括已撤销 Cookie），只使用云 JWT/DPoP/本机信任；Cookie 本身不能批准交换。云未启用或日志缺失时 cloud 类型会话拒绝，原本地密码/legacy Bearer 照常。

## 撤销与离线

显式删除一个 cloud 会话设备会撤销同一账号/云 deviceId/公钥的本地内容信任，关闭其活跃内容响应，令全部相关宿主 Cookie 失效，并持久化云同步 outbox。logout 仅退出当前 Cookie，不撤销设备公钥。解绑撤销映射与云内容设备，保留账号/数据/本地登录；云 membership 删除带 claimId，旧 outbox 不会误删重新绑定的新 membership。

宿主启动后及每 60 秒用安装密钥签名主动取 `/cloud/hosts/revocations`，先提交 outbox；`syncCloudRevocations()` 可主动同步，`receiveCloudRevocations(eventToken)` 供后续通道交付。云密码重置/换邮箱的 epoch 和设备撤销事件均用固定云 key 签名，宿主检查 audience 与递增水位后持久化，并把失效会话在 access store 标为 revoked，使排队任务也不能再派给 DSH。epoch 撤销保留已批准公钥，新 epoch 的合法登录可重新换 Cookie；本地账号 Cookie 不受影响。云服务只存宿主公钥/member/最小撤销元数据，不接收本地 ownerId 或内容。

S2 中继/TLS 已在 `../personal-relay/` 实现，见 CLIENT_API 7.6；本模块继续负责身份。没有即时推送（S3）；在线轮询至多约一分钟加网络延迟，签名事件到达宿主后立即拒绝并关闭活跃流。云离线期间不能宣称收到最新撤权；仍有效的宿主 Cookie、本地密码与合法旧 Bearer 可直连，过期云 JWT 不延长。

## 验证

- `node --test tests/personal-cloud.test.ts`：隔离 JWT/JWKS/cloud HTTP 夹具，事务中断/重启、备份与非零 sync 水位、账号隔离、绑定批准、DPoP、配对期限/单用、原 DSH session 来源与 SSE 撤销/离线本地登录。
- `npm test --prefix services/cloud`：实际 OIDC provider/SQLite/开发 outbox，宿主认领、成员约束、设备 DPoP key、签名撤销与完整 cloud→host 流程。
- `node --test --test-name-pattern=S1b tests/personal-access-ui-interaction.test.ts`：应用启动提示、允许/拒绝 CSRF 写入、退出清除。

数据目录一律临时且规范化；不连服务器、不发送真实邮件、不部署。

S2 的 `/cloud/pairings` 响应增添 relay 状态/baseUrl；原 tlsSpki 与实际 TLS adapter 复用同一内容 key。云目录不提供可替代配对 pin 的信任。


## S1c-Web 登录接线

`GET /cloud/config` 公开固定 issuer/hostId/clientId，`GET /cloud/binding` 只读当前 Cookie 的绑定状态与直接地址管理资格。浏览器界面在 `../personal-access-ui/cloud-login.js` / `cloud-ui.js`；Android 的共享 JS 与系统浏览器桥见 `apps/mobile-ui/www/cloud-native.js` 和 `apps/android/.../CloudLogin.kt`。CLIENT_API 7.7 是正式契约。

宿主 `WEFTMATE_CLOUD_WEB_CLIENT_ID` 默认 weftmate-web。云端需预登记精确的直接地址/中继回调 `<origin>/personal/v1/ui/`，application_type=web；Android 另登记 weftmate-android 的 `com.memoweft.weftmate:/oauth`。没有注册回调的部署不能登录，不动态放开 origin。浏览器凭据只在等待内容批准期间保存 IndexedDB，交换宿主 Cookie 后删除，设备 CryptoKey 保留供下次证明。

`WEFTMATE_WEB_E2E=true node --test services/cloud/test/web-login.test.mjs` 使用真实 Chromium、file 邮件、隔离宿主与 SQLite 云验证绑定、等待/批准、二维码自动刷新/输入码、拒绝、解绑与本地会话保留。合成截图在忽略的 `.local/s1c-web/`；完整根测试只交 CI。
