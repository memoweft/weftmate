# 个人访问服务

`index.mjs` 负责创建和恢复服务、持久化事务队列以及监听与关闭，继续导出 `createPersonalAccessService`、`explicitNotepadOpenIntent`、`uniqueSessionOwner`。HTTP（超文本传输协议）路径、请求/响应和存储格式沿用拆分前的行为。

| 模块 | 职责 |
|---|---|
| `authentication.mjs` | 认证、密码、账户资料、设备与设置授权 |
| `sessions.mjs` | 会话归属、历史投影、同步对话与上下文 |
| `commands.mjs`、`tasks.mjs` | 命令调度、任务状态、停止与执行回执 |
| `approvals.mjs`、`user-questions.mjs` | 工具审批、用户提问及回答交付 |
| `workspaces.mjs`、`artifacts.mjs` | 项目/浏览器来源、工具入口与成果保存 |
| `account-models.mjs` | 账户模型可见性、配置操作与恢复 |
| `http.mjs`、`memory-http.mjs` | 请求分发与记忆代理 |
| `store.mjs` | 持久化、格式验证与旧格式迁移 |
| `constants.mjs`、`common.mjs`、`command-policy.mjs`、`interaction-policy.mjs` | 原有常量、公共函数与输入/回执验证 |

模块工厂接收同一个 context（上下文对象）。其中的 getter（取值访问器）和 setter（赋值访问器）连接原服务中的实时状态，保证账户更新、队列、关闭和恢复仍读取当前值。各模块创建时只组装函数；实际操作仍由原来的调用时机和队列驱动。

云身份接线集中在 `../personal-cloud/`（见其 README）；原 store 只增加 cloud 会话设备类型，不在账号结构塞云映射。原认证/同步/DSH 来源检查接受已批准云 Cookie，并保留本地 epoch；云 epoch/设备信任与绑定恢复由独立日志负责。
