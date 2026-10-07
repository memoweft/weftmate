# Linux 部署草稿 · S0–S2

本工作包没有 SSH、部署、修改 DNS 或使用生产 CA。配置须在部署包结合实际 Linux、现有网站/代理、域名与 Node 24 路径核实。草稿使用 example.com / 203.0.113.10，不包含真实地址、账号或秘密。

## 拓扑与端口

公网只有 **TCP 443** 由 HAProxy 拥有，按 ClientHello SNI 分流（`haproxy.cfg`）：

| SNI | 回环路径 | TLS 终止 |
|---|---|---|
| api.example.com | Caddy 9443 → Node 8787 | Caddy；控制面允许云读 |
| relay.example.com | cloud control ingress 7001 → frps 7000 | 官方 frps；外层 transport TLS |
| h-<32hex>.hosts.example.com | cloud content ingress 7444 → frps HTTPS mux 7443 → frpc → 宿主 adapter → HTTP | **宿主**；云只转 TLS 密文 |

8788 是 frps 的私有 HTTP plugin；宿主 adapter 和原宿主 HTTP 仅绑定 127.0.0.1。所有内部端口不对公网开放。未知 SNI 拒绝；内容不使用 HAProxy `ssl`、Caddy HTTP 反向代理或 CDN TLS 终止。外层 frpc transport 强制 TLS、CA 验证和 relay.example.com 的 serverName，标准 TLS 首字节使 SNI 可被前置读取。

API 后端的 `send-proxy-v2` 仅交给 Caddy，Caddy 全局 options 的回环受信 proxy_protocol wrapper 必须先于 tls。它传递真实客户端来源给已有 cloud 限速，Caddy 覆盖 Host/X-Forwarded-Host/Proto/For 并删除 Forwarded；云 `CLOUD_TRUST_PROXY=true`。内容/control ingress 不发送 PROXY 协议，插件需要它们自己的 upstream socket 地址关联宿主。

## 部署前所需

1. 服务器：可绑定公网 TCP 443，原本的 Caddy/网站/代理需先协调到 HAProxy 的相应 backend。需要 Node 24、HAProxy、Caddy（内置 proxy_protocol listener wrapper 的版本）、官方 frps 0.71.0。保留既有非本项目服务的路由；本草稿的三个 SNI 不能覆盖它们。
2. DNS：`api.example.com`、`relay.example.com`、`*.hosts.example.com` 的 A/AAAA 指向部署地址（文档示例 203.0.113.10）。内容记录仅 DNS，不开启 CDN/边缘 TLS 代理。
3. 云证书：API 与 relay 域名的合法 fullchain/key；分别只有 Caddy/frps 可读。因唯一 443 已做 SNI，控制证书取得/续期按部署现场选择 DNS-01 或专门验证路由；不能假设 Caddy 自动 HTTP-01 已能穿前置。宿主内容私钥绝不放云。
4. 内容证书：宿主保存 S1b 内容 key，使用 `relay-csr.mjs` 导出 CSR、成熟 certbot DNS-01 + `relay-acme-hook.mjs` 签发；定时重签相同 CSR、安装 fullchain 并 reload/重启宿主。详见 src/personal-relay/README。
5. DNS provider：部署 `createIdentity({relayDns:{present,cleanup}})` adapter，只增删指定 TXT 值并在权威记录发布后返回；记录名云计算为 `_acme-challenge.<已认领宿主域名>`。可逐宿主 CNAME 委托验证区；整区密钥只存在云私有配置，宿主只持安装 key，不持 DNS 密钥。默认 provider 未连接返回 503，真实 CA 签发不能提前宣称成功。

## 文件与启动顺序

cloud 发布目录沿用 `/opt/weftmate-cloud/releases/<commit>/` 与 current 链接；数据 `/var/lib/weftmate-cloud/` 由 systemd StateDirectory 管理，0700；`/etc/weftmate-cloud/cloud.env` 0600。云 unit 使用 DynamicUser，不以 root 运行 Node。relay/frps 证书示例在 `/etc/weftmate/relay/`；独立 frps DynamicUser unit 需通过 systemd 凭据/权限提供只读 transport key，具体属主/证书权限在部署包设置，不能把 key 改成 world-readable。

- 安装已审查发布的 cloud 锁文件依赖，跑 `npm test`；迁移 004 在启动时向前执行，不改旧迁移。
- 从仓库根跑 `node scripts/download-frp.mjs`，官方资产按内置 SHA256 验证；将解压后的 frps 放 `/opt/weftmate/frp/`（二进制只在部署环境）。无代理镜像/自行编译 frp 产物。
- 编辑 `cloud.env.example`、frps.toml 的保留示例。启动 cloud，它开启必经的控制/内容 TCP ingress 与 plugin；随后启动 `weftmate-frps.service`。
- 合并 `Caddyfile.fragment` 的 global options 到现有**唯一**全局块，保留既有站点，Caddy 只在回环 9443 终止本控制面的 TLS。先 validate，再 reload；不在本包执行。
- 用 `haproxy -c -f haproxy.cfg` 检查，审查既有 443 路由后启用 HAProxy。示例配置已用真实 HAProxy 检查并用于隔离 E2E；systemd/Caddy 的真实现场配置仍由部署包验收。
- 宿主先直接登录与 S1b 认领绑定，取得随机域名/签发内容证书，再启用 relay 环境。验证浏览器与已配对原生端，确认 Host/Origin/CSRF/setup、TLS pin、断网重连和撤销断流。

**两个 cloud TCP ingress 是撤销能力的必要组成**：官方 frps 0.71.0 没有踢在线 client 的管理 API。插件根据 Login.client_address / NewUserConn.remote_addr 关联入口 socket，撤销/轮换立即销毁它们；不是仅拒绝下一次登录。禁止让公网直达 frps 7000/7443，plugin 也不可被公网反代。第一认领成员的 transport owner 只能管理中继，不能因此读取其他本地账号内容。撤销是持久状态，客户端重取凭据不会自动复活。

## 升级、回滚与验证

迁移只向前，已升级 schema 的旧版本拒绝开新库。上线前分别备份一致 SQLite 快照与云身份签名/HMAC key；WAL 在线库不能只 cp 主 db。[SQLite 官方备份](https://www.sqlite.org/backup.html) 恢复旧快照会丢失后续账号/撤权，须本人决定，不自动恢复用户数据。

独立 frp transport 证书续期在云；每宿主内容证书续期在自己宿主，保持同一 key/pin。日志不记录请求体、Cookie、令牌、邮件/正文/真实邮箱或完整 URL；Caddy 未启用 access log。云 `/healthz` 仅表示 DB 健康，不能代替 relay discover 与真实端点请求。

Mac 本地隔离链路已通过（18443，当前用户没有低端口授权）；CI `Relay full chain (443)` 使用真实 443、官方 frps/frpc、HAProxy 和宿主 TLS，上传只含合成计数的 JSON 证据。真实服务器端口、DNS provider、生产 CA、systemd 权限、现有服务共存、Windows/原生端真机仍需部署/S1c 工作包验证。本包无部署、真实发信或生产数据访问。
