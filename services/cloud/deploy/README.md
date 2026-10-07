# 云服务与中继部署 · D1

2026-10-07 已部署 Node 24.21.0、官方 frp 0.71.0、cloud schema 4。现场沿用 Ubuntu nginx，公网 TCP 443 使用 stream（TCP 流代理）+ ssl_preread（读取 TLS 握手名称）；HAProxy/Caddy 文件保留为旧 S2 隔离验证夹具，生产使用本目录 nginx 配置。真实地址、邮箱、密钥、密码、证书和运行数据只在服务器私有文件或仓库外运行目录。

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

**内容证书仍待开通**：hosts DNS 已就绪，但 cloud 的生产 DNS-01 provider 尚未接线，RAM DNS 子账号密钥也未提供。`main.mjs` 不会因放入 RAM 环境变量就自动启用 provider；须后续实施包把受限 `relayDns.present/cleanup` 接到阿里云，再由本人把最小 DNS 权限凭据放服务器私有配置。不能把整区密钥交给宿主，也不能给内容域名在 nginx 终止 TLS。内容 CSR（证书签名请求）、相同 key 的定时重签/安装/热载步骤见 [宿主中继 README](../../../src/personal-relay/README.md#生产-dns-01)。普通 `certbot renew` 不维护外部 CSR。

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
