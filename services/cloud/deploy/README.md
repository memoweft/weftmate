# 云服务与中继部署 · D1

2026-10-07 已部署 Node 24.21.0、官方 frp 0.71.0、cloud schema 4。现场沿用 Ubuntu nginx，公网 TCP 443 使用 stream（TCP 流代理）+ ssl_preread（读取 TLS 握手名称）；HAProxy/Caddy 文件保留为旧 S2 隔离验证夹具，生产使用本目录 nginx 配置。真实地址、邮箱、密钥、密码、证书和运行数据只在服务器私有文件或仓库外运行目录。

## UP-2 桌面客户端配置（2026-10-09）

生产保持 DEP-1 的 `dfe56ec` release（发布版本）与 schema（数据库结构版本）6，仅更新 `CLOUD_OIDC_CLIENTS`。修改前的 `cloud.env` 保存在 `/root/weftmate-deploy/up-2-20261009T021230Z/cloud.env`，私有目录 0700、文件 0600。只更换客户端配置一行，其余行逐字节一致；只重启 `weftmate-cloud`，未重启 frps/nginx、未更新代码或数据库结构。失败时恢复该文件并重启 cloud（云服务），无需恢复整个数据库快照。

正式客户端列表只列 ID（标识）与回调：

| client_id | redirect_uri（回调地址） |
|---|---|
| `weftmate-apple` | `com.weftmate.apple:/oauth/callback` |
| `weftmate-android` | `com.memoweft.weftmate:/oauth` |
| `weftmate-desktop` | `http://127.0.0.1:18186/personal/v1/ui/` |

桌面为 native（原生）公开客户端，Apple / Android 原配置保持不变；没有临时、虚构或通配回调。`/healthz`、OIDC（开放身份连接协议）discovery（发现文档）、JWKS（签名公钥集合）和桌面 `/auth/authorization` 均为 200，cloud/frps/nginx 均 active（运行中）。隔离真实 Electron（桌面程序框架）、复制的版本 2 本地密码账号与运维合成云账号验通桌面绑定及正式内容证书、中继、公网 443；验证账号经正式注销接口清理，临时宿主与数据目录关闭删除。证据见 [UP-2 验证](../../../tests/evidence/up-2/README.md)，日用程序与数据未动。

配置文件回滚命令仅用于本次客户端配置引入的故障：

```sh
cp -p /root/weftmate-deploy/up-2-20261009T021230Z/cloud.env /etc/weftmate-cloud/cloud.env
systemctl restart weftmate-cloud
systemctl is-active weftmate-cloud
curl -fsS https://api.weftmate.com/healthz
```

日用电脑配置及本人重启后绑定步骤见 [SETUP](../../../docs/SETUP.md#日用-windows-云账号up-2)；远程网页回调需在确认实际用途后另行精确登记。本次没有读取或输出 `cloud.env` 的凭据值，备份不下载、不提交。

## 拓扑与现有服务

| SNI（服务器名称指示） | 路径 | TLS（传输层安全协议）终止 |
|---|---|---|
| api.example.com 与其余 SNI，包括空 SNI | nginx stream 443 → nginx HTTPS 127.0.0.1:9443；API → cloud 8787 | nginx；原网站仍使用原证书 |
| relay.example.com | 443 → 17001 → cloud control ingress 7001 → frps 7000 | frps，仅外层隧道 |
| *.hosts.example.com | 443 → 17444 → cloud content ingress 7444 → frps HTTPS mux 7443 → frpc → 宿主 | 宿主，云没有内容 key |

8788 是私有授权 plugin（插件）。所有新增内部端口只监听回环，不新增防火墙端口。80 的原网站、UDP 443 的 hysteria、sing-box、SSH、VNC、其他代理和应用都保持原配置。

nginx 1.18 的 `proxy_protocol on` 按 server 配置，不能按 map 给不同后端切换。因此公网入口统一发送 PROXY protocol（代理来源协议）v1；HTTPS 9443 接收来源地址，17001/17444 两个回环 stream listener（监听器）接收并剥离头，再发送原始 TLS 字节给云必经入口。它们不解密、不直连 frps。云保存到 frps 的 socket 所有权，才能撤销已在线连接。

HTTP 全局配置加 `set_real_ip_from 127.0.0.1; real_ip_header proxy_protocol;`；所有旧 HTTPS listener 改为 `127.0.0.1:9443 proxy_protocol ssl` 和 `[::1]:9443 proxy_protocol ssl`，保留原 http2/证书/站点配置。默认 combined 日志的 `$remote_addr` 和原有反代的来源头因此继续使用真实客户端地址；普通 80 请求没有 PROXY 头，来源地址维持原值。现场 fail2ban 只有 sshd jail，不依赖 nginx 日志，无需修改。

API 覆盖 Host/X-Forwarded-Host/Proto/For/X-Real-IP，并删除 Forwarded；`CLOUD_TRUST_PROXY=true`。API access log（访问日志）关闭，避免 OIDC query（查询参数）进入日志。旧站点日志路径与格式保持原样。

## 基线、备份、回滚准备

以下操作在目标服务器 root 会话中执行，代码先从已审查 commit（提交）上传到 `/root/weftmate-deploy/source`。私有运维目录权限 0700；不要把生成结果带入 Git。

```sh
umask 077
mkdir -p /root/weftmate-deploy
install -m 700 services/cloud/deploy/verify-existing-services.py /root/weftmate-deploy/verify-existing-services.py
python3 /root/weftmate-deploy/verify-existing-services.py baseline
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/root/weftmate-deploy/backup-$stamp
mkdir "$backup"
tar -C / -czf "$backup/nginx.tar.gz" etc/nginx
sha256sum "$backup/nginx.tar.gz" > "$backup/nginx.sha256"
printf '%s' "$backup" > /root/weftmate-deploy/backup-path
install -m 700 services/cloud/deploy/rollback.sh /root/weftmate-deploy/rollback.sh
/root/weftmate-deploy/rollback.sh --dry-run
```

基线脚本从 nginx 配置枚举既有域名，保存 HEAD/GET 状态、关键头、官网正文散列、叶证书散列、TCP/UDP listener、运行服务、内存、磁盘和 fail2ban 状态。后续传入其他标签做比较；每次 reload 后立即执行，任何差异立即回滚并停止部署。它检查原有非 nginx listener 的地址及进程，忽略变化的队列长度和 nginx worker。

```sh
nginx -t && systemctl reload nginx
python3 /root/weftmate-deploy/verify-existing-services.py after-reload || {
  /root/weftmate-deploy/rollback.sh
  exit 1
}
```

本次基线位于 `/root/weftmate-deploy/baseline-20261007T140251Z/`，备份由私有 `backup-path` 指定。本地完整基线在 `Runtime/Orchestrator/d1-baseline.txt`。现有 6 个域名 × HTTP/HTTPS 共 12 个入口比较通过；包含原有 learn 502、power HEAD 501 / GET 303，不能把这些既有状态误认为部署引入的问题。UDP 输出包含应用的临时外连 socket，保存原文供核对，不把自然变化的临时端口当作服务重启；原有固定 UDP 入口另核对。`ss` 的进程列须去除列宽填充空格，本次修正此比较误报后实际执行过回滚并重验旧入口，再恢复部署。

## 安装运行时与发布

Node 使用官方二进制，版本与 SHA256（校验散列）在服务器保存；不替换 `/usr/bin/node` 或系统 npm。

```sh
cd /root/weftmate-deploy
version=v24.21.0
name=node-$version-linux-x64
curl -fsS https://nodejs.org/dist/$version/$name.tar.xz -o "$name.tar.xz"
curl -fsS https://nodejs.org/dist/$version/SHASUMS256.txt -o SHASUMS256.txt
grep " $name.tar.xz\$" SHASUMS256.txt | sha256sum -c -
tar -C /opt -xf "$name.tar.xz"
ln -sfn /opt/$name /opt/weftmate-node
export PATH=/opt/weftmate-node/bin:$PATH
cd /root/weftmate-deploy/source
node scripts/download-frp.mjs
```

frp 下载脚本固定 0.71.0，只接受官方发布来源并验证内置 SHA256；将生成目录里的 frps/frpc 用 `install -m 755` 安装到 `/opt/weftmate/frp/`。云独立安装 `services/cloud/package-lock.json`，不安装 Electron/DSH。

```sh
release=/opt/weftmate-cloud/releases/<reviewed-commit>
mkdir -p "$release" /etc/weftmate-cloud /etc/weftmate /opt/weftmate/frp
cp -a services/cloud/. "$release/"
cd "$release"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
chmod 755 /opt/weftmate-cloud /opt/weftmate-cloud/releases /opt/weftmate /opt/weftmate/frp /etc/weftmate
chmod -R a+rX "$release"
ln -sfn "$release" /opt/weftmate-cloud/current
```

只对发布代码设置可读权限。`umask 077` 创建的父目录默认 0700，须按上面显式开放代码目录，否则 DynamicUser（动态服务用户）无法进入工作目录。密钥/数据库/邮件目录仍为私有权限。

复制 `cloud.env.example` 为 `/etc/weftmate-cloud/cloud.env`，0600，替换示例域名；`CLOUD_MAIL_TRANSPORT=file`，生产发行者使用 HTTPS。systemd EnvironmentFile（环境文件）中的 JSON 配置须整体用单引号包裹，保留 JSON 双引号。默认 `CLOUD_OIDC_CLIENTS=[]`；客户端的正式回调由 S1c 登记，不留部署测试 client。

S1e 的 cloud unit（云服务配置）使用独立 `LogNamespace=weftmate-cloud`。升级时将 `deploy/journald@weftmate-cloud.conf` 安装到 `/etc/systemd/journald@weftmate-cloud.conf`，再随正常代码升级重新加载 unit 并重启 cloud；只配置该日志 namespace（命名空间）。日志为 volatile（内存存储），目标保留一小时、五分钟轮转、最多 16 MiB；不含邮箱明文或请求内容。查日志改用 `journalctl --namespace=weftmate-cloud -u weftmate-cloud`；原 frps/旧服务 journal（日志）不变。真实入口启动与每分钟清理过期验证/授权/防重放/限速元数据及一小时前的 file 邮件。S1e 工作包只提交配置与验证，不执行部署。

安装两个 unit（服务单元）到 `/etc/systemd/system/`、`frps.toml` 到 `/etc/weftmate/frps.toml`，配置文件 0644，环境文件 0600。cloud 使用 DynamicUser、StateDirectory `/var/lib/weftmate-cloud`、UMask 0077、ProtectSystem；frps 使用独立 DynamicUser 和 LoadCredential（服务私有凭据），从 root 可读的 certbot 私钥生成进程专属只读快照，不开放私钥的全局读权限。

```sh
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/weftmate-cloud.service /etc/systemd/system/weftmate-frps.service
systemctl enable --now weftmate-cloud
# 初次身份 key 生成需数秒，确认 healthz 200 后继续。
curl -fsS http://127.0.0.1:8787/healthz
```

## DNS 与证书、443 切换

用 DoH（经 HTTPS 查询 DNS）核对 api、relay、随机 hosts 子域的 A/AAAA，与服务器私有地址清单比较。A 必须正确，存在的 AAAA 也必须可达；不使用 DNS 本机缓存的合成地址。本次三个 A 已就绪，AAAA 未设置，无需本人再添加这些记录。

```sh
curl -fsS 'https://dns.alidns.com/resolve?name=api.example.com&type=A'
curl -fsS 'https://dns.alidns.com/resolve?name=relay.example.com&type=A'
curl -fsS 'https://dns.alidns.com/resolve?name=h-0123456789abcdef0123456789abcdef.hosts.example.com&type=A'
# 对三个名称也查 type=AAAA。
```

若 DNS 未指向，跳过该域证书与公开验证。本人添加正确记录后，重查并执行下面对应证书命令。不要拿其他站点证书冒充新域名。

先只安装 `nginx-api.conf` 的 80 server 块，替换示例域名；挑战目录沿用 `/var/www/letsencrypt`。`nginx -t`、reload、基线通过后，用现有 certbot 账号申请，采用 webroot（网站根目录）方式避免 nginx installer 自动改写 443 布局。

```sh
certbot certonly --webroot -w /var/www/letsencrypt \
  --cert-name weftmate-cloud -d api.example.com -d relay.example.com \
  --non-interactive --agree-tos --no-eff-email
```

确认 stream 模块加载；缺失时只装 Ubuntu 官方 `libnginx-mod-stream`。将 `nginx-stream.conf` 放 `/etc/nginx/weftmate-stream.conf`，从 nginx.conf 的 **http 块外** include。迁移全部旧 443 listener 到回环9443并增加上述 real_ip 设置，最后安装 API 的 HTTPS 块。保留默认站点顺序、IPv4/IPv6、证书、80 和旧日志。完整配置 `nginx -t` 后 reload，立即运行基线比较；失败执行回滚，不继续。

```sh
systemctl enable --now weftmate-frps
install -m 755 services/cloud/deploy/renew-cloud-certificate.sh \
  /etc/letsencrypt/renewal-hooks/deploy/weftmate-cloud
certbot renew --cert-name weftmate-cloud --dry-run
```

API 与 relay 共用本次双名称证书，2027-01-05 到期，续期由现有 certbot timer（定时器）负责。deploy hook（签发后钩子）只处理该 lineage（证书系列），验证并 reload nginx、重启 frps 以刷新 LoadCredential 快照。frpc 原生重连恢复隧道，续期重启期间会短暂断开中继连接。

## 宿主内容证书（S2b）：阿里云 DNS-01

S2b 开发包只交付代码和说明；**2026-10-09 DEP-1 第二轮已在生产升级 cloud，并用隔离宿主完成真实阿里云 DNS-01 staging（测试环境）及一次正式签发**，详见本文末的升级记录。本人日用宿主尚未升级。nginx/frps 仍透传内容 TLS，内容私钥始终留在宿主。

1. 本人登录阿里云 RAM 控制台，创建专用 RAM 用户，例如 `weftmate-dns`，只开 OpenAPI AccessKey 使用，不授予管理员或其他服务权限。不要用阿里云主账号密钥。
2. 新建自定义权限策略，只允许 `alidns:AddDomainRecord` 与 `alidns:DeleteDomainRecord`，资源限定到自己的 DNS 区。下面是公开示例；本人把 `example.com` 替换为 weftmate.com、账号占位符替换为自己的阿里云主账号 ID，再只授权给该 RAM 用户：

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["alidns:AddDomainRecord", "alidns:DeleteDomainRecord"],
    "Resource": ["acs:alidns:*:<ALIYUN_ACCOUNT_ID>:domain/example.com"]
  }]
}
```

AliDNS 的 RAM 资源授权粒度是域名区，不能把此区的权限策略直接缩到某条 TXT；宿主的实际可写范围仍由已有安装签名接口限定到 `_acme-challenge.<自己认领的完整宿主域名>`。本适配器不需要列举或批量删除记录的权限，也不更新 A/AAAA/CNAME。授权语法与域名资源说明见 [AliDNS 自定义策略](https://www.alibabacloud.com/help/tc/doc-detail/2852374.html)、[AddDomainRecord](https://www.alibabacloud.com/help/en/dns/api-alidns-2015-01-09-adddomainrecord)、[DeleteDomainRecord](https://www.alibabacloud.com/help/en/dns/api-alidns-2015-01-09-deletedomainrecord)。

3. 在该 RAM 用户页面创建 AccessKey。本人保存在自己的私有凭据管理器，并亲自登录服务器编辑已有 `/etc/weftmate-cloud/cloud.env`；不要发到聊天、PR、Git 或工单，不执行会把内容打印到终端/日志的命令：

```sh
sudo chmod 0600 /etc/weftmate-cloud/cloud.env
sudoedit /etc/weftmate-cloud/cloud.env
# 编辑器中补充，真实值仅写在该私有文件：
# CLOUD_DNS_PROVIDER=aliyun
# ALIYUN_DNS_ZONE=example.com
# ALIYUN_DNS_ACCESS_KEY_ID=<本人私下填写>
# ALIYUN_DNS_ACCESS_KEY_SECRET=<本人私下填写>
sudo stat -c '%a %U:%G' /etc/weftmate-cloud/cloud.env
```

实际 DNS 区填写 weftmate.com；权限应为 600、root 所有。provider、zone、AccessKey 任一缺失时仍返回 `DNS_NOT_CONFIGURED`，不会声称发布成功。凭据只在 cloud 进程环境里读取，不给宿主。

4. 按「升级与回滚」先保存完整 StateDirectory 一致备份，再安装审查通过的 S2b cloud release。独立 cloud 依赖仍用 `services/cloud/package-lock.json`，无需安装根仓库的宿主依赖。schema 从 4 升到 **5**，新增 `relay_dns_records` 保存本服务创建的 RecordId；旧 schema 4 release 无法直接打开 schema 5 库，回滚需本人决定恢复升级前一致备份。重启并检查：

```sh
sudo systemctl restart weftmate-cloud
sudo systemctl is-active weftmate-cloud
curl -fsS http://127.0.0.1:8787/healthz
# 预期 schemaVersion=6（S2b + S1d；升级前备份数据库，不执行降级迁移）
sudo journalctl -u weftmate-cloud --since '5 minutes ago' --no-pager
```

5. 宿主升级 S2b 后，先在电脑直接地址登录/认领/绑定账号，配置已有 frpc/外层 CA 与下列宿主私有环境。建议先用 **独立隔离宿主与 staging 证书路径**验证，再对正式宿主使用生产目录。不要复制本人日用运行数据到仓库。

```sh
WEFTMATE_RELAY_ENABLED=true
WEFTMATE_RELAY_ACME_ENABLED=true
WEFTMATE_ACME_DIRECTORY_URL=https://acme-v02.api.letsencrypt.org/directory
# 可选 CA 通知邮箱；真实值只在宿主私有环境里。
WEFTMATE_ACME_EMAIL=account@example.com
# 可选；默认 <personal-access root>/relay-tls/host-fullchain.pem。
WEFTMATE_RELAY_CERT_FILE=/opt/weftmate/private/host-fullchain.pem
```

自动签发使用 Node ACME.js 与宿主已有内容 key，不需要 Windows certbot/OpenSSL。首次签发约需等待 DNS 发布；present 每个权威 NS 都查到值才返回，90 秒内未齐返回 `DNS_PROPAGATION_TIMEOUT`，API 拒绝/网络失败返回 `DNS_PROVIDER_ERROR`。免费 AliDNS 区使用最低 **600 秒 TTL**；签名接口的内部 60 秒提示被适配器提升，不更改域名 A 记录。系统/网络需允许 cloud 出站 HTTPS 与权威 DNS UDP/TCP 53。

DEP-1 第二轮增加 cloud 自己的 `dns.provider_failed` 运维日志：`providerCode`、`providerRequestId`、`httpStatus`、`action` 与 `failure`（`provider_rejected` / `network` / `invalid_response`）。只接受有长度及字符约束的服务商标识，并过滤回显的 AccessKey（访问密钥）与本次签名；不记录自由格式 Message（错误消息）、异常正文、完整请求 URL（网址）或请求头。客户端仍只收到 `DNS_PROVIDER_ERROR`。读取本服务日志使用 `journalctl --namespace=weftmate-cloud -u weftmate-cloud`，不要转储环境或签名请求。

6. 从已认证的**直接宿主地址**查 `/personal/v1/status`：`relay.certificateExpiresAt` 应有 UTC 到期日期，`certificateErrorCode` 为 null；签发完成后 frpc 联通时 state=online。从普通浏览器打开自己获配的 hosts HTTPS 地址，确认系统 CA 验证成功；原生端还应核对配对的 tlsSpki。不要用 `curl -k` 代替验证成功。staging 证书不能通过浏览器 CA 验证；正式签发需切生产目录和独立生产证书路径。

续期不依赖服务器 certbot：宿主每天检查、剩余 <30 天签发，失败按天重试（重启也保留日期），签发后原子安装并热载，不重启宿主或 frpc，SPKI 保持。API/relay 的既有 certbot timer 继续负责外层证书。RAM 凭据轮换只需本人在私有 env 替换后重启 cloud；不用重建宿主内容 key。可观察本机状态/正常握手验证续期，长时间浸泡与真实 Windows/Apple 客户端验收另包。

TXT 清理只使用 SQLite 中归本服务所有的 RecordId；保留同名的其他挑战，清理不存在的记录幂等。失败或宿主掉电可能留下记录：本人可在云数据库 `relay_dns_records` 私下核对 RecordId 与 RAM 控制台后清理；本包没有后台残留清扫，不批量删除挑战区。


## 验证与运维

```sh
curl -fsS https://api.example.com/healthz
curl -fsS https://api.example.com/personal/v1/cloud/oidc/.well-known/openid-configuration
systemctl is-active weftmate-cloud weftmate-frps nginx
ss -ltnp
journalctl -u weftmate-cloud -u weftmate-frps --since '10 minutes ago' --no-pager
```

公网检查须正常验证 CA，不能用 `-k` 代替成功。DNS 暂未就绪时，在服务器用 `curl --resolve <domain>:443:127.0.0.1 --cacert <explicit-test-ca>` 验等价路由，报告明确区别。Windows 本机若使用合成 DNS/代理，API 的 Node fetch 可用 `--use-env-proxy`；frpc 与 HTTPS 请求可临时使用 DoH 地址覆盖连接地址，保留正式 TLS serverName、Host、Origin 和 CA 校验，不改系统 hosts。

宿主验收只用隔离目录与测试账号：正式云注册/验证/PKCE（代码交换证明密钥）登录→宿主直接地址 setup/认领/绑定→frpc 公网443→随机 hosts 域 `/personal/v1/status`。验证 Secure Cookie、setup 拒绝、转发头伪造拒绝、撤销现有连接以及本地登录仍可用。生产内容 CA 未接入时只可显式使用隔离 CA，不代表普通浏览器生产证书已就绪。测试后移除临时 OIDC client，关闭宿主，撤销测试中继；日志仅检查合成凭据没有明文，不保存真实请求体到公开报告。

本次上线证据只在服务器 `/root/weftmate-deploy/`、本地 `.local/d1/` 与仓库外 `Runtime/Orchestrator/`。最后再次运行旧服务比较，核对来源地址、内存、磁盘；不运行全量本地单测，完整 CI（持续集成）由 PR checks 执行。

file transport（文件邮件传输）只写 `/var/lib/weftmate-cloud/mail-outbox`，不会发信。本人准备好 Resend 后，在私有 cloud.env 配置 `CLOUD_MAIL_TRANSPORT=resend`、`CLOUD_RESEND_API_KEY`、`CLOUD_MAIL_FROM`，并完成发件域 SPF/DKIM 验证，然后 `systemctl restart weftmate-cloud` 并验真实送达。不要在聊天或 PR 中粘贴密钥、邮件内容或收件人。

## 升级与回滚

每次入口变更前重新保存私有基线与 nginx 备份、更新 backup-path，并演练 dry-run。代码升级新建 release，安装独立锁定依赖，再切 current 链接并重启 cloud/frps；通过 healthz、OIDC、真实宿主链路和旧服务比较后保留旧 release 供回退。

升级数据 schema 前先停 cloud/frps，在 root 私有备份目录保存**完整** StateDirectory（含 SQLite/WAL/SHM、identity-keys、邮件），再启动服务；或采用 SQLite Online Backup API（一致快照备份接口）。在线 WAL 数据库不能只复制主 db。密钥和数据库需另做加密、异机备份；D1 没有创建外部存储或自动恢复用户数据。

```sh
# 一键撤回本次入口与新增服务，数据保留。
/root/weftmate-deploy/rollback.sh --dry-run
/root/weftmate-deploy/rollback.sh
```

回滚脚本保存当前 nginx，精确恢复备份配置，`nginx -t` 后 reload，并 disable/stop 两个新服务。不恢复数据库、不删除账号。代码回退只在 schema 兼容时把 current 指回旧 release；schema 不兼容时保留新库，提交报告由本人决定是否恢复旧一致快照，恢复会丢失之后的注册和撤权。

## 2026-10-09 升级记录（DEP-1 第一轮：失败后完整回滚，历史结果）

本人已授权本次升级及失败时恢复升级前一致快照。尝试从 `46b4beccd91827364fc6ff837736bd51f93862f8` 升至当时最新 main（主分支）`b65cae8f532aefcf9fbd7815643c7eb06578054b`；新 release（发布版本）实际启动并完成 schema（数据库结构版本）4→5→6，但隔离宿主的 Let's Encrypt staging（测试环境）DNS-01 签发返回 `DNS_PROVIDER_ERROR`。按照第一轮授权，已恢复旧 release、schema 4、完整数据及原配置；**第一轮收尾时为 `46b4bec…`，当时生产升级与宿主证书验收未完成；当前结果见下面的第二轮记录**。第一轮正式 CA（证书机构）签发没有发起，没有改 RAM（阿里云访问控制）权限、DNS 区或密钥。

升级前在 `/root/weftmate-deploy/dep-1-backup-20261009T010903Z`（0700、root 所有）保存：停 cloud/frps 后完整 StateDirectory（状态目录，含 SQLite/WAL/SHM、identity-keys、邮件）、全套 nginx、frps 配置、cloud.env、两个 systemd unit（服务单元）、原 current 链接与旧 release 路径。原日志命名空间配置不存在，另存不存在标记。备份文件为 `state.tar.gz`、`config.tar.gz`、`current-link.tar.gz`、`old-release` 与 `SHA256SUMS`；私有配置和备份都没有下载或进入 Git。

首次部署的 `rollback.sh` 会禁用服务，不能用于此次数据升级回退。新增 `rollback-upgrade.sh` 专用于本次已授权的完整恢复，保留替换下来的数据和 nginx 在同一私有备份目录，再恢复原数据、代码、环境与服务配置。升级前实际执行 dry-run（试运行）：校验全部备份散列、解包完整数据并执行 SQLite `integrity_check`，结果为 `ok`。配置预检失败及最终 DNS-01 失败时也实际执行完整恢复。

```sh
# 仅在本次明确授权的升级回滚场景使用；恢复会撤回快照之后的云数据。
backup=/root/weftmate-deploy/dep-1-backup-20261009T010903Z
/root/weftmate-deploy/rollback-upgrade.sh "$backup" --dry-run
/root/weftmate-deploy/rollback-upgrade.sh "$backup"
```

本次验证结果：

| 项目 | 实测结果 |
|---|---|
| 独立 cloud 依赖 / 数据迁移 | 从 main 的 `services/cloud/package-lock.json` 安装 40 个生产依赖；新库迁移序列 1–6、完整性通过。Node 24.21.0 / frp 0.71.0 沿用；frps 的有效配置未变 |
| 公开 API / 中继 | 新版本 `/healthz` 200/schema 6；OIDC（开放身份连接协议）discovery（发现文档）200、issuer 正确；JWKS（签名公钥集合）200且不含私钥；`relay.weftmate.com:443` TLS（传输层安全）1.3 与标准域名/CA 校验通过 |
| App（应用）账号交互 | 运维专用合成账号在隔离进程内持有随机密码与设备私钥；预置已确认的合成设备公钥，不向 example.com 发邮件。Apple / Android 正式 client（客户端）授权接口均 200；合成账号实际通过登录、resume（授权恢复）、PKCE（授权码校验）和 DPoP（设备密钥持有证明）令牌交换 |
| `/personal/v1/cloud/config` | 按 CLIENT_API 7.7 由隔离宿主提供，200且 issuer 正确；这个接口不是 cloud 服务的路由 |
| 邮件 | 仅 `delivered@resend.dev`，注册请求 200；服务自身日志确认一次 `mail.accepted` / `transport=resend`。这是 Resend 接受，不能声称已读到验证码或完成邮件注册 |
| 宿主 staging DNS-01 | 本机 w5 工作树中的真实个人访问服务、系统临时目录、随机回环端口及官方 frpc；认领 `h-3fd96590f27f1f037511c856f2061c70.hosts.weftmate.com`。首次 present（写入挑战）返回 `DNS_PROVIDER_ERROR`，没有取得/保存 RecordId（记录标识），证书未签发 |
| DNS 故障定位边界 | `aliyun` provider（域名解析适配器）、`weftmate.com` zone（域名区）匹配，两项 AccessKey（访问密钥）配置各有一项；未输出任何值。现有适配器将 API/网络拒绝统一为 `DNS_PROVIDER_ERROR`，因此无法从此响应确认具体 RAM 策略或 API 拒绝原因；没有把推测写成已确认的权限问题 |
| 正式宿主证书 | staging 未通过，未发起正式签发；普通浏览器宿主 HTTPS 与正式内容证书验证未完成 |
| 临时资源清理 | 宿主已解绑/关闭、运维合成账号已通过账号删除接口清除、本机临时目录已移除；云 `relay_dns_records` 始终为空；两台权威 NS（域名服务器）均确认挑战 TXT 不存在。回滚还移除了本次 pending（待验证）的 Resend 测试账号 |
| 既有服务 / 最终回滚 | 新版本和回滚后各比较 16 个 HTTP/HTTPS 入口，网站、证书及其他服务差异均为零；只排除本次允许重启的 WeftMate 六个内部端口的进程 ID 变化。最终旧 release/schema 4 的公开健康、中继域名/CA、数据库完整性、原有三个账号数量及备份内所有配置文件逐字节一致性均通过；三个服务 active（运行中） |

OIDC 登记只改过 `CLOUD_OIDC_CLIENTS`，JSON 整体使用 systemd 要求的单引号，尝试期间没有部署测试 client：

| client_id | application_type | 文档规定的 redirect_uri（回调地址） | 最终状态 |
|---|---|---|---|
| `weftmate-apple` | `native` | `com.weftmate.apple:/oauth/callback` | 尝试期间登记并验证；完整回滚恢复原 `[]` |
| `weftmate-android` | `native` | `com.memoweft.weftmate:/oauth` | 尝试期间登记并验证；完整回滚恢复原 `[]` |
| `weftmate-web`（网页与桌面默认复用） | `web` | 实际宿主 `<origin>/personal/v1/ui/`，逐个精确登记 | 未登记：服务器只有一个已撤销的历史测试中继，没有活跃的正式宿主 origin；没有添加通配符、虚构地址或保留临时宿主回调 |

LG-1a 桌面支持 `WEFTMATE_CLOUD_DESKTOP_CLIENT_ID` / `WEFTMATE_CLOUD_DESKTOP_REDIRECT_URI` 配置固定程序回调，当前仓库没有规定独立桌面默认回调；默认仍使用宿主的 `weftmate-web` 与 `<origin>/personal/v1/ui/`。本包按指示没有升级或读取本人日用 Windows 宿主，因此不能从日用配置获取实际地址，也没有自创 custom scheme（自定义协议）或登记开发回环地址。

第一轮留下的后续项为服务商安全错误码、重新备份/部署、staging/正式签发及客户端登记；第二轮处理结果如下。私有结果位于 `Runtime/Orchestrator/dep-1.result.md`；长时间稳定性、本人日用宿主升级及五端真机验收未做。

## 2026-10-09 升级记录（DEP-1 第二轮：生产升级及 DNS-01 验收成功）

当前生产 release（发布版本）为 `dfe56ec2302df89ebc9f4c4cf27b8a6ef42477e7`，目录 `/opt/weftmate-cloud/releases/dfe56ec2302df89ebc9f4c4cf27b8a6ef42477e7`。这个提交包含安全 AliDNS 运维日志，部署前 PR（拉取请求）#104 六项 CI（持续集成）全部 SUCCESS（成功）。原 release 为 `46b4beccd91827364fc6ff837736bd51f93862f8`；schema（数据库结构版本）4→5→6 成功，独立锁文件安装 40 个生产依赖，Node 24.21.0 / frp 0.71.0 沿用。

本人已授权第二轮部署。新的自动回滚条件只包含核心失败：服务启动、迁移、`/healthz`、OIDC（开放身份连接协议）discovery（发现文档）/JWKS（签名公钥集合）、账号登录链路及其他网站/服务。DNS-01 失败单独报告并保留新版本，不再触发整体恢复。**本轮核心和证书都通过，没有实际回滚。**

新备份 `/root/weftmate-deploy/dep-1-backup-20261009T012948Z` 为 0700、root（管理员）所有。备份范围同第一轮：停 cloud/frps 后完整 StateDirectory（状态目录）、nginx 全部配置、frps、cloud.env、服务单元、current 链接、旧 release 路径及日志配置原不存在标记。实际 dry-run（试运行）通过全部 SHA256（安全散列）、完整数据解包、SQLite（嵌入式数据库）`integrity_check=ok` 与 `nginx -t`。旧版本及备份继续保留。

```sh
backup=/root/weftmate-deploy/dep-1-backup-20261009T012948Z
/root/weftmate-deploy/rollback-upgrade.sh "$backup" --dry-run
# 只在已授权的核心升级故障场景使用；恢复会撤回快照之后的云数据。
/root/weftmate-deploy/rollback-upgrade.sh "$backup"
```

| 验证项 | 第二轮结果 |
|---|---|
| 服务 / 数据 | cloud、frps、nginx 均 active（运行中）；schema 6、迁移序列 1–6、数据库完整性通过；原有三个账号及 identity-keys 与新备份一致 |
| 公开身份 / 中继 | `/healthz` 200/schema 6；OIDC discovery 200且 issuer 正确；JWKS 200、RSA 公钥且无私钥；API/relay 443 标准 CA（证书机构）与域名验证通过，relay TLS（传输层安全协议）1.3 |
| 正式客户端 | `weftmate-apple` → `com.weftmate.apple:/oauth/callback`；`weftmate-android` → `com.memoweft.weftmate:/oauth`。两者均为 native（原生）公开客户端；各自实测 authorization（授权）、login（登录）、resume（授权恢复）、PKCE（授权码校验）/DPoP（设备密钥持有证明）令牌交换 200，`token_type=DPoP` |
| 宿主 / 邮件 | 隔离宿主 `/personal/v1/cloud/config` 200、issuer 正确；邮件只发 `delivered@resend.dev`，请求 200且本服务日志确认 1 次 Resend 接受；未读取验证码或声称完成邮件注册 |
| DNS-01 staging | 隔离临时宿主 `host-fb54b40a-1158-4e18-b929-a2b56ed92449`，域名 `h-3991a665d31bc900c76f13a9f6da35fa.hosts.weftmate.com`；Let's Encrypt staging 签发成功，证书到期 `2027-01-07T00:40:46Z`，随后中继 online（在线） |
| DNS-01 正式 | staging 通过后只正式签发一次；Let's Encrypt YE1 证书到期 `2027-01-07T00:41:15Z`，中继 online、`certificateErrorCode=null`。真实公网内容 443 标准 CA/域名及 `/cloud/config` 200 通过；宿主证书管理器/TLS 适配器检查原内容 SPKI（公钥指纹）与域名匹配 |
| TXT / RecordId | `_acme-challenge.<该临时域>`：staging `2108371667696581632`，正式 `2108371781479740416`。每次从空表→该域的一条持久化 RecordId（记录标识）→空表；present（写入挑战）等待所有权威 TXT 可见、CA 验证成功；完成后两台权威 NS（域名服务器）均无 TXT，数据库无残留 |
| AliDNS 错误码 | 本轮 `dns.provider_failed` 事件 0，无阿里云拒绝码或 RequestId（请求标识）可报告；本轮无需本人修正 RAM（阿里云访问控制）策略、账号 ID 或 AccessKey。上一轮泛化错误的原因仍未被证实，没有把这次成功反推为某种已修复错误 |
| 清理 | 两次隔离验收的合成账号均通过正式注销接口删除；首次请求的 Resend pending（待验证）注册按本轮 challenge（挑战）限定清除；临时宿主解绑、撤销、关闭，临时目录与私钥移除，无正式或测试临时 OIDC 回调残留 |
| 其他服务 / 配置 | 最终 16 个既有 HTTP（网页传输协议）/HTTPS（加密网页连接）入口、证书及其他服务差异 0；只排除本轮重启的六个 WeftMate 内部端口进程 ID。nginx/frps 配置逐字节未变，cloud.env 只有 `CLOUD_OIDC_CLIENTS` 改动，cloud 服务单元及本服务日志命名空间按新版本安装 |

首次网站比较中 `power.weftmate.com` 的单次 HEAD（只取响应头）请求出现 curl exit 6（DNS 解析失败），同轮 GET（读取请求）正常；立即完整复查和最终比较均零差异。首次验收脚本过早读取尚未分配的中继地址而中止，临时资源清理后修正读取时机、重新完整验收成功；没有重发测试邮件或增加正式签发次数。

本地 DNS 单测 6/6 通过，覆盖拒绝码/RequestId 留存、凭据与签名回显过滤、网络/无效响应和既有 RecordId 幂等清理。额外本地入口测试 1/2：Windows 已记录的目录同步 `EPERM` 导致真实启动用例失败；部署前 Linux CI 全绿，生产真实入口启动与线上核心验证通过。最终文档提交的完整 CI 见 [PR #104 checks（检查项）](https://github.com/memoweft/weftmate/pull/104/checks)。

服务器私有证据：`baseline-20261009T012959Z`、`round2-upgraded-recheck-20261009T013756Z`、`round2-final-20261009T014115Z`（均位于 `/root/weftmate-deploy/`）及 `dep-1-dns-evidence.json`。本地无秘密报告在 `.local/dep-1/smoke-core-round2.json` 与 `smoke-result.json`，不进 Git；最终结果覆盖写 `Runtime/Orchestrator/dep-1.result.md`。

未做：本人日用宿主升级、实际网页/桌面正式宿主回调、五端真机与长时间稳定性。当前只登记文档指定的 Apple/Android，未登记虚构/通配符/临时宿主回调。临时证书与私钥随隔离目录清理，成功验收不等于已给本人日用电脑配置远程内容证书。
