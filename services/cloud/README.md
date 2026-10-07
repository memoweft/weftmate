# WeftMate Cloud · S0

Node **24.x**、ESM、零 npm 依赖的独立服务。设计与后续范围见 [docs/CLOUD.md](../../docs/CLOUD.md)。本包只实现健康检查、配置、数据库迁移、JSON 日志与开发邮件传输；账号、令牌、中继、推送、内容备份均未实现。

## 本地运行

从主仓进入本目录，不需要主仓的 Electron、DSH vendor 或 `npm ci`：

```sh
cd services/cloud
node --version
node src/main.mjs
```

另一个终端：

```sh
curl --fail http://127.0.0.1:8787/healthz
```

返回 `{"status":"ok","service":"weftmate-cloud","schemaVersion":1}`。Ctrl+C / SIGTERM 关闭 HTTP 和数据库。也可用 `npm start`。本地默认 HTTP 仅监听回环；公网 TLS 由部署草稿中的 Caddy 提供。

## 配置

配置只读环境变量；不会自动读取 `.env`。需要文件时，先复制 `.env.example` 为受忽略的 `.env`，再用 Node 24 的 `node --env-file=.env src/main.mjs`。示例文件里的发件人仅用于开发。

| 变量 | 默认值 | 含义 |
|---|---|---|
| `CLOUD_HOST` | `127.0.0.1` | 监听地址；systemd + Caddy 保持回环 |
| `CLOUD_PORT` | `8787` | 整数 0–65535；0 由 OS 分配，便于隔离验证 |
| `CLOUD_DATA_DIR` | `.runtime` | **专属**云数据目录；相对当前工作目录解析 |
| `CLOUD_MAIL_TRANSPORT` | `file` | S0 只支持 file，其他值启动失败 |
| `CLOUD_MAIL_FROM` | `WeftMate <no-reply@example.com>` | 开发邮件发件人 |
| `CLOUD_MAIL_DIR` | `<CLOUD_DATA_DIR>/mail-outbox` | 私有开发邮件目录；显式相对路径也按当前工作目录解析 |

不要把 `CLOUD_DATA_DIR` 或 `CLOUD_MAIL_DIR` 指向现有个人资料、仓库根、系统目录或共享目录：服务会将它们设为 0700。数据库为 `<CLOUD_DATA_DIR>/cloud.sqlite`，0600；入口 umask 为 0077，SQLite WAL/SHM 随之保持私有。Windows 本地文件访问还需由系统 ACL 保护；部署目标是 Linux。本地默认 `.runtime/`、`.env`、SQLite 文件均忽略，外部目录也不得手工提交。

`src/mail.mjs` 提供 `createMailer(config).send({to, subject, text}) → {id}`；file 传输每封写一个 0600 JSON 并 fsync，仅记录邮件 ID，不记录地址、验证码或正文。文件写入成功表示开发投递完成，**没有发送真实邮件**。S1 在同一接口接真实服务商；S0 没有公开发邮件 HTTP 路由。

## 数据库与日志

`node:sqlite` 的 `DatabaseSync` 用于短小控制面操作，启用 foreign_keys、WAL、FULL 同步与 SQLite 的 busy_timeout。备份对象不写 SQLite 大 BLOB。`node:sqlite` 的稳定性以实际 Node 24 小版本为准，升级时跑本套测试；本地验证使用 24.21.0。[Node 24 文档](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

`migrations/NNN-name.sql` 从 001 连续递增。每个文件和迁移登记在同一事务内，失败整项回滚；成功项重开不重复执行。已应用文件不能编辑；记录的名称/校验和或数据库版本不匹配当前发布时启动失败，防止旧发布误开新库。SQL 文件不嵌入 BEGIN/COMMIT，不从请求加载 SQL。修订只加下一编号；先备份，再升级。001 仅建立服务元数据，不提前实现 S1 表。

stdout 每行一个 JSON：`time,level,service,event` 加少量操作字段。健康失败返回 503，未知路径 404，`/healthz` 非 GET 返回 405。日志只记录 `/healthz` 或 `unmatched`，不记录原 URL、查询串、请求头、请求体、邮箱或异常堆栈。`GET /healthz` 反映本服务数据库可读，不代表邮件/宿主/模型在线。

## 验证

```sh
node --test test/*.test.mjs
```

全部测试使用 OS 临时目录、随机端口和 example.com 账号，无真实邮件/宿主/模型或服务器连接。14 项覆盖配置、数据库重开/幂等/增量迁移/回滚/版本不匹配、开发邮件与私有权限、日志敏感字段、真实 HTTP 200/404/405/503、入口启动/SIGTERM/错误退出。Linux CI 在主仓 `.github/workflows/ci.yml` 的 Linux 任务中、安装主仓依赖之前运行同一条命令，工作目录仅为 `services/cloud`；不加其他平台的 cloud 步骤。GitHub Actions 若因私仓付款/额度暂停，应引用本地结果，不能称远端 CI 通过。

部署文件是 [deploy/README.md](deploy/README.md) 中的审查草稿，本包不安装 systemd/Caddy、不部署、不连接线上服务器。
