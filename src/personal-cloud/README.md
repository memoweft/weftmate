# 宿主云身份（S1b）

`index.mjs` 处理认领/绑定事务、内容设备信任、Cookie 交换和撤销；`proofs.mjs` 用 jose 验证固定 issuer/JWKS/RS256 access token 与 ES256 DPoP；`storage.mjs` 管理私有安装/TLS 密钥、版本 1 身份日志与迁移前备份。客户端接口见 `docs/CLIENT_API.md` 7.4。

宿主启用配置：`WEFTMATE_CLOUD_ISSUER=https://api.example.com/personal/v1/cloud/oidc`。Electron 与 `run-personal-host.mjs` 的子进程沿用此环境变量；未设置时本地认证不依赖云。工厂测试可显式提供 `cloudIdentity: { issuer, allowInsecureLoopback: true }`，HTTP 仅限回环；生产环境变量没有启用 HTTP 的开关。issuer、JWKS 与 audience 从此配置确定，令牌内的 jku/x5u 不参与配置。

## 认领与恢复

先用原本的本地账号 Cookie 登录电脑直接地址，再调用 `/cloud/claims` 与 `/cloud/binding`。云账号通过标准 Code+PKCE 登录得到短期控制面 access token；绑定 POST 本身是本地账号的批准，不能由云会话替代。尚无密码的 legacy 账号先使用原直接地址 setup grant；没有新增远程 setup。

第一次启用云模块时，在原 access store 迁移之前将根目录已有 store、sync、账号/健康、附件等复制到 `cloud-identity/backup/`，完成后原子写入 `backup-complete.json`。备份仅留本机私有目录，包含原本机数据和凭据，不进 Git、不上传。复制失败不进入云初始化；中断后重新复制，完成标记存在后不覆盖最初快照。

`cloud-identity/identity.json` 是原子写入的独立日志，保留原 `hostId`，分别生成安装 ES256 与内容 TLS EC 私钥。认领顺序为 pending claim → 云挑战 → 本地 pending `(issuer,sub,ownerId,hostId,claimId)` → 安装密钥签名/云幂等 membership → 本地 active。云确认后断网或关机，再以相同本地账号请求 claims 得到原 claimId，重新云登录并提交 binding 可续做；不将云 access/refresh token 持久化来自动重试。云 pending challenge 过期后相同 claimId 可取新挑战。已 active 的相同绑定也幂等。冲突返回 409，不建空内容账号、不改目录、密码、Cookie、同步/健康删除水位或记忆。

## 内容授权与会话

云为已登记宿主/member 签发 host:session resource token，要求 token endpoint DPoP key 与本次邮件确认的云设备公钥相同。宿主再次检查 host_id、scope、aud、JWT 类型/算法/期限，并验证 DPoP htm/htu/ath/iat/nonce/jti。nonce 与重放记录在身份日志中持久化，重启不能复用已成功提交的证明。

陌生设备仅形成本账号的 pending 请求，返回 202，没有 Cookie。原本已认证的本地 Cookie 或已批准云设备 Cookie 可查看并决定；绑定和创建当面配对挑战只允许电脑直接地址的本地密码会话。拒绝不自动重新排队；如需重新配对，由电脑重新授权一次性挑战。配对材料含宿主安装公钥与本机 TLS SPKI，S1c/S2 负责实际二维码展示、扫码和 TLS 适配器/原生 pin 接入；本包桌面最小界面提供待批准列表、允许/拒绝与打开应用时提示。

批准后的云会话仍是宿主生成的随机 `wm_personal_session` Cookie/CSRF，原 API 的账号、DSH 任务/审批和来源 epoch 语义一致。新增设备 authKind=cloud，authEpoch 使用原本地账号 epoch，云 auth_epoch 单独保存在身份日志；云事件不修改本地账号 authEpoch/密码。身份日志先记 session 引用，原 store 再保存 tokenHash：中断只留下无凭据的引用。云未启用或日志缺失时 cloud 类型会话拒绝，原本地密码/legacy Bearer 照常。

## 撤销与离线

显式删除一个 cloud 会话设备会撤销同一账号/云 deviceId/公钥的本地内容信任，关闭其活跃内容响应，令全部相关宿主 Cookie 失效，并持久化云同步 outbox。logout 仅退出当前 Cookie，不撤销设备公钥。解绑撤销映射与云内容设备，保留账号/数据/本地登录；云 membership 删除带 claimId，旧 outbox 不会误删重新绑定的新 membership。

宿主启动后及每 60 秒用安装密钥签名主动取 `/cloud/hosts/revocations`，先提交 outbox；`syncCloudRevocations()` 可主动同步，`receiveCloudRevocations(eventToken)` 供后续通道交付。云密码重置/换邮箱的 epoch 和设备撤销事件均用固定云 key 签名，宿主检查 audience 与递增水位后持久化，并把失效会话在 access store 标为 revoked，使排队任务也不能再派给 DSH。epoch 撤销保留已批准公钥，新 epoch 的合法登录可重新换 Cookie；本地账号 Cookie 不受影响。云服务只存宿主公钥/member/最小撤销元数据，不接收本地 ownerId 或内容。

没有即时推送（S3）和中继（S2）；在线轮询至多约一分钟加网络延迟，签名事件到达宿主后立即拒绝并关闭活跃流。云离线期间不能宣称收到最新撤权；仍有效的宿主 Cookie、本地密码与合法旧 Bearer 可直连，过期云 JWT 不延长。

## 验证

- `node --test tests/personal-cloud.test.ts`：隔离 JWT/JWKS/cloud HTTP 夹具，事务中断/重启、备份与非零 sync 水位、账号隔离、绑定批准、DPoP、配对期限/单用、原 DSH session 来源与 SSE 撤销/离线本地登录。
- `npm test --prefix services/cloud`：实际 OIDC provider/SQLite/开发 outbox，宿主认领、成员约束、设备 DPoP key、签名撤销与完整 cloud→host 流程。
- `node --test --test-name-pattern=S1b tests/personal-access-ui-interaction.test.ts`：应用启动提示、允许/拒绝 CSRF 写入、退出清除。

数据目录一律临时且规范化；不连服务器、不发送真实邮件、不部署。
