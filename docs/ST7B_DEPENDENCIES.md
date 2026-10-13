# 邮箱与日历依赖

新增库均固定版本，协议操作使用开源库，不自行实现邮件或日历协议。运行依赖全部为纯 JavaScript（脚本语言），没有新增原生编译步骤；打包沿现有依赖收集。

| 依赖 | 版本 | 许可证 | 用途与选择理由 |
| --- | --- | --- | --- |
| [ImapFlow](https://imapflow.com/docs/) | 2.4.0 | MIT（宽松开源许可） | 收件、搜索、标记与移动；成熟且持续维护，按需读取指定邮件部件，关闭日志与后台空闲同步。 |
| [Nodemailer](https://nodemailer.com/) | 10.1.0 | MIT-0（无需署名的宽松开源许可） | 加密登录验证和纯文本发送，固定发件人；拒绝文件与地址附件来源。 |
| [Mailparser](https://nodemailer.com/extras/mailparser) | 3.9.38 | MIT | 已限长正文的字符集解析及 HTML（网页标记）转纯文本；不取附件内容。 |
| [tsdav](https://tsdav.vercel.app/intro/) | 2.4.0 | MIT | 日历发现、时间范围查询和带版本条件的增删改；自定义传输仍严格验证证书。 |
| [ical.js](https://github.com/kewisch/ical.js) | 2.2.1 | MPL-2.0（Mozilla 文件级开源许可） | 标准日程解析、生成及重复规则、排除日期、改期例外；库无附加依赖，原文件未经修改，源代码及许可随依赖分发，原始源码见上游链接。账号时区转换使用平台 Intl（国际化接口）。 |
| [smtp-server](https://nodemailer.com/extras/smtp-server) | 3.19.21 | MIT-0 | 仅开发依赖：内存合成发件服务器。 |
| [hoodiecrow-imap](https://github.com/nodemailer/hoodiecrow) | 3.3.1 | MIT | 仅开发依赖：内存合成收件服务器；上游已更名为 imapkit，后续可单独迁移测试夹具。不会进入安装包。 |

2026-10-13 官方 npm（包管理服务）审计命令 `npm audit --audit-level=high --registry=https://registry.npmjs.org --json`：生产与开发依赖共 477 项，0 漏洞。默认镜像不提供审计接口，审计改用官方服务；未修改镜像设置。审计结果是当时依赖树的检查，不代替未来升级检查。

安装后执行 `npm ci`、`npm run vendor:dsh`；不修改 `vendor/`。新增包的许可证文件由正常依赖打包携带。邮箱与日历服务器均为按工具调用读取，没有后台同步或整库缓存。服务子进程在导入协议库前清除调试环境变量，防止开发环境启用库内的凭据日志。

打包实测发现 `mailparser` 的间接依赖 `tlds@1.261.0` 内公共域名标签与构建账号名称偶合。官方 npm 包完整性与锁文件一致，原始 `index.json` 摘要见 `tests/evidence/st-7b/public-data-provenance.json`。包检查仅对这个路径及这份原始数据识别公共数据来源，未改库文件；任何改动、身份插入或其它文件仍按原身份规则检查。固定回归含合成账号 `com`／机器名 `net` 的同名情形、添加用户路径／机器名／源码路径和复制到其它文件的拒绝。首次失败与重新打包成功报告均保留。
