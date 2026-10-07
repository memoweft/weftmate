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

## 生产 DNS-01

1. `node scripts/relay-csr.mjs <absolute personal-access root> h-<32hex>.hosts.example.com` 导出原内容 key 的 CSR，生成 `relay-tls/host.csr` 与私有 `key.pem`。证书保持同一 SPKI。
2. 部署 certbot 或等价成熟 ACME 客户端。示例（目录/邮箱均替换为本人在宿主的配置，不提交）：

```sh
export WEFTMATE_ACCESS_ROOT=/opt/weftmate/private/personal-access
export WEFTMATE_CLOUD_ISSUER=https://api.example.com/personal/v1/cloud/oidc
certbot certonly --manual --preferred-challenges dns \
  --csr /opt/weftmate/private/personal-access/relay-tls/host.csr \
  --manual-auth-hook 'node /opt/weftmate/scripts/relay-acme-hook.mjs' \
  --manual-cleanup-hook 'node /opt/weftmate/scripts/relay-acme-hook.mjs --cleanup' \
  --non-interactive --agree-tos --email account@example.com
```

3. hook 先确认 CERTBOT_DOMAIN 是自己已认领域名，再以安装 ES256 proof 提交 TXT 值。云计算记录名，宿主没有整区 DNS 凭据；云部署的 provider 只增删本次值，并确保权威记录可见后返回。没有 provider 时 503，ACME 必须失败。
4. 安装 certbot 取得的 fullchain 到 CERT_FILE；定时使用相同 CSR 重新签发。`--csr` 模式的定时签发与文件安装、reload/宿主重启由部署包负责（不能假设普通 `certbot renew` 自动维护外部 CSR）。首次签发时可先启用 relay、CERT_FILE 指向将安装的路径：直接地址 `/status.relay.baseUrl` 会先返回已分配域名，证书未就绪状态为 offline，adapter 不发布内容。用该域名签发并安装后，生命周期重试自动启动 adapter/frpc；本包没有联系生产 CA。

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
