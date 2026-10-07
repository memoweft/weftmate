# 宿主中继与本机 TLS（S2）

宿主只依赖原 personal/v1 与 S1b 身份；frpc 搬运端点 TLS 密文。接口见 CLIENT_API 7.6，云侧与 SNI 拓扑见 CLOUD 3，部署草稿见 services/cloud/deploy。

## 启用

先在电脑直接地址登录、认领并绑定云账号。安装官方固定 frpc：

```sh
node scripts/download-frp.mjs
```

Electron 或 `scripts/run-personal-host.mjs` 继承以下宿主环境（路径指向宿主私有目录）：

```sh
WEFTMATE_CLOUD_ISSUER=https://api.example.com/personal/v1/cloud/oidc
WEFTMATE_RELAY_ENABLED=true
WEFTMATE_FRPC_FILE=/opt/weftmate/frp/frpc
WEFTMATE_RELAY_CA_FILE=/opt/weftmate/certs/transport-trust.pem
WEFTMATE_RELAY_CERT_FILE=/opt/weftmate/certs/host-fullchain.pem
```

CA 文件用于验证 relay.example.com 的 frp 外层 TLS；使用可信生产 CA 时提供对应根链。`serverName` 固定为云返回的 relay.example.com，启用标准 TLS 首字节以便 HAProxy SNI 分流，强制 transport TLS 与 tcpMux。云不会下发内容私钥。开发/隔离测试可用 `WEFTMATE_RELAY_DEVELOPMENT_TLS=true` 代替 CERT_FILE，需要 OpenSSL；开发 CA 仅在宿主 `relay-tls/`，测试客户端显式传入，不能用于生产。

`createPersonalAccessService({relay:{binary,transportCaFile,certFile}})` 接入生命周期。启动后先安装签名取目录/凭据，再把认领 origin 加入允许列表、启动回环 HTTPS adapter 和 frpc；云未绑定/不可用不影响直接地址登录。frpc 原生负责断线重连；其异常退出后宿主重启 sidecar。IPC 监督进程在宿主崩溃/断开时也关闭 frpc，正常 close 等进程结束并销毁 TLS socket。未启用时 status 为 disabled。

`relayStatus()` 与已认证 GET `/personal/v1/status` 返回相同状态；私有管理 API 每两秒检查代理是否 running，不在状态或日志暴露凭据。`rotateRelayCredential(requestId)` 取幂等新 generation 并重启 frpc。`reloadRelayCertificate()` 热载新 fullchain，校验实际 SPKI 与认领域名；不能悄悄换 key。公开 pairing response 的 pin 对应 S1b 本机 key 与真实 listener，完整原生 pin 持久化和更新由 S1c 实现。

## 生产 DNS-01（S2b 自动签发）

Windows / macOS 宿主在进程内使用 [ACME.js](https://git.rootprojects.org/root/acme.js)（`@root/acme` 3.1.0）与 `@root/csr`，不依赖 certbot/OpenSSL。启用自动签发时，下面配置替代手动安装内容证书：

```sh
WEFTMATE_RELAY_ACME_ENABLED=true
# 默认是 Let's Encrypt 生产目录；测试时可设 staging 或 Pebble。
WEFTMATE_ACME_DIRECTORY_URL=https://acme-v02.api.letsencrypt.org/directory
# 可选：本人在宿主私有环境里填 CA 通知邮箱，不提交。
WEFTMATE_ACME_EMAIL=account@example.com
# 可选；不填则保存到 <personal-access root>/relay-tls/host-fullchain.pem。
WEFTMATE_RELAY_CERT_FILE=/opt/weftmate/private/host-fullchain.pem
```

先在直接地址登录、认领并绑定云账号；本人按 [部署说明](../../services/cloud/deploy/README.md#宿主内容证书s2b阿里云-dns-01) 配置云端 RAM 凭据，再在宿主开启以上环境。Electron 和 `scripts/run-personal-host.mjs` 均继承 cloud/relay/ACME 配置。首次签发前 `/status.relay.baseUrl` 已分配，状态可能 offline；签发成功后自动启动 TLS adapter/frpc。没有 DNS 凭据时，`certificateErrorCode=DNS_NOT_CONFIGURED`，直接地址继续可用。

CSR 只使用现有 identity.json 内容私钥；云端只收到安装签名与 TXT 值，内容 key/ACME 账号 key 都留在宿主。账号 key 按目录 URL 独立保存于私有 `relay-tls/acme-account-<hash>.json`。启用表示同意所选 CA 的 ACME 服务条款。库的可选 maintainer 注册请求已关闭，不向 Root 发送用户邮箱、locale 或使用信息。

启动检查一次，之后每天一次；剩余 **少于 30 天**重新签发。成功后校验域名、SPKI 与证书有效期，0600 原子安装 fullchain 并热载现有 TLS adapter，不重启宿主/frpc，不中断既有 TLS 连接。失败保留已有证书，最近错误及下一次尝试日期保存在私有状态文件，重启也按天重试；`/status.relay` 显示 `certificateExpiresAt`（UTC ISO8601/null）和 `certificateErrorCode`（代码/null）。电脑休眠/离线错过定时检查后，下一次启动会检查已经到期的检查日期。

Let's Encrypt staging 目录为 `https://acme-staging-v02.api.letsencrypt.org/directory`，其证书不被普通浏览器信任。staging 与生产应使用不同 CERT_FILE；验证 staging 后切换生产目录和生产证书路径。Pebble 只用于隔离测试，信任通过测试进程的 `NODE_EXTRA_CA_CERTS` 指定，不关闭 TLS 校验、不改系统信任。

云接口的 present 只在所有权威 NS 都查询到该 TXT 后返回；最长等待约 90 秒，超时 `DNS_PROPAGATION_TIMEOUT`，API 错误 `DNS_PROVIDER_ERROR`。宿主 DNS 请求超时为 125 秒。阿里云免费解析区最低 TTL 为 600 秒，适配器把内部请求的 60 秒提升到 600 秒；API 调用方仍不能指定名称、类型、区或 TTL。每个挑战的 RecordId 持久保存在云 SQLite schema 5；清理只删除本服务写入的 ID，保留已有/并发 TXT。若进程或机器掉电遗留 TXT，本人可根据 `relay_dns_records` 核对后私下清理，暂未实现后台残留清扫。

手动运维仍可使用 `scripts/relay-csr.mjs` 与 `scripts/relay-acme-hook.mjs`；CSR 脚本也已改为 Node 生成，自动路径不把内容 key 导出成新的私钥。开发 CA 模式仍需 OpenSSL，不能用于生产。

开发 TLS、sidecar 和宿主 HTTP 全部仅监听回环。TLS adapter 拒绝外来转发头并写自己的固定值；同源 Cookie/CSRF 原样，setup 与本地认领只能直接访问。

## 本地验证

```sh
node scripts/download-frp.mjs
WEFTMATE_RELAY_E2E=true \
WEFTMATE_FRP_DIR="$PWD/.local/frp/frp_0.71.0_darwin_amd64" \
WEFTMATE_HAPROXY=/path/to/haproxy \
WEFTMATE_RELAY_FRONT_PORT=18443 \
WEFTMATE_RELAY_REPORT="$PWD/.local/s2-relay-verification.json" \
node --test services/cloud/test/relay-e2e.test.mjs
```

测试创建隔离 cloud/宿主/CA，使用真实官方 frp、HAProxy TCP 和 --resolve，不改 hosts 或系统信任；低端口有权限时 FRONT_PORT=443。Mac 当前无 443 权限所以使用 18443；GitHub `Relay full chain (443)` 跑实际 443。测试覆盖 TLS 双向密文、登录/SSE/分页/附件/重连/域名所有权/pin/轮换/撤销；JSON 报告只有合成状态和计数。真实 DNS、生产部署、Windows 打包与原生客户端真机属于后续包。

## 自动证书隔离验证

```sh
node scripts/download-pebble.mjs
node scripts/download-frp.mjs
# Mac Intel 示例；Linux CI 用对应 linux_amd64 frpc。
WEFTMATE_PEBBLE_E2E=true \
WEFTMATE_FRPC_FILE="$PWD/.local/frp/frp_0.71.0_darwin_amd64/frpc" \
NODE_EXTRA_CA_CERTS="$PWD/.local/pebble/certs/pebble.minica.pem" \
node --test services/cloud/test/dns-aliyun.test.mjs services/cloud/test/host-certificates.test.mjs services/cloud/test/host-certificates-pebble.test.mjs
```

官方 Pebble 2.10.1 / challtestsrv 二进制与公用测试 CA 夹具经过 SHA256 验证，全部留在忽略目录 `.local/pebble/`。测试启动回环 CA、真实 UDP/TCP DNS、假 AliDNS API、真实 cloud/宿主/官方 frpc/TLS adapter，验证真实配对 pin、热载保留连接与模拟到期续期；不连接阿里云或生产 CA。GitHub `Host certificates (Pebble DNS-01)` 重复此链路并上传无秘密 JSON 报告。

选用 ACME.js 是因为 acme-client 5.4.0 的 legacy node-forge 依赖目前触发未修复高危审计；本包没有放宽审计门禁。固定 ACME.js 版本，HTTP 兼容层通过库自带签名工具对 processing 订单做 RFC8555 POST-as-GET 轮询，避免其旧版重复 finalize 行为；Pebble 覆盖这一路径。后续升级 ACME 库仍需复跑本测试。
