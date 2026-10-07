# Linux 部署草稿 · 待 S0 审查后使用

**S0 不执行这些命令，不 SSH、不修改 DNS、不连服务器。** 文件仅供后续部署工作包审查。现有 weftmate.com 服务器的发行版、现有代理/网站、磁盘与 Node 路径本包均未实查，不能把草稿称为已兼容现场。

## 目录与进程

| 路径 | 内容 |
|---|---|
| `/opt/weftmate-cloud/releases/<commit>/` | 发布包：`services/cloud/` 的内容，root 管理，只读代码 |
| `/opt/weftmate-cloud/current` | 指向当前 release 的链接 |
| `/etc/weftmate-cloud/cloud.env` | root 管理，0600，真实环境配置，不进 Git |
| `/var/lib/weftmate-cloud/` | systemd StateDirectory，数据库/开发邮件；S4 才加密文对象 |
| systemd journal | JSON 操作日志，按系统策略轮转 |

systemd 用 DynamicUser 与 StateDirectory 管理专属账号/写入目录，不用 root 跑 Node。unit 里的 `/usr/bin/node` 必须在目标 Linux 验证为 **Node 24.x** 后再使用；如安装路径不同，修改 unit。S0 只有一个 Node 进程，不装 PM2/Docker/Kubernetes。Caddy 的域名片段只服务控制面；S2 的 frps 内容入口独立 TLS 透传，不能加到此 reverse_proxy 中。

## 后续人工执行顺序

1. 确认 S0 审查通过、实际 Linux/现有网站、Node 24 路径、Caddy 配置、目标 API 域名和 DNS；保留现有网站/代理。DNS 示例为 `api.example.com → 203.0.113.10`，真实值只在服务器配置。Caddy 自动 HTTPS 需要域名正确与验证端口可达。[Caddy 官方说明](https://caddyserver.com/docs/automatic-https)
2. 从已审查提交生成只含 `services/cloud/` 的发布包，执行本服务 `npm ci`，在隔离目录运行 `node --test test/*.test.mjs`。不安装主仓 Electron/DSH；S1a 独立锁定 oidc-provider/jose。禁止打包 `.runtime`、`.env`、identity-keys 或本机数据。
3. 以管理员身份把包解到新的 release，把 `cloud.env.example` 复制到配置目录，填写专属数据目录。正式邮件启用前 file 仅供开发验证，不作为上线注册投递。
4. 安装 unit 与当前链接。以下是**需在目标机审查后才执行**的示意，`<commit>` 由部署者替换：

   ```sh
   sudo install -d -m 0755 /etc/weftmate-cloud
   sudo install -m 0600 cloud.env.example /etc/weftmate-cloud/cloud.env
   sudo install -m 0644 weftmate-cloud.service /etc/systemd/system/weftmate-cloud.service
   sudo ln -sfn /opt/weftmate-cloud/releases/<commit> /opt/weftmate-cloud/current
   sudo systemd-analyze verify /etc/systemd/system/weftmate-cloud.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now weftmate-cloud
   curl --fail http://127.0.0.1:8787/healthz
   ```

5. 把 `Caddyfile.fragment` 作为站点块导入**现有**配置，替换 example 域名；先 `caddy validate --config /etc/caddy/Caddyfile`，再按现场服务方式 reload。外部测试 `https://api.example.com/healthz`；配置防火墙仅暴露实际需要的云入口，Node 端口不公网开放。S2 另审查 frp 的控制入口、内容入口与逐宿主域名。
6. 用 `journalctl -u weftmate-cloud` 检查 start/health/stopped 事件，验证重启后迁移不重复、SIGTERM 能退出。这里不是生产认证验收；S1a 账号接口仅经隔离测试，生产 issuer/客户端 URI/邮件与代理须在部署包验证。

## 升级、回滚与备份

更新前保留旧发布与数据库一致快照。迁移为启动时向前执行；不提供自动向下迁移或覆盖新库。只改变代码而 schema 未变时可停止服务、切回旧 release、重启；已升级 schema 时旧发布会拒绝打开新库，必须用匹配版本或经过确认的恢复流程。恢复快照可能丢失快照后的账号/撤权等写入，由本人确认，不能自动回滚用户数据。

在线快照用 Node 24 `node:sqlite` 的 `backup()` 或 SQLite Online Backup API；不能在 WAL 运行时只 `cp cloud.sqlite`。离线停服务且确认 WAL checkpoint 后也可用一致文件快照。S0 只说明，不建自动备份任务。后续备份脚本需同样使用专属权限，检验快照 `PRAGMA integrity_check`，在隔离目录恢复启动；数据库快照、S4 密文对象、对象清单和控制面签名密钥分别备份。签名私钥/邮件/推送凭据存入独立加密运维备份，禁止进入客户端内容备份。[SQLite 备份说明](https://www.sqlite.org/backup.html)

建议每日一致快照、升级前快照、至少一份异机加密副本；保留周期和异机存储费用待本人决定。日志不写请求体、Cookie、令牌、邮件正文、邮箱或任意 URL；暂不启用 Caddy access log。监控先用 systemd 失败状态、外部 `/healthz`、磁盘/WAL 增长、TLS 到期与备份恢复检查；S1–S3 再加投递/中继断连/推送失败计数。告警渠道、监控外部账号待开通，不自建审计平台。

本包在 Mac 上只验证 Node 服务；systemd/Caddy 草稿未在目标 Linux 运行，frp、APNs、FCM、真实邮件均未接入。
