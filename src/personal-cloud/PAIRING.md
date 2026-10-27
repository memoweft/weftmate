# 电脑确认配对 v2

仅规定电脑宿主、二维码与手机的交接；手机核对页面另包实现。**从电脑生成有效配对起，该账号尚未获宿主信任的新设备就不能通过普通 `/auth/cloud-session`、`/auth/cloud-channel` 抢先拿会话；已受信设备保持可用。一旦设备提交配对，该云设备号的限制持久保留，换密钥不能绕过**。提交后取消、过期，只有新一轮成功配对才能解除限制。无活跃配对且未提交过配对的普通已验证云登录沿用原规则，已有会话不因此被撤销。

六位数是 SAS（短认证串），不是验证码或授权凭据。人必须看两块屏幕，在电脑确认；不一致就取消。双方贡献都锁定后才显示六位数，扫码前显示“扫码后显示”。单纯对公开随机数截哈希会让中间人离线试凑；这里先承诺再公开，锁定每次唯一的双方贡献，参考 [RFC 6189 §4.4.1.1 的哈希承诺原则](https://www.rfc-editor.org/rfc/rfc6189.html#section-4.4.1.1)，不是声称实现 ZRTP（媒体密钥协商协议）。六位空间约一百万种，仍有碰撞概率，不能宣称任意篡改必定不同。

## 字段与编码

`POST /personal/v1/cloud/pairings {}` 需要当前账号的直接本地密码或原生桌面会话、来源检查及 CSRF。账号必须已激活云绑定。返回 `201`：`version:2, issuer, sub, hostId, challenge, tlsSpki, publicJwk, origin, relay, expiresAt, expiresIn:120, hostCommitment`。`challenge`、电脑秘密 `hostNonce`、手机秘密 `phoneNonce` 均为密码学随机 32 字节，编码为无填充 base64url（URL 安全 Base64）；`hostNonce` 不进入二维码。

二维码保留现有 `wm1.` + base64url(UTF8(JSON)) 的连接码格式。手机必须先检查 `version === 2`，`issuer` 等于配置的签发方，`sub` 等于自己已验证的云账号，`hostId` 等于目标电脑；校验证书指纹、公钥、来源/中继及有效期。`origin` 可以是电脑自身的 HTTP 环回地址，这是进入承诺和 SAS 的电脑元数据，**不能把手机自己的 127.0.0.1 当作电脑请求目标**；手机实际请求采用已校验的 HTTPS 中继/连接地址，并保持对二维码中的证书和公钥的核对。实际 HTTP 传输只用于合成环回测试。**手机从这些独立核实的字段重建下面的数组，不能接受服务端提供的核对数字，也不能只信一份未校验的数组。**

`H(x)` = SHA-256(UTF8(JSON.stringify(x)))，JSON 数组无空格，字符串不转义非 ASCII 字符；数组元素顺序固定。`JKT(key)` 按 RFC 7638（公钥指纹）计算，P-256 公钥序列化顺序为 `{"crv":"P-256","kty":"EC","x":...,"y":...}`，散列编码为无填充 base64url。

```text
T = [2, issuer, sub, hostId, tlsSpki, JKT(publicJwk),
     challenge, expiresAt, origin, relay?.baseUrl || ""]
hostCommitment = base64url(H(["wm-pair-host-v2", ...T, hostNonce]))
phoneCommitment = base64url(H(["wm-pair-phone-v2", challenge, deviceId, phoneJkt, phoneNonce]))
D = H(["wm-pair-sas-v2", ...T, hostNonce, deviceId, phoneJkt, phoneNonce])
verificationCode = decimal(uint32_big_endian(D[0..3]) % 1000000).padStart(6, "0")
```

`expiresAt` 是整数 Unix 毫秒，从生成起严格 120 秒，不续期。手机 `deviceId` 与 `phoneJkt` 必须取当前签名云令牌的 `device_id`、`cnf.jkt`，并与本机实际 DPoP 密钥相符。账号、电脑、证书、双方公钥、双方随机值、challenge、来源和期限全部进入承诺或 SAS。

跨语言固定向量见 [`tests/fixtures/pairing-v2.json`](../../tests/fixtures/pairing-v2.json)，包含完整有序数组、双方固定合成贡献、两个承诺和六位结果。这里只是编码验算数据，正式每次必须重新随机生成。

## 请求与状态

以下手机请求都带 `{accessToken, deviceName, challenge, ...}`，使用宿主受众 `host:session` 令牌及新鲜 DPoP（设备密钥持有证明）；每次先请求 `/auth/cloud-nonce`，DPoP 绑定本次完整 URL、POST、访问令牌散列和 nonce。签名、邮箱核实声明、账号绑定、设备公钥、代际、撤销、重放校验沿用现有实现。响应不含 Cookie、CSRF、会话令牌或 `hostTrust`，直到最后兑换。

1. `/cloud/pairings/join` 另带 `phoneCommitment`。第一台设备锁定本次承诺与身份，其他设备或不同承诺返回 `409 PAIRING_CONFLICT`；同一贡献可幂等重试。返回 `{state:"committed", hostNonce, expiresAt}`。手机核实电脑承诺匹配二维码；失败即停止，不能公开自己的随机值。
2. `/cloud/pairings/reveal` 另带 `phoneNonce`。宿主核实手机承诺，只允许原设备与公钥。返回 `{state:"comparing", hostNonce, expiresAt}`；手机用自己的材料独立算 SAS 并显示。重复相同公开请求不会倒退状态。
3. 电脑用本地会话 `POST /cloud/pairings/status {challenge}` 轮询，得到 `{state, expiresAt, deviceName?, verificationCode?}`。状态为 `waiting → committed → comparing → confirmed → completed`；终态还包括 `cancelled / expired`。只有公开完成才返回六位数。
4. 人在电脑确认：`POST /cloud/pairings/decision {challenge, decision:"confirm", verificationCode}`，必须是当前显示的六位数且处于 `comparing`。只写确认状态，**尚不创建会话或信任设备**。取消用 `decision:"cancel"`，允许从任一未完成状态取消。两者同样要求直接本地会话和 CSRF；其他账号/手机不得确认。
5. 手机继续以原设备和 DPoP 密钥请求 `/cloud/pairings/redeem`。仅 `confirmed` 可兑换，兑换在串行事务内单次消费，信任这次核对的精确设备公钥并生成现有会话与 `hostTrust`，设置 Cookie。同设备号的其他公钥不会继承本次确认；被替换公钥的旧会话也失效，新钥匙须重新配对。确认前为 `403 PAIRING_CONFIRMATION_REQUIRED`；未提交、错误身份、旧协议、取消、过期、重复兑换为 `401 PAIRING_INVALID`。

重新生成会取消该本地账号全部未完成配对；关闭弹窗会请求取消，失败显示错误并保留重试，不能静默显示取消成功。后台/重启不续期，状态持久化；确认与取消、兑换竞争按宿主串行顺序生效。解绑、云账号变更、设备下线和认证代际仍可拒绝兑换。电脑 UI 不自动刷新出新二维码，必须主动“重新添加”。

云端无需新增字段或接口：仍签发现有绑定电脑受众、已核实设备且绑定 DPoP 公钥的令牌。安卓 `host.business` 桥不开放这些认证路由；手机需由现有专用认证传输接入。旧手机未实现 join/reveal 会安全失败，不会自动降级成无核对兑换。

验证：`node --test tests/personal-cloud.test.ts tests/personal-cloud-web.test.ts`；真实隔离 Electron 深浅色与确认流程：`node tests/integration/pair-code.mjs`。
