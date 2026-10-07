# UNIFIED_ASSISTANT_03：账户登录与多设备管理

日期：2026-09-26。状态：开发自测通过／待云试用。用户已确认个人一个账户、多设备登录；本卡是多设备接入的账户与界面补充，安卓完整客户端仍按总路线继续。

## 本轮用户得到什么

- 在页面里设置自己的账户和密码。
- 在不同设备用同一账户登录，查看已添加设备与当前设备。
- 移除其他设备、退出当前设备、修改密码。
- 对话和任务沿用原有数据；设备内部凭据由软件管理。

用户不需要把密码发送到聊天或终端。首次建户由本机宿主签发一次性设置授权，进入页面后由用户自行输入。

## 账户与数据决策

1. 当前只有个人一个账户。沿用稳定 ownerId；不增加公开注册、多租户、邮箱或短信功能。
2. 旧存储先严格校验，再原子迁移；原会话、命令、设备标识保留。迁移本身不清空数据。首次成功启用账户密码时撤销旧手工凭据，保留设备记录并要求重新登录。
3. 密码只保存随机盐和强哈希。采用 Node.js 已有的异步 scrypt（密码派生算法），参数按当前公开建议设置，验证格式与资源上限；不保存明文或可逆密码。
4. 账户密码输入支持长密码短语。密码本身不修剪空白，不强制符号组合；单因素最少15字符，最多128字符。
5. 登录后每台设备获得独立、可撤销、有绝对到期时间的会话。浏览器使用 HttpOnly cookie（脚本不可读取的会话凭据），写操作检查来源和请求防伪；旧原生凭据兼容边界明确。
6. 首次设置授权短时、一次性、只从本机管理通道签发；公网不可抢先注册。授权片段读取后立即从页面网址清除，不进入普通日志。
7. 修改密码须验证旧密码，撤销其他旧会话并轮换当前会话；撤销与登录、修改密码的并发必须重新核对账户版本和授权状态。
8. 登录失败限速，错误不泄漏账户是否存在；慢哈希不占用存储写锁。继承上一轮私有目录、损坏拒绝、关闭和存储故障边界。

密码存储与长度取值参考 [OWASP密码存储建议](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[OWASP认证建议](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)及 [Node.js 24密码学接口](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)。运行参数和正式接口以代码为准。

## 界面范围

同源 `/personal/v1/ui` 页面包含账户设置、登录、账户摘要、设备分组、移除设备、退出和改密。使用 v1.2 的轻量蓝白、留白和分组设置语言，沿用现有技术；移动尺寸使用单层页面。公开静态资源严格白名单，动态内容转义，不加载第三方脚本。

正常流程不显示内部哈希、令牌、端口或运行库信息。设备只显示有依据的登录/访问时间和会话状态，不把最近登录冒充实时在线。当前公网未发布，真实手机接入另验。

## 写入归属

| 责任 | 负责人 | 范围 |
| --- | --- | --- |
| 账户、会话与迁移核心 | GPT-6 Sol · 接入核心 | `src/personal-access/` 与账户/核心测试 |
| 页面、静态入口、本机设置授权接线 | GPT-6 Sol · 宿主与账户页面 | `src/personal-access-ui/`、main/启动器及相关测试 |
| 方案、当前文档、独立验收 | 主助手 | 当前正式文档、本卡、隔离接口与浏览器验收 |

代码与测试由子Agent（子智能体）完成。唯一文件写者，保留无关脏改动；不提交推送，不改共享权限helper或依赖，除非有具体必要并先协调。

## 最终验收结果

| 层级 | 验证内容 | 状态 |
| --- | --- | --- |
| 密码与授权 | 强哈希、错误登录、限速、过期/重复设置授权、跨站请求拒绝 | 核心测试通过 |
| 多设备 | 两个客户端登录、共享账户、移除一台、退出、改密后旧会话失效 | 真实 Electron + HTTP 通过，跨浏览器撤销通过 |
| 数据连续性 | v1迁移与重启，原owner/session/command不变，旧凭据正确退役 | 核心迁移测试通过；上一轮实际v1资料启动迁移后owner/三设备/原会话保持 |
| 生命周期 | 关闭、写入失败、慢哈希/撤权/改密并发，不放松已有门控 | 核心/私有存储组及宿主组通过 |
| 实际宿主 | 正式rc.5与全新隔离数据、本机管理与真实HTTP | 主助手独立通过；测试实例均受管退出 |
| 浏览器 | 登录/设备撤销/退出、刷新续登、错误状态、窄屏布局 | Chrome与应用内浏览器通过；390px无横向溢出；改密空表单可打开关闭，实际改密提交仅HTTP测试 |
| 用户体验 | 用户亲自设置密码与实际手机登录 | 本机空白候选待用户设置；真实手机与公网未验 |

最终核心作者回归26/26，主助手独立宿主与旧接入回归24/24，无跳过；类型和差异检查通过。命令分别为：

```powershell
node --test --test-concurrency=1 tests/personal-access-account.test.ts tests/personal-access-core.test.ts tests/private-host-storage.test.ts
node --test --test-concurrency=1 tests/personal-account-electron.test.ts tests/personal-access-ui.test.ts tests/personal-access-electron.test.ts tests/personal-access-host.test.ts tests/personal-host.test.ts tests/personal-host-restart.test.ts tests/stage2-session-guards.test.ts
npm run typecheck
git diff --check
```

两位 GPT-6 Sol 交叉只读审查，在集中修复后无新增明确P1/P2。修复内容：改密保持deviceId/enrolledAt并轮换凭据，当前设备旧pending命令原子置为`SESSION_REPLACED`，dispatching保持实际状态；公开来源必须显式信任回环代理并核对HTTPS、转发Host与配置来源，首次设置仍拒绝所有代理。

测试仅用合成账户和隔离资料，没有发送真实模型请求。主助手用真实Chrome鼠标操作、应用内浏览器键盘提交，完成两个独立cookie环境的同账户登录和撤权；应用内浏览器坐标/截图尺寸不可靠，因此布局以真实Chrome的1180px与390px为证。测试资料在 `Runtime/UnifiedAssistant/account-validation-20260926`，18187已退出。旧18186/PID28916正常关闭后，用原 `access-validation-20260926` 启动新源码，实证v1→v2迁移，再正常关闭，原目录保留。

验收摘要与源码哈希：相邻 `Runtime/UnifiedAssistant/account-verification-20260926.json`；实际页面截图：同目录 `account-desktop-20260926.png`、`account-mobile-20260926.png`。截图显示合成账户，不是用户已设账户的证明。

## 用户试用入口与操作

候选入口：`http://127.0.0.1:18186/personal/v1/ui`。专用空白目录为相邻 `Runtime/UnifiedAssistant/personal-account-20260926`，没有合成账户、旧测试设备或私人历史；当前监听PID8484，后续操作前须重新核对。启动器受管会话5718，`q`正常退出。重启使用：

```powershell
node scripts/run-personal-host.mjs --user-data-dir D:\AIProjects\WeftMate\Runtime\UnifiedAssistant\personal-account-20260926 --access-port 18186
```

首次设置由启动器输入 `{"action":"account.setup","open":true}` 打开浏览器；授权10分钟有效，进入页面即清除地址片段。密码由用户亲自填写，不发送到聊天。失效后从本机重新签发，不能公开注册或网络重置。

1. 在已打开的“设置个人账户”页输入账户名、15–128字符密码和本机名称；成功后显示账户与当前设备。
2. 刷新页面仍保持登录；退出后用同一账户密码重新登录。另一浏览器可以作为第二个本机设备试用，真实手机需等公网接通。
3. 撤销另一浏览器的设备记录；它刷新后应回到登录页，当前页面仍可使用。
4. 修改密码后当前设备保持登录，其他设备须用新密码登录。此步骤用户自行操作；HTTP测试已验证旧密码和旧凭据失效。

如果页面断开，先核对本轮宿主是否仍在运行，再用同一目录重启。不要删除或改写store；用户已设账户后不再签发首次设置授权。当前没有忘记密码找回流程。

## 防火墙与公网

用户已授权核实后直接开放 WeftMate 所需端口/程序规则。已实查 Caddy TCP443 的入站允许规则启用且覆盖全部配置文件，因此本轮无需重复添加。现行部署说明公网8443映射本机443。

上一轮部署命令被 Defender 恶意软件检测拦截，属于另一类防护。此次防火墙授权不等于关闭防护或绕过该事件；本轮未修改Caddy、DNS或防护策略。正式main未配置`allowedOrigins`/`trustedProxy`，旧Caddy候选也需结合此接线重新验证，不能仅加路由就称公网账户可用。

## 修复预算与收口

本轮预设最多两轮集中修复，核心审查问题在一轮内修复并复验；页面在冻结前修正已观察到的按钮换行。代码现冻结，交付空白账户页待云试用。本机自测不等于用户通过、公网可用或手机独立能力完成。
