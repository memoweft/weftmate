# 客户端契约：`/personal/v1`

> M0-5 基线：`main` 提交 `28b5d36`，按当前服务端行为整理；以后拆文件不改变这里的路径与语义。M0-5 首次建立文档基线；M0-3 / M1-0a 更新历史与时间线实现，不修改 Swift。实现核对来源：`src/personal-access/`、`src/personal-access-backend.mjs`、`src/personal-memory/http.mjs`、`src/personal-sync/`；客户端来源见下表。
> M0-3 / M1-0a 已实现：历史尾页、向前翻页、正向增量与对话时间线；Apple 保留旧正向读取，待 A1 / M1-0d 接入。产品决定见 [PLAN.md](PLAN.md) D5–D8、M0-5、M1-0；呈现规则见 [UI_SPEC.md](UI_SPEC.md)。

## 1. 范围与通用约定

第 3、6 节覆盖 **90 个本机业务方法/路径组合**（第 3 节 86 项 + 第 6 节健康 4 项）与 **12 个桌面 UI 静态路径**；第 7 节另列云账号、宿主身份与中继。同一路径的不同 HTTP 方法分别计数；`/commands` 的不同 `kind` 不重复计数，参数化资源路径计一种。表中路径均省略 `/personal/v1` 前缀，`{id}` 为调用方填入的资源标识；示例用短 ID 与示意哈希，真实请求须满足格式约束。响应示例仅保留关键字段，`Auth`、`Command`、`Task`、`Receipt` 等对象的 JSON 例子见第 2 节。未写查询参数的接口不要加查询串。

| 客户端标记 | 本次核对来源与含义 |
|---|---|
| 桌 | `src/personal-access-ui/app.js`，桌面/浏览器 Web UI |
| 手 | `apps/mobile-ui/www/app.js`，通过 Android 原生 bridge 间接调用；不是独立浏览器 HTTP 客户端 |
| 安 | `apps/android/app/src/main/java/com/memoweft/weftmate/mobile/` 的 `Network.kt`、`HybridActivity.kt`、`MobileUiBundles.kt` 等；「安（能力）」表示有原生请求方法/bridge，但手机 Web UI 未见该操作入口 |
| 苹 | `apps/apple/Packages/WeftMateCore/Sources/WeftMateCore/PersonalClient.swift` 及其请求/响应模型；表示 Core 可调用，不能据此认定 macOS/iOS/Watch 每个界面都已使用 |
| — | 上述四类入口未见调用；服务端保留。静态资源另外核对宿主页加载 |

| 约定 | 当前行为 |
|---|---|
| 账号与宿主 | 账号范围来自凭据；不由请求体的 `ownerId` 选择。`hostId` 是执行目标，不是登录设备 ID。资源只在当前账号中查找 |
| 认证 | 密码登录发 `Set-Cookie: wm_personal_session=…; Path=/personal/v1; HttpOnly; SameSite=Strict; Max-Age=2592000`，HTTPS 下有 `Secure`。原生端保存 Cookie，浏览器自动携带。旧设备 Bearer 仍可读/写所授予范围，不能管理账号；Cookie 与 Bearer 同时携带报 `AMBIGUOUS_AUTH` |
| 权限 | 一般读取需 `sessions:read`，写入需 `commands:write`；账号管理、记忆变更、模型管理等还需 `account:manage`，只能 Cookie。设备撤销、过期或密码轮换后旧凭据返回 401 |
| Origin / CSRF | 登录/注册/设置账号需同源 `Origin`；所有 Cookie 写入需同源 `Origin` + `X-WeftMate-CSRF: <csrfToken>`。原生端同样发送。GET 可以省略 Origin，若发送必须匹配。`auth/setup` 还必须使用宿主直接地址 |
| JSON | `Content-Type: application/json`（可带 `charset=utf-8`）；通常体 ≤12 KiB，特例见表。多数控制体拒绝未知键，路径不接受双斜线或 `token` 查询参数；记忆 ID 可单次 URL 编码，禁止编码斜线、反斜线及二次编码 |
| ID | 通用资源 ID：`[A-Za-z0-9_-]{1,128}`；`requestId`：`[A-Za-z0-9_.:-]{1,128}`；审批与提问 ID 为 UUID；`modelProfileId` 可含点、下划线、连字符；记忆 ID 可含点和冒号，≤512 字符。同步 ID 为 UUID，可带一个允许的前缀 |
| 重试 | 命令/审批/提问/模型/记忆写入用原 `requestId` 和原体核对、重试；同 ID 不同内容通常 409。`202` 是登记/排队，不是完成；`accepted_by_dsh` 也是接收状态。停止与审批应再读实际状态 |
| 错误 | 通常为 `{"error":{"code":"INVALID_REQUEST"}}`；记忆变更的 409 也可能为正常 `{"receipt":…}`，必须先区分。命令登记成功后的失败在 `command.errorCode` 中，不一定有 HTTP 错误 |

所有表行继承通用错误：400 `INVALID_REQUEST`/`AMBIGUOUS_AUTH`，401 `UNAUTHORIZED`，403 `FORBIDDEN`/`ORIGIN_NOT_ALLOWED`，413 `BODY_TOO_LARGE`，415 `UNSUPPORTED_MEDIA_TYPE`，503 `SERVICE_CLOSING`/`SERVICE_UNAVAILABLE`/`STORAGE_UNAVAILABLE`；后端调用还可能 503 `BACKEND_UNAVAILABLE / BACKEND_TIMEOUT`。行内仅列主要领域错误。未知路由/不支持的方法通常 404 `NOT_FOUND`，不是统一 405；已开始的 SSE/下载失败可能直接断流，应检查终止标记或字节数。

## 2. 公共响应形状（简化示例）

下面均为 JSON；表中 `Auth` 等名字仅是文档缩写，不是协议字段。

```json
{
  "account": {"ownerId":"owner-…","username":"tester","displayName":"测试账户","avatar":null,"profileRevision":0},
  "device": {"id":"device-…","name":"iPhone","expiresAt":"2026-11-06T00:00:00.000Z"},
  "csrfToken":"<token>"
}
```

`Auth`：注册/登录/`me`/改密返回上例；`PATCH /auth/profile` 的 `account` **没有** `ownerId`，调用方保留已验证的账号身份。

```json
{
  "commandId":"cmd-…","requestId":"request-1","kind":"session.message",
  "targetDeviceId":"host-…","sessionId":"session-…","state":"accepted_by_dsh",
  "receiptId":"rpc-…","taskLabel":"整理文件",
  "createdAt":"2026-10-07T00:00:00.000Z","updatedAt":"2026-10-07T00:00:01.000Z"
}
```

`Command`：`state` 为 `pending / dispatching / accepted_by_dsh / accepted_by_host / observed / uncertain / rejected`；可有 `errorCode`、`intent:"steer" / "queue"`、`rootTaskId`、`taskAction`、`conversationId`、`sourceSyncEventId`、附件元数据、项目/浏览器字段。`desktop.write_artifact` 成果命令另含 `taskId,artifactId,fileName,contentType,size,sha256,verification`；只有 `observed` 且校验通过才可下载。模型命令不在此对象中。

```json
{
  "taskId":"cmd-…","sessionId":"session-…","sourceText":"整理文件","source":{"commandId":"cmd-…","kind":"session.message","state":"accepted_by_dsh"},
  "artifacts":[],"steps":[],"executionSteps":[],"sources":[],"supplements":[],"resumes":[],
  "replyEvidence":{"status":"streaming","turn":1,"assistantChunks":2,"textChunks":2,"reasoningChunks":0,"assistantMessages":0,"toolSaveObserved":false},
  "control":{"state":"active","updatedAt":"2026-10-07T00:00:01.000Z","backgroundJobs":{"active":0,"unconfirmed":0},"canSupplement":true,"canStop":true,"canResume":false}
}
```

`Task`：`taskId` 是根 `session.message` 的 `commandId`，GET 返回对象本身，停止/补充/续做响应包在 `task` 内。`steps` 是旧桌面动作，`executionSteps` 是执行元数据（`executionId,sourceCommandId,sourceReceiptId,rootCallId,callId,toolName,turn,state,startedAt,updatedAt`，可有结束/后台 job 字段），尚非 M1 时间线。`control.state` 为 `active / stop_requested / uncertain`；停止后另有 `stopStatus,pendingReceipts,stopRequestedAt,stopObservedAt,reasonCode` 等，依 `canResume` 判断续做。回复 `status` 为 `waiting / streaming / completed / aborted / blocked / failed / unconfirmed`，输出耗尽可含 `endReasonKind:"max-tokens"`。

```json
{
  "ownerId":"owner-…",
  "receipt":{"commandId":"memory-command-…","requestId":"memory-1","state":"applied","worldRevision":8,"storageCleanup":{"state":"pending","detailCode":"checkpoint_pending"}}
}
```

`Receipt`：`state` 为 `applied / no_change / revision_conflict / rejected`；后两者在提交响应中 HTTP 409，可带 `reasonCode`；效果已应用与底层清理完成是两个事实。记忆所有响应均有顶层 `ownerId`，后面的表为紧凑省略它。

## 3. 现有接口

### 3.1 认证与账号（8）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/auth/state` | 无；公开 | 200 `{"configured":true,"registrationAvailable":true}` | — | 桌、手、安 |
| POST `/auth/setup` | `grant,username,password,deviceName`；公开，仅直接宿主同源 | 201 `Auth` + Cookie | 401 `INVALID_SETUP_GRANT`；409 `ACCOUNT_ALREADY_CONFIGURED / ACCOUNT_ALREADY_EXISTS` | 桌 |
| POST `/auth/register` | `username,password,deviceName`；可选 `displayName`；公开 | 201 `Auth` + Cookie | 409 `ACCOUNT_ALREADY_EXISTS`；429 `CAPACITY_LIMIT` | 桌、手、安、苹 |
| POST `/auth/login` | `username,password,deviceName`；公开 | 200 `Auth` + Cookie | 401 `INVALID_CREDENTIALS`；429 `LOGIN_RATE_LIMITED / DEVICE_LIMIT` | 桌、手、安、苹 |
| GET `/auth/me` | Cookie，需账号管理范围 | 200 `Auth`，刷新 CSRF | 401 `UNAUTHORIZED` | 桌、手、安、苹 |
| PATCH `/auth/profile` | `expectedRevision`；至少一个 `displayName / avatar`；体 ≤192 KiB | 200 `{"account":{"username":"tester","displayName":"测试","avatar":null,"profileRevision":1}}` | 409 `REQUEST_CONFLICT` | 桌、手、安 |
| POST `/auth/logout` | 客户端发 `{}`；撤销当前设备 | 200 `{"ok":true}` + 清 Cookie | 401 `UNAUTHORIZED` | 桌、手、安、苹 |
| POST `/auth/change-password` | `currentPassword,newPassword` | 200 `Auth` + 新 Cookie；其他设备凭据失效 | 401 `INVALID_CREDENTIALS`；429 `LOGIN_RATE_LIMITED` | 桌、手、安 |

用户名 NFKC/trim 后 3–64 个 Unicode 字符，仅字母/数字/`_.-`；密码 15–128 个 Unicode 字符；设备名 trim 后非空、≤128 个 UTF-16 单元。昵称 NFKC/trim 后 ≤64 个 Unicode 字符。`avatar` 为 `null` 或 `{"mimeType":"image/png","dataBase64":"…"}`，支持 PNG/JPEG/WebP，解码 ≤128 KiB。

### 3.2 设备与宿主状态（4）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/auth/devices` | 无，Cookie 管理 | 200 `{"devices":[{"id":"device-…","name":"iPhone","createdAt":"…","lastSeenAt":"…","expiresAt":"…","revoked":false,"current":true}]}` | — | 桌、手、安、苹 |
| PATCH `/auth/devices/{deviceId}` | `{"name":"书房电脑"}` | 200 `{"device":{"id":"device-…","name":"书房电脑","revoked":false}}` | 404 `NOT_FOUND` | 桌、手、安 |
| DELETE `/auth/devices/{deviceId}` | 无；客户端可发 `{}`；撤销当前设备会清 Cookie | 200 `{"revoked":true}` | 404 `NOT_FOUND` | 桌、手、安 |
| GET `/status` | 无 | 200 `{"ownerId":"owner-…","hostId":"host-…","sync":{"available":true},"downloads":{"android":true},"backend":{"runtime":"ready","referenceScan":"ready","capabilities":{"chat":{"available":true}},"modules":{"memory":"connected"}}}` | 后端错误 | 桌、手、安、苹 |

`backend.capabilities` 还含 `desktopOpenApp,naturalLanguageDesktop`；`modules` 含 `memory,mods,tasks,notifications,workspaces,capabilities`。这些是能力/状态字段，不代表存在同名 HTTP 路由。FX-9 增加可选 `executionAccount:boolean`，表示当前账号是否为这台电脑的执行账号；`false` 时仅可聊天，界面须说明不能操作电脑或读取原账号资料。旧宿主缺字段时按既有能力投影处理。

### 3.3 会话列表与管理（12）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/sessions` | 可选单值 `archived=false`（默认）、`true`（仅归档）、`all`（全部）；无列表分页/搜索参数 | 200 `{"sessions":[{"sessionId":"session-…","title":"资料整理","running":true,"sendAvailable":true,"archived":false,"modelProfileId":"local","processing":{"phase":"queued","ahead":1,"modelName":"Muse Q5"}}],"snapshotAt":"2026-10-09T00:00:00.000Z"}` | 后端整体失败/单会话降级 | 桌、手、安、苹 |
| PATCH `/sessions/{sessionId}/metadata` | `pinned?,unread?,title?,groupId?,projectId?`，至少一项；布尔值、非空标题≤256字符；groupId为本账号分组ID或null | 200 `{sessionId,pinned?,unread?,title?,groupId?,readMessageSeq?}`；原生 `sessionTitle.rename` 写用户标题，停止自动标题覆盖；手动已读记录最新助手消息水位 | 400 INVALID_REQUEST；404 SESSION_UNAVAILABLE / NOT_FOUND；409 SESSION_BUSY | 桌、手、安、苹 |
| POST `/sessions/{sessionId}/fork` | 空对象 `{}`；原对话须空闲 | 201 `{sessionId,title}`；原生 DSH（助手运行时）事件种子及 parentSession 分叉谱系创建可继续的独立对话，标题加「（分叉）」；复制独立工作目录与经验，继承模型、分组或项目绑定；项目文件夹不复制，普通对话复制独立工作目录；不复制 MemoWeft（记忆核心）的记忆来源/绑定，原对话不变 | 404 SESSION_UNAVAILABLE；409 SESSION_BUSY；503 BACKEND_UNAVAILABLE | 桌、手、安、苹 |
| POST `/sessions/{sessionId}/message-branches` | `{requestId,seq,action:"edit"\|"regenerate",modelProfileId?}`；`seq` 是原生用户 / 助手消息锚点；仅本人可写的空闲旁聊 | 201 `{sessionId,title,modelProfileId,sendRequestId,text,groupId,action,sourceSessionId,sourceSeq,inputSourceSessionId,userSeq,seedThroughSeq,attachments?,originalAttachments?,attachmentMessageId?}`；原生事件种子在对应用户消息的回合开始前截断，旧回复及后续回合不进入新版本；`text` 是原始用户输入，编辑时由客户端替换。仅创建分支，尚未发起推理 | 409 SESSION_BUSY / SESSION_READ_ONLY / MAIN_CHAT_PROTECTED / REQUEST_CONFLICT；404 SOURCE_UNAVAILABLE / SESSION_UNAVAILABLE；422 MODEL_UNAVAILABLE | 桌、手、安；苹待接 |
| GET `/sessions/{sessionId}/message-branches` | 无 | 200 `{groups:[{groupId,action,sourceSessionId,sourceSeq,versions:[{sessionId,anchorSeq? ,afterSeq?}]}]}`；第一项为原版，其余按创建顺序；原版用 `anchorSeq`，新版本用 `afterSeq` 后第一条同角色消息定位 | 404 SESSION_UNAVAILABLE；409 SESSION_READ_ONLY | 桌、手、安；苹待接 |

UX-4：创建分支后，通过原有 `/commands` 发送 `kind:"session.message",targetDeviceId,sessionId,text,mode:"queue"`，**必须使用返回的 `sendRequestId`**，并带回返回的附件字段。宿主复制已上传原件与模型原先读取的材料，不从用户文件夹重新读取附件；图片材料从原生历史附件取回，文字材料按原暂存大小及哈希核对。本人用户消息通过原生回执与输入哈希核对后恢复本人原文，编辑读取原生锚点，避免历史摘要 / 旧缓存改变输入。分支继承模型（可显式换模型）、项目 / 分组、审批模式、临时记忆设置和深入思考；已有对话的模型不改变。分支 `requestId` 同体重试复用同一分支，异体返回 REQUEST_CONFLICT；消息送达不确定时先查 `/commands/by-request/{sendRequestId}` 再重放同一消息体。原分支及后续历史保留，切版只是打开另一个 `sessionId`。删除来源 / 版本或遗忘时清除对应派生分支回执，不用旧回执还原原话。

主对话遵循 D42 / IA：编辑称「从这里开旁聊并重发」，重新生成同样开旁聊。使用既有 `session.side.create`，`originChatId/originEventId` 指向所选消息，父级为本账户主对话；原主对话保留，以来源引用带上下文，不做整条主对话分叉，也不创建主对话版本切换。重新生成先按逻辑历史找到锚点前的用户消息，支持跨执行段。新旁聊创建回执被受理后再发修改后的 / 原始用户输入。

UX-4 的有用 / 没用反馈仅存当前设备、当前账号的本机记录（`version,sessionId,seq,rating,reason,note,at`；手机本机记录用 `source:"phone",conversationId,messageId` 代替宿主锚点）；没有上传反馈的 HTTP 路由。Windows（视窗系统）通过已有原生加密偏好存储持久化反馈，避免程序随机端口变化丢记录；网页 / 安卓在设备存储保存。导出复用完整历史分页，主对话用跨段 `/chats/{id}/events`；客户端脱敏后预览并保存 Markdown（标记文本）/ PNG（图片文件），工具步骤默认不含，附件仅列名称。安卓新增系统保存文件桥，界面包最低原生 code27。Apple（苹果端）须用相同消息锚点、回执与版本关系，反馈留设备端，导出前沿用凭据 / 本机路径脱敏与预览边界。
| GET `/session-groups` | 无查询 | 200 `{groups:[{id,name}]}`，仅当前账号 | — | 桌、手、安、苹 |
| POST `/session-groups` | `{name}`，去首尾空白、非空、≤256字符 | 201 `{group:{id,name}}` | 400 INVALID_REQUEST | 桌、手、安、苹 |
| PATCH `/session-groups/{id}` | `{name}`，同上 | 200 `{group:{id,name}}` | 404 NOT_FOUND | 桌、手、安、苹 |
| DELETE `/session-groups/{id}` | 空对象 `{}` | 200 `{deleted:true,id}`；成员会话移至未分组，保留全部内容 | 404 NOT_FOUND | 桌、手、安、苹 |
| POST `/sessions/{sessionId}/archive` | 空对象 `{}` | 200 `{sessionId,archived:true}`；幂等归档，保留历史、经验与工作目录 | 404 `SESSION_UNAVAILABLE` | 桌、手、安、苹（A7 已接入） |
| POST `/sessions/{sessionId}/unarchive` | 空对象 `{}` | 200 `{sessionId,archived:false}`；幂等恢复 | 404 `SESSION_UNAVAILABLE` | 同上 |
| GET `/sessions/{sessionId}/forget-preview` | 无；Cookie 与 `account:manage` | 200 `{ownerId,worldRevision,itemCount,evidenceCount,evidenceIds,items:[{id,kind,text,itemType}]}`；只读，预览该对话全部来源遗忘的级联范围 | 404 `SESSION_UNAVAILABLE`；503记忆不可用 | 同上 |
| DELETE `/sessions/{sessionId}` | `{forgetMemories:false}`（默认，可省略）；勾选遗忘可另传 `deleteConversationSnippets:false`（默认）及预览的 `memoryWorldRevision` | 200 `{sessionId,deleted:true,forgetMemories,forgottenEvidenceCount}`；永久删除对话日志、宿主记录、生成成果及专属工作目录，运行中先停止 | 409 `SESSION_BUSY`（执行或回执尚未确认，稍后重试）；503 `BACKEND_UNAVAILABLE`；勾选遗忘还可返回503 `MEMORY_DELETE_UNAVAILABLE`、409 `MEMORY_DELETE_CONFLICT` | 同上 |

普通会话与项目 / 浏览器 / 接管会话均返回已绑定的 `modelProfileId`；旧会话无法确定时可为 `null`。A5 修复普通会话曾漏掉该既有字段、导致 Apple 无法确认原模型的问题。

UX-2：`GET /sessions` 的可用会话另返回执行电脑的 `hostId`，以及可选 `updatedAt`（ISO 8601 时间）。`updatedAt` 取最近已读取历史事件的 `at` 与原会话登记时间中较新者；无有效时间则省略，不以请求或重命名时间伪造活动。项目列表按它倒序默认展示最近 5 条；旧宿主缺字段时客户端保留稳定顺序并显示暂无活动记录。账户菜单读取既有 `/settings/usage` 的统计时区，再读取同一时区的 `/usage`；以 `budget.effectiveLimit`（包含本月临时额度）与该完整月份金额计算上限余量，无上限显示金额与请求数，不新增用量接口。

运行中的会话可另带 `processing:{phase,modelName?,ahead?}`：`phase` 为 `memory`（宿主正在读取记忆）、`queued`（宿主推理队列）、`loading`（本机 ModelSwitcher〔模型切换代理〕实测正在切换）、`waiting`（已开始模型请求，尚无内容）、`reasoning`（收到模型思考片段）、`answering`（收到文字片段）、`retrying`（原生流空闲超时后正在重试，客户端显示“模型响应慢，正在重试…”）。`ahead` 仅在 `queued` 时表示该请求前面的实际请求数，其他阶段省略；`modelName` 为当前模型显示名称。无可观测阶段时省略 `processing`，客户端显示普通等待提示，不推测加载或思考。结束后不返回阶段；旧客户端可忽略新增字段。

归档会话的 `sendAvailable:false`，发送新消息返回409 `SESSION_ARCHIVED`，先恢复再发送。已有运行不因归档停止。删除默认保留 MemoWeft 长期记忆；`forgetMemories:true` 需要 Cookie 与 `account:manage`，按账号及会话来源查询 Core（核心）的记忆任务证据，再走 `delete_evidence` 真正删除与储存清理。Core 不可用或遗忘失败时保留对话用于重试；已完成的证据遗忘不能撤销。再次删除已删除会话返回404。停止或后台形成未确认时不能宣称删除成功。

普通对话以 DSH（助手运行时）原生 `cwd` 绑定宿主数据目录内按账号散列 / 会话 ID 隔离的工作目录。脚本与笔记默认在这里，回到原会话沿用同一目录及原生上下文；`经验.md` 存在时作为本对话资料读取。压缩仍由既有原生摘要保留方法、脚本路径、命令与踩坑记录。项目的用户目录不属于对话删除范围。

项目会话可带 `projectId,projectRevision,projectName,projectRevoked`，移动或移除后可带 `projectNotice`（可显示的目录变更提示），浏览器会话带 `workspaceKind:"browser"`，共享会话带 `conversationId`。无法描述的会话返回 `title:"",running:false,sendAvailable:false,unavailable:true`。`sendAvailable` 是可发送权限，不是「当前空闲」；列表置顶项优先，同层按既有会话顺序；客户端按分组折叠显示，未分组在下。列表响应增加 `groups:[{id,name}]`，每会话增加 `pinned,unread,groupId` 及可选 `parentSessionId`；旧客户端可忽略。助手新消息水位超过已读水位时自动未读，打开对话由客户端 PATCH（部分更新）`unread:false` 自动已读；手动 `unread:true` 保留到下次打开/手动已读。分组与元数据持久保存且账号隔离，所有写操作沿用现有 `commands:write`、Cookie（会话凭据）/设备授权与 CSRF（跨站请求伪造防护）；已归档列表只在设置 → 已归档呈现，支持客户端标题搜索、恢复和既有删除确认。Android（安卓）原生 code23 起支持本节新增元数据、分组与分叉路由；新版界面包最低原生 code23，旧壳保留原版界面。创建走 `/commands`，没有 POST `/sessions`。FX-9 会话增加可选 `taskAvailable:boolean`；`false` 表示受限聊天会话不提供任务详情、任务控制与执行审批，客户端不轮询其 `/tasks/{id}`。发送是否已受理仍以原 `/commands/by-request/{requestId}` 回执和匹配 `receiptId` 的会话记录判定，与任务详情读取分开。缺字段沿用旧行为。

UI-P4：每会话可选只读 `contextUsage:{usedTokens,contextWindow}`。`usedTokens` 是 DSH（助手运行时）原生 `contextPressure.projectedTokens`（缺失时用 `pressureTokens`）的当前上下文占用，会随压缩及有效上下文增减；不是请求用量的累加。`contextWindow` 来自原生最新 `request/context` 上限，缺失为 `null`。宿主未提供有效占用时省略整个字段，旧客户端可忽略；客户端未知上限不计算比例，不能用计费用量或默认模型容量伪造圆环。Android（安卓）现有宿主会话透传保留此字段，不新增原生业务路径。

`snapshotAt` 是可选的服务端起读时刻（ISO 8601），与原生事件 `at` 使用同一宿主时钟；不保证每个会话的实际读取都恰好发生在该时刻。客户端可让晚于此时刻的原生回合开始/结束证据优先于旧列表投影；新列表已确认空闲且没有更新的开始证据时，不能把旧未结束记录当成仍在运行。旧服务缺字段时沿用其 `running` 投影。

### 3.4 历史与事件流（2）

| 方法与路径 | 请求参数 | 响应 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/sessions/{sessionId}/events` | 无游标：最近 N 条；`beforeSeq` 非负，排除边界向前翻页；`afterSeq` ≥ -1，排除边界正向增量。两者互斥。`limit` 默认 100，1–200 | 200 `{events,nextSeq,hasMore,nextBeforeSeq,hasOlder,latestSeq}`；事件按 seq 升序 | 400 `INVALID_REQUEST`；404 `SESSION_UNAVAILABLE`；503 `BACKEND_UNAVAILABLE` | 桌、手、安、苹 |
| GET `/sessions/{sessionId}/events/{seq}/detail` | 非负安全整数 seq；无查询 | 200 工具 / 审批保持 `{"seq":42,"text":"原始参数与工具输出的 JSON 文本","truncated":true}`；UX-4 用户 / 助手正文返回 `{seq,type:"user.message"|"assistant.message",text}`，按需读取完整可见正文；`truncated` 仅工具截断时出现 | 400 `INVALID_REQUEST`；404 `SESSION_UNAVAILABLE`；503 `BACKEND_UNAVAILABLE`（无该工具详情时） | 桌、手、安、苹 |

这是 JSON（结构化数据）分页 / 轮询，不是 SSE（服务端推送事件）。每页事件 seq 严格递增，但不保证连续；消息、执行与交互共用 DSH 原生 seq。`limit` 按公开时间线条目计数，过滤的文字 chunk（片段）、推理和注入上下文不占条目数。

- 首屏 `?limit=100` 只投影最新条目，不要求扫到会话开头。`nextSeq` 是稳定投影水位，`latestSeq` 是此次读取的原生日志尾部水位。通常相同；当最后一个 step/end 尚未由下一次 step/start 或 turn/end 确认时，nextSeq 会暂时停在它之前，避免漏掉随后确认的 task.ended。`hasMore:false`；`hasOlder` 表示是否还有更早公开条目，`nextBeforeSeq` 是下次排除的向前边界。
- 上翻 `?beforeSeq=<nextBeforeSeq>&limit=100` 返回更早条目，仍按 seq 升序。用新的 `nextBeforeSeq` 继续上翻；`hasOlder:false` 表示已到开头。**上翻响应不能覆盖客户端的正向增量游标**：它的 `nextSeq/latestSeq` 可能包含尚未增量读到的新事件。
- 增量 `?afterSeq=<nextSeq>&limit=100` 正向读取，`hasMore` 表示尚有后续条目。继续读取必须使用返回的 `nextSeq`，它可跨过过滤的内部事件；空页也可推进水位。此方向的 `nextBeforeSeq` 只是本页最早条目，`hasOlder:false` 不用于判断完整历史。
- **旧 `afterSeq=-1` 兼容**：继续从会话开头正向分页，绝不改成尾页。A3 后 Apple 首屏使用无游标尾页；该兼容路径仍供旧客户端使用，新事件及字段均为追加。
- 空日志 `events:[],nextSeq:-1,latestSeq:-1,nextBeforeSeq:null,hasMore:false,hasOlder:false`。`beforeSeq=0` 可返回空页。客户端按 `(sessionId,seq)` 去重，开始/完成按 stepId 更新，禁止自行给 seq 加一。
- 消息最多显示 4,000 个 UTF-16（字符串编码）单元；工具投影不带原始参数 / 输出。单条大记录截断并标记 `truncated`，整页按字节分页；长会话不再返回 `HISTORY_WINDOW_LIMIT`。用户原件消息仍可由原有附件登记恢复显示文本。
- 工具详情读取工具调用、工具结果和审批原始记录，仍最多 64,000 个 UTF-16 单元，超出标记截断。UX-4 另允许读取公开用户 / 助手消息的完整文字，用于复制、编辑及导出；只取正文，不含推理或注入上下文，原生消息分页仍保留 4,000 字符展示上限。删除原话 / 账号切换后拒绝详情，避免从旧缓存重现内容。详情与历史使用同一账号 / 会话读取权限，不公开本机路径形式的下载引用。

保留既有类型：`user.message`（`text,receiptId,images,originalAttachments,attachmentMessageId` 等）、`assistant.message`（`text,images,memoryUsed?`）、`turn.started`（`turn`）、`turn.ended`（`reason`，可有 `turn,endReasonKind`）。输出预算耗尽仍为 `reason:"error",endReasonKind:"max-tokens"`。执行事件见第 4 节。历史图片下载仍见 3.5。

M2a：`assistant.message.data.memoryUsed` 为本次模型请求实际保留在上下文中的 MemoWeft Recall（记忆召回）依据，数组项为 `{"id":"cognition-…","kind":"cognition","summary":"偏好用中文和买菜例子解释技术"}`。`kind` 为 `cognition/entity/relationship/event`，`summary` 最多240个 UTF-16 单元，取自目标模型权限过滤后的召回文本。后台形成走既有模型排队与账户后台模型配置；每轮按当前消息召回，并用 MemoWeft 的称呼/表达方式查询补充持续适用的对话偏好，结果去重；下一轮召回等待已接受的 Core（记忆核心）形成工作完成，普通对话在服务不可用或等待到期时继续。

新宿主在未命中、不可用或预算移除记忆时返回 `memoryUsed:[]`；旧宿主可省略此字段。它证明此回复请求采用了这些上下文依据，不声称能读取模型内部推理或证明每一条都改变了输出。客户端可用 `GET /memory/items/{kind}/{id}/sources`（3.9）打开当前来源；记忆后来删除或权限改变时，历史摘要仍是当时的回复依据，当前来源可返回不可读/404，不能用历史标签恢复已忘掉的原文。桌面在回复下显示「用到了 N 条记忆」，点击在既有右侧面板查看来源；手机/Apple（苹果客户端）标签另包。评测器 `memory_used` 检查指定回合的回复数组是否非空，空数组为失败、字段缺失为不支持；不以记忆服务状态代替采用证据。

### 3.5 发送消息与附件（5）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| POST `/commands` | 下表命令体；通常 ≤12 KiB | 202 `{"command":Command}`，同 ID 同体返回原命令 | 409 `TARGET_UNAVAILABLE / REQUEST_CONFLICT / SESSION_READ_ONLY`；404 `SESSION_UNAVAILABLE`；422 `MODEL_UNAVAILABLE`；429 `CAPACITY_LIMIT` | 桌、手、安、苹 |
| PUT `/sessions/{sessionId}/attachments/{attachmentId}` | 二进制；查询 `requestId,name` 必填且单值；头 `Content-Type,X-WeftMate-SHA256` | 首次201、重复200 `{"attachment":{"attachmentId":"attachment-<uuid>","name":"图.png","contentType":"image/png","size":128,"sha256":"<64 hex>"},"duplicate":false}` | 404 `SESSION_UNAVAILABLE`；409 `REQUEST_CONFLICT`；400 `INVALID_REQUEST` | 桌、手、安 |
| GET `/sessions/{sessionId}/attachments/{attachmentId}` | 无查询；持久 `sha256:` 可将冒号编码为 `%3A` | 200 图片字节、真实 MIME、`Content-Length` | 404 `SESSION_UNAVAILABLE`；后端不可读 | 桌、手、安 |
| PUT `/sync/attachments/{attachmentId}` | 二进制；`conversationId,messageId` 必填；原件必填 `name`；可选 `variant=display`；头 `Content-Type,X-WeftMate-SHA256` | 首次201、重复200 `{"attachment":{…},"duplicate":false}`；显示版为 `{"display":{…},"duplicate":false}` | 409 `REQUEST_CONFLICT`；413 `BODY_TOO_LARGE`；507 `CAPACITY_LIMIT` | 桌、手、安 |
| GET `/sync/attachments/{attachmentId}` | 无查询或仅 `variant=display`；需已被同步消息/命令引用 | 200 原件/显示图字节，非图像带下载文件名 | 404 `NOT_FOUND` | 桌、手、安 |

所有 `/commands` 命令均必填 `requestId,kind,targetDeviceId`，其中 `targetDeviceId=/status.hostId`：

| `kind` | 其他字段与语义 |
|---|---|
| `session.create` | 必填 `modelProfileId`；响应命令有预分配 `sessionId`，等待其实际可用后再发消息 |
| `session.message` | 必填 `sessionId,text`，`text` ≤8,192个 UTF-16 单元；可选 `intent:"steer" / "queue"`，默认 `steer`（插话）；旧 `mode:"queue" / "steer"` 继续兼容，同时传两者必须一致；可选 `attachments`、`attachmentMessageId + originalAttachments`、`sourceSyncEventId`。只在有附件时允许空文字；同步来源事件须与当前设备/会话/文字对应 |
| `session.cancel` | 必填 `sessionId`；取消会话当前执行，不等于某个根任务停止已被观察到 |
| `desktop.open_app` | 必填 `appId:"notepad"`；现存窄能力，只宿主所有者可用，非 M1 通用工具方案；四类入口未见直接调用该命令 |

发送示例：`{"requestId":"send-1","kind":"session.message","targetDeviceId":"host-…","sessionId":"session-…","text":"整理资料","intent":"queue"}`。DSH 已接收不等于完成。运行中省略 `intent` 或传 `steer` 使用 DSH 原生 next-step（下一步）输入，在下一执行边界调整当前任务；已经发生的副作用不会被撤回。没有运行任务时直接开始一轮。明确的新目标传 `queue`，使用原生 next-turn（下一回合）队列，按发送登记顺序自动逐个开始。同一会话两个客户端同时发送，由宿主串行登记到 DSH，顺序以原生时间线 seq 为准。

`Command.intent` 返回已解析的意图。当前任务中生效的插话命令另有 `rootTaskId` 与 `taskAction:"supplement"`，不生成独立目标；按原生入队时的当前回合回执关联，即使尚未持久化 user.message 也可以绑定。重试沿用原 `requestId` 与原体；`intent` 与同值旧 `mode` 归一为同一请求。显式 `mode:"queue"` 的旧客户端仍会排队；完全不传两者的旧客户端采用 D9 默认插话。

客户端接入：运行中输入默认发 `intent:"steer"`；用户选择「新任务」时发 `intent:"queue"`。收到 task.queued 在原对话显示排队卡，task.started 将其转为运行状态，task.ended 将其结束；取消按钮调用 3.6 的 `/tasks/{taskId}/cancel`，停止按钮继续调用 `/stop`。界面接入另包，本包只交付后端与契约。

会话暂存附件 ID 必须 `attachment-<uuid>`，`requestId` 与后续消息相同；`attachments` 元数据五字段必须齐全：`attachmentId,name,contentType,size,sha256`。最多4个，图像单个≤5 MiB，文本单个/合计≤16 KiB，总计≤10 MiB；文本 MIME 支持 `text/plain,text/markdown,text/csv,application/json,application/x-ndjson`。GET 会话附件当前只读持久图片，不能用它下载所有暂存文本。

同步原件单个≤1 GiB，保留原 MIME，不意味着模型能读取其格式；显示版只收 JPEG、≤512 KiB，原件必须先存在。`originalAttachments` 最多4个，另需 `attachmentMessageId`；用于保留原件与模型输入的关系，不把1 GiB原件直接当成模型输入。同步消息的 `attachments` 数量上限为8，不能与发送命令上限混用。

### 3.6 停止 / 任务控制与命令查询（9）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/commands` | `before=<commandId>`；`limit` 默认50、1–100 | 200 `{"commands":[Command],"nextBefore":"cmd-…","hasMore":true}`，新到旧 | 404 `NOT_FOUND`（游标不存在） | 桌、手、安、苹 |
| GET `/commands/{commandId}` | 无 | 200 `{"command":Command}` | 404 `NOT_FOUND` | 桌、手、安 |
| GET `/commands/by-request/{requestId}` | 无 | 200 `{"command":Command}` | 404 `NOT_FOUND` | 桌、手、安、苹 |
| GET `/tasks/{taskId}` | 无；根命令 ID | 200 `Task`（无 `task` 外壳） | 404 `NOT_FOUND` | 桌、手、安、苹 |
| GET `/tasks/{taskId}/sources/{snapshotId}` | 无；只读该任务引用的项目/网页快照 | 200 `{"source":{"snapshotId":"snapshot-…","relativePath":"README.md","lineStart":1,"lineEnd":10,"fileSha256":"…","text":"…"}}` | 404 `NOT_FOUND`；快照校验失败 | 桌、手、安、苹 |
| POST `/tasks/{taskId}/stop` | `{"requestId":"stop-1"}` | 202 `{"task":Task}`；重放同请求不重复发起 | 409 `TASK_NOT_READY / REQUEST_CONFLICT`；404 `NOT_FOUND` | 桌、手、安、苹 |
| POST `/tasks/{taskId}/cancel` | `{"requestId":"cancel-1"}`；只取消尚未开始的根任务 | 202 `{"task":Task}`；原请求可重放，`control.stopStatus:"stopped"` 表示原生队列移除已确认 | 409 `TASK_NOT_READY`（已开始/已结束/回执不确定，不会改为停止当前执行）、`REQUEST_CONFLICT`；404 `NOT_FOUND` | 后端可用，各端界面另包 |
| POST `/tasks/{taskId}/supplements` | `requestId,text`（沿用消息上限） | 202 `{"task":Task,"command":Command}`，子命令 `taskAction:"supplement"`，使用原生 steer | 409 `TASK_NOT_READY / REQUEST_CONFLICT` | 桌、手、安 |
| POST `/tasks/{taskId}/resume` | `requestId,text`；停止已确认且 `canResume` | 202 `{"task":Task,"command":Command}`，子命令 `taskAction:"resume"` | 409 `TASK_NOT_READY / REQUEST_CONFLICT` | 桌、手、安 |

停止收尾沿用 `control.state:"stop_requested"` 表示已冻结的停止意图，由 `stopStatus` 区分等待和终态。`stopped` 表示原生取消、队列移除或任务停止已确认；`completed` 表示目标回合已结束或已核对不再运行，不保证目标成功，也不保证由本次停止造成。宿主重启后，历史回合缺失且原生运行时确认不可能再运行时可收尾为 `completed`；读取失败、仍可能运行、待执行输入或副作用未确认继续等待。`stopObservedAt` 为核对时刻；`canResume:true` 后只按用户明确的新步骤续做，原命令、回执和已执行步骤保留。

来源快照项目字段还含 `totalLines,readAt,hasMore,projectId,projectRevision`；网页字段为 `kind:"webpage",title,url,requestedUrl,readAt,contentSha256,truncated,links`，可有分段/版本字段。网页预览兼容字段 `fileSha256` 是返回文本的哈希；项目 `fileSha256` 是原文件哈希，不是摘录文本哈希。

任务控制当前仅适用于 `personal-remote` 会话根消息；已接管的 `shared-chat` 会话命令仍可读/发/取消，但 `/tasks` 不提供它的任务详情（404 NOT_FOUND）。停止先登记 `stop_requested` 并使未处理审批/提问失效，再驱动取消与后台 job 停止；HTTP 202 不证明副作用已停止。`stopStatus` 可为 `requested / cancel_requested / stopped / completed / unconfirmed`，结合 `canResume,pendingReceipts,backgroundJobs` 呈现。M1-0b：`/stop` 与 `/cancel` 共用原生按回执控制：停止当前任务及已归属的插话，保留其他排队目标，停止结束后下一个自动开始。取消只移除尚在原生队列中的指定目标；若它已被领取，返回 409，客户端刷新状态后提供停止按钮。取消尚未发到 DSH 的 pending 命令会在宿主撤回，之后不派发；该情形没有原生 task.queued/ended，客户端用返回 Task 更新本地登记卡。取消重放不重复移除；同 requestId 改用 stop/cancel 另一动作返回 REQUEST_CONFLICT。取消状态复用 `control.state:"stop_requested"` 与 `stopStatus:"stopped"`，不新增执行状态机。单独停止不清空队列；需要一起取消时，客户端逐个调用排队目标的 cancel。队列复用 DSH 持久 inbox（收件队列），宿主恢复后保留其原生待执行输入；仅本宿主同一对话排队，不涵盖 D17 电脑离线时云端排队。

### 3.7 审批模式、审批与提问（8）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/sessions/{sessionId}/approvals` | `before=<approvalId>`；`limit` 默认50、1–100 | 200 `{"approvals":[{"approvalId":"<uuid>","sessionId":"session-…","taskId":"cmd-…","toolName":"shell","reason":"覆盖文件","status":"pending","createdAt":"…"}],"nextBefore":null,"hasMore":false}` | 404 `SESSION_UNAVAILABLE / NOT_FOUND` | 桌、手、安、苹 |
| POST `/sessions/{sessionId}/approvals/{approvalId}` | `requestId,outcome`；仅 `allowed-once / rejected`；允许时可带 `scope:"once" / "conversation-category"`，默认 `once` | 200 `{"approval":{"approvalId":"<uuid>","status":"answered","decisionOutcome":"allowed-once","decisionScope":"once","decisionRequestId":"approve-1","answeredAt":"…"},"requestId":"approve-1"}` | 409 `APPROVAL_NOT_PENDING / REQUEST_CONFLICT`；404 `NOT_FOUND` | 桌、手、安、苹 |
| GET `/sessions/{sessionId}/questions` | `before=<questionRpcId>`；`limit` 默认50、1–100 | 200 `{"questions":[{"questionRpcId":"<uuid>","status":"pending","questions":[{"id":"destination","question":"保存到哪里？","options":[{"label":"Downloads"}]}],"createdAt":"…"}],"nextBefore":null,"hasMore":false}` | 404 `SESSION_UNAVAILABLE / NOT_FOUND` | 桌、手、安、苹 |
| POST `/sessions/{sessionId}/questions/{questionRpcId}` | `{"requestId":"answer-1","answer":{"answers":[{"id":"destination","selected":["Downloads"]}]}}` | 200 `{"question":{"questionRpcId":"<uuid>","status":"answered","answer":{…},"answerRequestId":"answer-1","answeredAt":"…"},"requestId":"answer-1"}` | 409 `QUESTION_NOT_PENDING / REQUEST_CONFLICT`；404 `NOT_FOUND` | 桌、手、安、苹 |

| GET `/sessions/{sessionId}/approval-mode` | 无 | 200 `{"mode":"auto","allowedCategories":[]}` | 404 `SESSION_UNAVAILABLE` | 桌；手机/Android/Apple 菜单另包，接口可用 |
| PATCH `/sessions/{sessionId}/approval-mode` | `{"mode":"ask"}` | 200 同上；对话内持久保存，下次工具调用采用最新值 | 400 `INVALID_REQUEST`；404 `SESSION_UNAVAILABLE` | 桌 |
| GET `/settings/approvals` | 无 | 200 `{"mode":"auto"}` | — | 桌 |
| PATCH `/settings/approvals` | `{"mode":"auto"}` | 200 同上；按账户保存，只改变新对话默认值 | 400 `INVALID_REQUEST` | 桌 |

模式枚举：`auto` 自动（推荐，有风险才问）；`ask` 每次询问（普通读取/执行也询问）；`accept-edits` 自动接受文件修改（创建、编辑、覆盖文件直接做，删除和其它危险类别仍询问）；`plan` 先出计划（DSH 原生 `exit_plan_mode` 经本节提问接口确认后按自动执行）；`allow-all` 全部允许（客户端选中前必须明确提示删除/覆盖、系统修改、安装、发送/发布、付款可能直接执行且无法撤销）。口头检查点由系统提示让模型遵守，不改保存的模式。

列表新到旧，返回所有状态：`pending / answered / resolved / unavailable`。审批记录另含 `sourceCommandId,sourceReceiptId,turn,callId,rootCallId`，可有 `riskCategories`，枚举为 `delete / overwrite / system / install / external / spend / execute`；处理后可有 `decisionScope,outcome,resolvedAt`。`conversation-category` 仅用于允许有类别的审批，把这张卡包含的类别授权给本对话后续操作，其它对话不继承；拒绝不能带 scope。重试使用原 requestId、outcome、scope，不同 scope 也报冲突。旧客户端省略 scope 仍为允许一次。列表读取会刷新实时状态；待答复超过十分钟变为 `unavailable`，原生工具收到 unavailable 并将失败返回模型，迟到答复报409。POST回执保持登记时的 `answered`，重放旧回执不能覆盖较新的 `resolved`。

每批问题按原顺序完整作答：`answers` 数量与问题数量相同、`id` 对应；`selected` 选项标签不可重复，可带非空 `custom`。单选不能同时给选项与自定义；多选由 `multiSelect` 标记。问题可含 `header,detail,intent:{kind:"plan-review",approve:"<label>"}`；计划确认只退出原生计划状态，之后仍执行自动风险审批，不授予危险工具权限。`answerAcceptedAt` 才是个人入口答案被消费的确认，200/`outcome:"answered"` 本身不是。

### 3.8 成果下载（3）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/artifacts/{artifactId}` | 无 | 200 `{"artifact":{"kind":"desktop.write_artifact","artifactId":"artifact-…","taskId":"cmd-…","fileName":"报告.md","size":128,"sha256":"…","state":"observed","verification":{"status":"observed","method":"sha256_readback","observedAt":"…"}}}` | 404 `NOT_FOUND`；409 `ARTIFACT_UNVERIFIED` | 苹 |
| GET `/artifacts/{artifactId}/preview` | 无 | 200 `{"artifact":Command,"text":"报告内容"}` | 同上 | 桌、手、安、苹 |
| GET `/artifacts/{artifactId}/download` | 无 | 200 文件字节；`Content-Type,Content-Length,Content-Disposition` | 同上 | 桌、手、安、苹 |

现有成果是宿主登记且校验过的 UTF-8 文本、≤128 KiB，支持相应文本 MIME；未提供客户端直接登记成果/任意路径下载 API。来源校验通过才可打开/保存，客户端可核对元数据与字节哈希。

### 3.9 记忆（13）

`kind` 为 `cognition / entity / relationship / event`；下表均有顶层 `ownerId`。写入体 ≤12 KiB，`expectedWorldRevision` 是非负安全整数。

UX-P1 增补：列表 `GET /memory/items` 可显式传 `kind=all`，合并四类同一账户、同一 `worldRevision` 的记忆，按更新时间倒序、类型与标识稳定排序；任何类型版本变化返回 409 `MEMORY_REVISION_CHANGED`，不返回混合快照。省略 `kind` 仍默认 `cognition`。列表新增 `totalCount`（查询前该类型或全部类型的总记录数）；显式 `includeSources=true` 时每项新增 `sourceConversationIds:string[]`，通过本账户原生记忆任务账本的证据 ID 对应来源 `sessionId`。已删除、缺失或归属不匹配的来源不产生对话链接；旧 Core（记忆核心）缺少任务账本或旧证据没有映射时返回空数组，仍可打开既有来源详情，不猜测来源。分页游标继续绑定账户、类型、搜索词与版本；`kind=all` 只用于列表，不用于单项路径。

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/memory/status` | 无 | 200 `{"state":"disabled","worldRevision":null,"capabilities":{"list":false,"source":false,"correct":false,"mute":false,"inject":false,"deleteEvidence":false,"deleteWorldItem":false}}` | 内存服务错误；未配置仍200 | 桌、手、安、苹 |
| GET `/memory/export` | `format=json`（默认）或 `markdown` | 200 `{ownerId,format,filename,contentType,content,worldRevision}`；`content` 是可下载文件正文，含当前及历史理解与可读来源摘要 | 409 `MEMORY_REVISION_CHANGED`（不返回局部文件）；503 `MEMORY_DISABLED / MEMORY_UNAVAILABLE` | 桌、手、安（界面）；苹（接口） |
| GET `/memory/items` | `kind` 默认cognition；`query` ≤120 UTF-16；`limit` 默认50、1–50；`after=<nextCursor>` | 200 `{"items":[{"id":"memory:1","kind":"cognition","text":"偏好中文","truncated":false,"currentState":"current","createdAt":"…","updatedAt":"…","lifecycle":{"invalidAt":null,"archivedAt":null,"mutedAt":null},"sourceCount":1}],"worldRevision":8,"nextCursor":null,"hasMore":false,"searchScope":"account_snapshot"}` | 409 `MEMORY_REVISION_CHANGED`；413 `MEMORY_SEARCH_LIMIT`；503 `MEMORY_DISABLED` | 桌、手、安、苹 |
| GET `/memory/items/{kind}/{itemId}` | 无 | 200 `{"item":{…},"worldRevision":8,"availableActions":{"correct":{"available":true},"mute":{"available":true},"delete":{"available":false,"reasonCode":"MEMORY_DELETE_UNAVAILABLE"}}}` | 404 `NOT_FOUND`；503 `MEMORY_RESPONSE_INVALID` | 桌、手、安、苹 |
| GET `/memory/items/{kind}/{itemId}/sources` | 无 | 200 `{"sources":[{"evidenceId":"evidence:1","relation":"supports","currentnessState":"current","permissions":{"allowLocalRead":true,"allowCloudRead":false,"allowInference":true},"contentAvailable":true,"summary":"…","rawContent":"…","rawContentTruncated":false,"recordedAt":"…"}],"worldRevision":8}` | 404 `NOT_FOUND`；503 `MEMORY_RESPONSE_INVALID` | 桌、手、安、苹 |
| GET `/memory/items/{kind}/{itemId}/forget-preview` | 无 | 200 `{ownerId,worldRevision,itemCount,evidenceCount,evidenceIds,items:[{id,kind,text,itemType}]}`；当前项与将级联删除的全部记忆，名称完整返回；原库只读 | 404 `NOT_FOUND`；503记忆不可用 | 桌、手、安（界面）；苹（接口） |
| GET `/memory/evidence/{evidenceId}/forget-preview` | 无 | 同上，预览单条来源的级联范围 | 同上 | 桌、手、安（界面）；苹（接口） |
| POST `/memory/items/{kind}/{itemId}/correct` | `requestId,expectedWorldRevision,text`；非entity，非空文字≤4,000 UTF-16 | 200或409 `Receipt` | 422 `MEMORY_ACTION_UNSUPPORTED`；409 `MEMORY_REQUEST_CONFLICT / MEMORY_REPLAY_REDACTED` | 桌、手、安、苹 |
| POST `/memory/items/{kind}/{itemId}/mute` | `requestId,expectedWorldRevision` | 200或409 `Receipt` | 503 `MEMORY_ACTION_UNSUPPORTED / MEMORY_UNAVAILABLE`；409请求冲突 | 桌、手、安、苹 |
| DELETE `/memory/items/{kind}/{itemId}` | `requestId,expectedWorldRevision`；可选 `deleteConversationSnippets:false`（JSON体） | 200或409 `Receipt` | 503 `MEMORY_DELETE_UNAVAILABLE`；409请求冲突 | 桌、手、安、苹 |
| DELETE `/memory/evidence/{evidenceId}` | `requestId,expectedWorldRevision`；可选 `deleteConversationSnippets:false`（JSON体） | 200或409 `Receipt` | 404 `NOT_FOUND`；503 `MEMORY_DELETE_UNAVAILABLE` | 桌、手、安、苹 |
| GET `/memory/commands/by-request/{requestId}` | 无 | 200 `Receipt`（也可包含拒绝/冲突状态） | 404 `NOT_FOUND`；409 `MEMORY_REPLAY_REDACTED` | 桌、手、安、苹 |
| POST `/memory/commands/by-request/{requestId}/retry-cleanup` | `{}`，≤1 KiB；只重试原删除的底层清理 | 200 `Receipt` | 404 `NOT_FOUND`；422 `MEMORY_ACTION_UNSUPPORTED`；503 `SERVICE_UNAVAILABLE` | 桌、安（能力）、苹 |

遗忘预览的 `items[].kind` 可为 `interaction_commitment`（交互承诺）；其 `itemType` 为 `commitment` / `recommendation` / `agreement`，与正式项一起计入 `itemCount`，表示将随来源或会话清除的派生记录。此类型只用于预览，独立记忆列表与命令目标的 kind 不扩展。

FX-15：确认决定的来源列表可额外包含 `role:"assistant"`、`messageId`、`conversationId`；`rawContent` 为被确认的助手提议原话。`evidenceId` 指向提议所在回合的用户证据，用于权限及遗忘依赖，不表示助手文字成为用户 Evidence（原始证据）。同一 `evidenceId` 可同时出现用户原话和助手上下文，客户端应按 `evidenceId + role + messageId` 区分；旧客户端继续显示既有摘要和原文。助手来源撤权或删除后不返回正文。

查询对当前账号快照搜索，`query` 经 NFKC/trim/小写规范化；游标绑定账号、kind、query、worldRevision，修订变化后重新查首屏。`currentState` 另可 `not_current`。来源最多200条，摘要≤2,000、原文≤8,192 UTF-16；详情/来源内部大小上限256 KiB。拒绝删除的原因在 `receipt.reasonCode`，可为 `MEMORY_DELETE_CONFLICT / MEMORY_SOURCE_UNRECOVERABLE / MEMORY_DELETE_SOURCE_UNKNOWN / MEMORY_COMMAND_REJECTED`；外层未知错误会投影为 `SERVICE_UNAVAILABLE`。`capabilities.inject` 仅表示能力，当前没有公开「注入/采用记忆」HTTP路由。

FG-1：遗忘按来源级联清除 Evidence（来源证据）、依赖理解、关系和无剩余依据的人物／别名，清除 Core（记忆核心）派生上下文、宿主注入／采用标记、投影及纠正日志副本。SQLite（嵌入式数据库）清理使用 `secure_delete` 和 WAL（预写日志）截断；`storageCleanup.state=pending` 表示仍有底层或宿主清理待完成，不能宣称不可恢复。原请求回执和 `retry-cleanup` 可在重启后继续核对。

D33：`deleteConversationSnippets` 默认 `false`。桌面、手机网页及手机界面的记忆页「忘掉」确认框先列出级联记忆名称与数量；删除对话勾选遗忘时显示汇总数量。两类确认框均提供「同时删除对话里含这句话的原话」，每次打开默认不勾。显式 `true` 才另外清除该账户原生会话日志／个人命令记录中含来源原话的文字，保留会话及其他片段。Core 自己的原话副本无论是否勾选均清除；无关证据的前置 AI 上下文原样保留。预览只读，不创建回执、不递增修订、不调用模型；预览失败或修订与详情不一致时不可确认。记忆删除沿用 `expectedWorldRevision`，会话删除传 `memoryWorldRevision`；修订变化返回409 `MEMORY_REVISION_CHANGED`，需要重新核对。选项属于原请求身份的一部分，重试不得改变。默认保留的对话原文和过去已生成的备份可含原话；专用记忆导出始终排除被遗忘的正式记忆。若随后删除相应对话，新的 BK-1 备份也应不再包含这些对话与记忆的副本。

桌面导出通过受限的原生保存接口选择文件位置，文件正文仍来自上述已鉴权 `/personal/v1/memory/export`；保存对话框结束后重新取当前导出并核对账户，防止保存期间切换账户或遗忘后写出旧内容。浏览器使用网页下载。

`GET /status` 新增 `memory:{state,inject}`，用于对话页轻提示和恢复检测；原有 `backend.modules.memory` 保留。原生删除失败的错误体可附 `nativeStatus,nativeCode`（状态及受限错误码），不含原生请求正文或凭据。

### UX-3 输入区：推理偏好与子任务投影

- `GET /personal/v1/models` 与账户模型目录增加只读 `deepThinking:{supported:boolean,effort?:"high"}`；不支持 / 未声明时 `supported=false`。客户端据此隐藏开关，在模型设置说明能力。
- `GET /personal/v1/sessions/{sessionId}/thinking` 返回 `{supported,enabled}`；`PATCH` 同一路径接受严格 `{enabled:boolean}`，沿用 Cookie（会话凭据）/ 原令牌、`commands:write` 与 CSRF（跨站请求伪造防护）。只允许本账户可发送的非归档会话，不支持的模型不能开启。幂等布尔偏好持久保存，不中断当前回合。`GET /sessions` / 对话视图增加 `deepThinking:boolean`，旧客户端可忽略。
- 偏好同时保存到逻辑对话与当前会话；发送时优先逻辑对话，后续接力段沿用。宿主在后续原生回合的 `agent/request`（请求构造钩子）读取并固定偏好；开启只给该回合请求配置加 `reasoningEffort:"high"`，关闭透传模型原配置。同一回合中途切换不改变已固定的偏好。不改变账户模型默认值。原生已有能力声明优先；旧受管路由仅补缺失的能力与等价字段声明。
- 原有 `step.started|step.completed` 可选 `subtask:{name,id?,background?}`：名称来自真实委派描述 / 后台命令；`id` 是原生子任务 / 作业标识，`background=true` 表示启动工具结束仍未结束任务。新增只读 `subtask.updated` 事件携带 `{id,state:"completed"|"failed"}`，来自 DSH 的后台结束通知，不包含子任务正文或隐藏推理。事件仍沿用真实 `seq` / `at` 和当前账户历史权限。客户端按同一 ID 合并，背景任务在原生终态前保持进行中，不因主回合结束推测终态。
- Android（安卓）code25：`attachments.pick` 新增 `kind:"camera"`（已有 `image|file` 保持），结果仍走原 `attachment.result` 与原账户 / 对话 / `viewGeneration`（视图代次）核对。`/sessions/{id}/thinking` 加入原生业务桥。系统相机使用已有相机权限、仅专用缓存路径的临时 URI（资源标识）；返回导入后删除临时原图。发布 UX-3 手机包要求最低原生 code25。Apple（苹果端）A15 已消费上述模型能力、会话偏好与子任务投影；客户端只提交 `{enabled}`，不构造提供方字段。原生验证与边界见 `apps/apple/Tests/Evidence/A15/README.md`。

### 3.10 模型（12）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/models` | 无 | 200 `{"models":[{"id":"local","name":"本地模型","model":"qwen","configured":true,"routeFingerprint":null,"source":"host","sourceKind":"local"}]}`；私有模型可有 `accountModelId,revision` | 后端错误 | 桌、手、安、苹 |
| POST `/models/{modelProfileId}/verify` | `{}` | 200 `{"configured":true,"reachable":true,"modelListed":true,"inferenceVerified":false}` | 422 `MODEL_UNAVAILABLE`；503 `CAPABILITY_UNAVAILABLE` | 手、安 |
| POST `/models/{modelProfileId}/chat/completions` | `model,messages`；可选 `tools,tool_choice,stream,max_tokens,temperature`；≤256 KiB | 200 `{"choices":[{"message":{"role":"assistant","content":"你好"},"finish_reason":"stop"}],"usage":{"total_tokens":10}}`；`stream:true` 为 SSE `data: …`，以 `data: [DONE]` 结束 | 422 `MODEL_UNAVAILABLE`；503 `CAPABILITY_UNAVAILABLE / BACKEND_UNAVAILABLE` | 手、安 |
| GET `/account/models` | 无 | 200 `{"models":[AccountModel],"canManage":true}` | — | 桌、手、安 |
| POST `/account/models` | `requestId,name,baseUrl,modelId,apiKey`；可选 `modelTier`；≤12 KiB | 202 `ModelOperation`；重放完成请求可200 | 400 `ACCOUNT_MODEL_SECRET_REQUIRED`；409 `REQUEST_CONFLICT`；503 `ACCOUNT_MODEL_UNAVAILABLE` | 桌、手、安 |
| GET `/account/models/{accountModelId}` | 无 | 200 `{"model":AccountModel}` | 404 `NOT_FOUND` | 手（转移前核对）、安 |
| PATCH `/account/models/{accountModelId}` | `requestId,expectedRevision`；至少一个 `name,baseUrl,modelId,apiKey,modelTier`；≤12 KiB | 202/200 `ModelOperation` | 409 `ACCOUNT_MODEL_REVISION_CHANGED / ACCOUNT_MODEL_BUSY / REQUEST_CONFLICT`；400 `ACCOUNT_MODEL_SECRET_REQUIRED` | 桌、安（能力） |
| DELETE `/account/models/{accountModelId}` | `requestId,expectedRevision`（JSON体） | 202/200 `ModelOperation` | 409修订/忙/请求冲突 | 桌、安（能力） |
| POST `/account/models/{accountModelId}/test` | `requestId,expectedRevision` | 202/200 `ModelOperation`，后续 `operation.testResult` | 409修订/忙/请求冲突 | 桌、手、安 |
| POST `/account/models/{accountModelId}/stop-using` | `requestId,expectedRevision` | 202/200 `ModelOperation` | 409修订/忙/请求冲突 | 桌、安（能力） |
| POST `/account/models/{accountModelId}/transfer` | `requestId,expectedRevision`；Cookie密码设备且已声明转移能力 | 200 `{"model":AccountModel,"apiKey":"<secret>"}` | 403 `FORBIDDEN`；409 `ACCOUNT_MODEL_REVISION_CHANGED / ACCOUNT_MODEL_UNAVAILABLE / REQUEST_CONFLICT` | 手、安 |
| GET `/account/models/by-request/{requestId}` | 无 | 200 `ModelOperation` | 404 `NOT_FOUND` | 桌、手、安 |

MS-1 增加 `POST /account/models/check`：Cookie（浏览器会话凭据）及 `account:manage` 权限、CSRF（跨站请求伪造防护）；体为 `{profileId? ,baseUrl?,modelId?,apiKey?,sendTestMessage?}`，最多 12 KiB。未保存的草稿须提供地址、模型 ID（标识）和密钥；已保存的可见模型可通过 `profileId` 复用密钥，换地址须提供新密钥。仅在进程内检查，不保存草稿或密钥。默认只读 `/models`；只有目录明确返回 404 / 405 / 501 且本人点击「发送测试消息」传 `sendTestMessage:true` 时，发送 `max_tokens:8` 的极小测试，计入用量且遵守账户云端上限。地址拒绝重定向。官方 MiMo 地址的模型 ID 在保存时规范为小写；其他提供方大小写保持原样。

检查结果保留 `configured,reachable,modelListed,inferenceVerified`，增加 `address: reachable|unreachable`、`authentication: missing|unchecked|accepted|rejected`、`catalog: unchecked|available|unsupported|failed|invalid`、`model: unchecked|listed|missing|tested|test_failed`；可有 `httpStatus,requiresTestMessage,suggestedModelId`。401 / 403 为密钥被拒；目录无 ID 与无模型列表分开。`configured` 仅表示密钥已配置，不能证明提供方检查通过。`/models/{id}/verify` 与账户 `/test` 也返回 / 保存这些安全诊断字段，旧客户端可忽略新增字段。GET `/models` 增加不含地址的 `location: computer|lan|cloud` 以分组；本机实际已加载状态仍来自 `/system.model.currentModelId`。

`AccountModel`：`{"accountModelId":"account-model-<uuid>","revision":1,"profileId":"private-model-…","name":"自用","provider":"openai-compatible","baseUrl":"https://model.example/v1","modelId":"model","modelTier":"auto","sourceKind":"cloud","routeFingerprint":"…","configured":true,"status":"active","createdAt":"…","updatedAt":"…"}`。列表不含密钥；`transfer` 是已有的显式传密钥接口，重复 `requestId` 不作为可重放的密钥回执。改 `baseUrl` 必须同时给新 `apiKey`。账号模型变更要求密码Cookie管理权限，登记后由 `by-request` 核对。

模型配置的可选 `modelTier` 为 `auto / local / cloud`：POST 省略或设 auto 按地址判断，PATCH 省略保留原值、auto 恢复自动判断，local/cloud 为用户覆盖（例如把 loopback 云端代理设为 cloud）。`AccountModel` 与 GET `/models` 返回 modelTier（旧配置显示 auto）和最终 `sourceKind: local | cloud`。自动判断使用实际 base URL 主机：127.0.0.0/8、::1、localhost、10/8、172.16/12、192.168/16、`*.local` 为 local，其余为 cloud；不要求正式本地 profile。HTTP 地址可用于上述本机/局域网范围，其他地址仍要求 HTTPS。字段跟随模型 runtime 修订持久化、可转移；仅改变位置也生成新的 profileId，旧会话保留原配置。无字段的旧请求/存储继续兼容，非法值返回 400 `INVALID_REQUEST`。

`ModelOperation`：`{"operation":{"requestId":"model-1","kind":"create","accountModelId":"account-model-…","status":"pending","createdAt":"…","updatedAt":"…"},"model":AccountModel}`；状态 `pending / applying / succeeded / failed / uncertain`，可有 `expectedRevision,resultRevision,reasonCode,errorCode,testResult`。模型选择是创建会话时的 `modelProfileId`，当前没有独立的会话换模型 `/personal/v1` 路由。

模型代理是受限 OpenAI 兼容体：`model` 必须对应所选profile；messages 1–40条、文字≤16,384 UTF-16，角色 `system/user/assistant/tool`；最多8个function工具，`tool_choice` 仅 `auto/none/required`；`max_tokens` 1–8192，temperature 0–2。它是手机本地循环的模型请求通道，不是宿主DSH办事消息接口。`verify` 明确没有验证实际推理。

### 3.11 项目 / 文件夹与浏览器工作区（D37）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/projects` | 无 | 200 `{"projects":[{"projectId":"project-…","name":"资料","revision":1,"revoked":false,"createdAt":"…"}],"canManage":true}` | — | 桌、手、安、苹 |
| POST `/projects` | `requestId,name,rootPath,instructions?,permission?`；仅宿主所有者；permission 为 `read-only / write`，省略默认只读，instructions 默认空、≤16000字符 | 201，重放200 `{"project":{…}}`；不回传rootPath | 403 `FORBIDDEN`；409 `REQUEST_CONFLICT`；503 `PROJECT_WINDOWS_REQUIRED / PROJECT_UNSAFE_PATH` | 桌、苹（Mac可信本机宿主身份） |
| POST `/projects/{projectId}/revoke` | `requestId`；仅宿主所有者 | 200 `{"project":{"projectId":"project-…","revision":2,"revoked":true,"revokedAt":"…"}}` | 404 `NOT_FOUND`；409 `PROJECT_REVOKED / REQUEST_CONFLICT` | 桌 |
| POST `/projects/{projectId}/sessions` | `requestId,modelProfileId` | 202 `{"command":Command}` | 404 `NOT_FOUND`；409 `PROJECT_REVOKED`；422 `MODEL_UNAVAILABLE` | 桌、手、安、苹 |
| GET `/workspaces/browser` | 无 | 200 `{"available":true,"hostId":"host-…","workspaceKind":"browser"}`；可有 `reasonCode` | — | 桌、手、安 |
| POST `/workspaces/browser/sessions` | `requestId,modelProfileId`；宿主所有者 | 202 `{"command":Command}` | 503 `BROWSER_UNAVAILABLE / BROWSER_CLEANUP_FAILED`；422 `MODEL_UNAVAILABLE` | 桌、手、安 |

D37 项目实体公开字段为 `projectId,name,instructions,permission,revision,revoked,createdAt,revokedAt?`。`rootPath`、目录身份与内部密钥仅保存在电脑；项目、会话与手机列表均不回传目录路径。新界面创建显式传 `permission:"write"`；旧 POST 省略权限保持只读。

| 路由 | 请求 | 响应 / 行为 | 错误 | 客户端 |
|---|---|---|---|---|
| PATCH `/projects/{projectId}` | `expectedRevision`（必填整数）、至少一项 `name / instructions / permission`；name 沿用项目名规则，instructions ≤16000字符 | 200 `{project:Project}`，修订号加一；更新成员会话修订，后续回合自动使用新说明与权限 | 400 INVALID_REQUEST；403 FORBIDDEN；404 NOT_FOUND；409 PROJECT_REVISION_CHANGED / SESSION_BUSY | 桌、苹（Mac可信本机宿主身份） |
| DELETE `/projects/{projectId}` | `{expectedRevision}` | 200 `{deleted:true,projectId}`；只移除登记，不删除文件夹；成员解绑并得到 `projectNotice`，历史来源、成果与会话保留 | 同上；重复删除404 | 桌、苹（Mac可信本机宿主身份） |
| PATCH `/sessions/{id}/metadata` | 原字段外增加 `projectId`（项目ID或null）；项目与groupId互斥 | 200 `{sessionId,projectId,projectRevision,groupId?,projectNotice}`；仅空闲且属于本人电脑的个人对话可移动；本人手机接续到电脑的对话保留原 conversationId 绑定，可同时归入项目；移入自动移出分组，移入分组自动移出项目；下一回合生效，历史文件不复制或移动 | 409 PROJECT_REVOKED / SESSION_BUSY / SESSION_READ_ONLY；404 SESSION_UNAVAILABLE | 桌、手、安、苹 |

旧状态启动时原地迁移：保留 ID、名称、目录身份、修订、撤销状态、会话与来源；缺失权限补 `read-only`、说明补空。再次启动幂等。移除保留内部墓碑，旧来源与旧请求仍可查询。项目设置与移除需 `account:manage`，移动会话沿用 `commands:write`、Cookie（会话凭据）与 CSRF（跨站请求伪造防护）；项目只属于宿主所有者。运行或待处理 / 回执不确定的成员会话返回 SESSION_BUSY，先结束或核对后再改。

项目新会话以原生 cwd（工作目录）创建于项目文件夹；普通对话沿用 D11 的独立目录。移动旧会话通过执行参数与 DSH（助手运行时）沙箱策略在下个回合切换默认目录，保留原生历史头及原文件。项目说明每回合注入，原生子任务继承。只读项目 write/edit 与命令写入被拒，不能用审批模式或工具升级参数绕过；可写项目使用原生 workspace-write（工作区内可写）边界，显式越界文件 / 命令写入首先拒绝；确需执行时可通过原生 `sandbox_permissions` 与 `justification` 申请一次升级，必须用户明确审批，即使对话为全部允许。项目文件夹路径也从审批说明中隐去，保留相对文件名。原生沙箱的内部临时运行目录沿用其既有行为。新增成果由磁盘读回核验登记，不要求旧摘要的 sourceSnapshotIds；旧摘要与来源接口仍兼容。项目不建立 MemoWeft 独立记忆世界。

项目撤销旧接口保持兼容，使绑定旧revision的会话不可再发送。浏览器会话的消息文字需有初始 HTTP(S) URL，缺失可报400 `BROWSER_URL_REQUIRED`；执行失败可在命令/任务中出现 `BROWSER_*` 或 `PROJECT_*`。没有公开的任意项目文件/浏览器命令HTTP接口，成果与来源走任务/成果接口。

### 3.12 同步（9）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| POST `/sync/capabilities` | Android：`sharedConversations:1,nativeVersionCode:>=11`（≤10000）；Apple：`platform:"macos/ios/watchos",sharedConversations:1`，可选 `accountModelTransfer:1`；密码Cookie | 200 `{"deviceId":"device-…","sharedConversations":1,"nativeVersionCode":12}` 或 `{"deviceId":"device-…","platform":"ios","sharedConversations":1}` | 403 `FORBIDDEN` | 手（原生自动）、安、苹 |
| POST `/sync/events` | `{"events":[SyncEventInput]}`；1–50条、≤256 KiB | 200 `{"accepted":[{"eventId":"<uuid>","seq":1}],"lastSeq":1}` | 409 `REQUEST_CONFLICT`；400 `ATTACHMENT_NOT_FOUND`；429 `CAPACITY_LIMIT` | 桌、手、安、苹（验收SPI） |
| GET `/sync/events` | `afterSeq` 默认0、0至当前水位；`limit` 默认100、1–200 | 200 `{"events":[{"seq":1,"sourceDeviceId":"device-…","eventId":"<uuid>","conversationId":"<uuid>","clientSeq":1,"kind":"conversation.created","occurredAt":"…","payload":{"title":"会话"}}],"nextSeq":1,"hasMore":false}` | 400 `INVALID_REQUEST` | 桌、手、安、苹 |
| GET `/sync/conversations/{conversationId}/shared` | 无 | 200 `{"source":"host","conversationId":"<uuid>","hostId":"host-…","syncThroughSeq":3,"originalModel":null,"status":"unbound","canAdopt":true,"localTurns":[]}`；绑定后有 `binding,lateSegment,adoptedMessages` | 404 `NOT_FOUND` | 桌、手、安、苹 |
| POST `/sync/conversations/{conversationId}/shared` | `requestId,modelProfileId,expectedSyncSeq`；可选 `acknowledgeUncertainLocalTurn:true` | 202 共享投影 + `{"command":Command}`；登记绑定再创建会话 | 409 `SOURCE_DEVICE_UPGRADE_REQUIRED / LOCAL_TURN_RUNNING / LOCAL_TURN_UNCONFIRMED / CONVERSATION_NOT_READY / CONVERSATION_SYNC_CHANGED / REQUEST_CONFLICT` | 桌、手、安、苹 |
| POST `/sync/conversations/{conversationId}/local-turns` | `requestId,turnId,sourceSyncEventId`；最近本设备用户消息，未绑定宿主会话 | 200 `{"turnId":"<uuid>","state":"running","expiresAt":"…","requestId":"local-1"}`；租期60秒 | 409 `CONVERSATION_NOT_READY / LOCAL_TURN_RUNNING / REQUEST_CONFLICT` | 手、安 |
| GET `/sync/conversations/{conversationId}/local-turns/{turnId}` | 无；仅创建该turn的设备 | 200 `{"turnId":"<uuid>","state":"running","expiresAt":"…","requestId":"local-1"}` | 404 `NOT_FOUND` | 手、安 |
| POST `/sync/conversations/{conversationId}/local-turns/{turnId}/renew` | 原 `requestId` | 200 `{"turnId":"<uuid>","state":"running","expiresAt":"…","requestId":"local-1"}` | 409 `LOCAL_TURN_UNCONFIRMED`；404 `NOT_FOUND` | 手、安 |
| POST `/sync/conversations/{conversationId}/local-turns/{turnId}/finish` | 原 `requestId`；先同步该turn的 `turn.finished` | 200 `{"turnId":"<uuid>","state":"finished","expiresAt":"…","requestId":"local-1"}` | 409 `CONVERSATION_NOT_READY`；404 `NOT_FOUND` | 手、安 |

`SyncEventInput` 必填 `eventId,conversationId,clientSeq,kind,occurredAt,payload`；时间为 RFC3339，`clientSeq` 是设备范围正整数，同设备不能复用给另一个事件；重复相同eventId/内容幂等。服务端添加账号范围 `seq` 与认证所得 `sourceDeviceId`。同步日志seq、DSH会话seq是两个空间，不能互相作为游标。

| 同步 `kind` | `payload` |
|---|---|
| `conversation.created` | `{"title":"会话名"}`，≤256个Unicode字符 |
| `message.created` | `messageId,role:"user/assistant",text`（≤16,384个Unicode字符）；可选 `attachments` 原件元数据（已上传，最多8个），有附件可空文字 |
| `turn.finished` | `turnId,status:"completed/cancelled/failed/interrupted"`；可选 `errorCode,originalModel`，后者含 `modelId,displayName,routeFingerprint`（可null），可选 `hostProfileId` |
| `tool.receipt` | `toolCallId,toolName,status:"dispatched/observed/failed/uncertain",summary`（≤1024个Unicode字符） |

共享 `binding` 含 `conversationId,sessionId,modelProfileId,revision,cutoverSyncSeq,contextHash,historyMessageCount,truncated,omittedImages,adoptCommandId`；切换后的未采用同步段在 `lateSegment:{count,events,hasMore}`，已采用消息在 `adoptedMessages`（`sourceSyncEventId,commandId,requestId,state,receiptId?`）。Apple能力声明只申请共享能力，未声明密钥转移；服务端内部兼容级别为11/12，不需Apple伪造Android版本号。

### 3.13 应用更新与下载（6）

以下业务接口均需认证；公开官网 `/downloads/*` 不在本契约中。

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/app/manifest` | 无 | 200 `{"schemaVersion":1,"uiVersion":"1.0.0","bridgeVersion":1,"minNativeVersionCode":11,"assetBase":"/personal/v1/app/assets/<hash>/","entry":"index.html","assets":[{"path":"app.js","sha256":"…","size":123}],"releaseNotes":"…","publishedAt":"…"}` | 404 `NOT_FOUND`（无发布包） | 手（原生更新）、安 |
| GET `/app/updates` | 无；SSE | 200 `event: ui-update` + `data: {"uiVersion":"1.1.0","assetBase":"…"}`；连接/保活为注释帧 | 404 `NOT_FOUND`；撤销凭据后断流 | 手（原生后台）、安 |
| GET `/app/assets/{hash}/{assetPath}` | manifest指定路径；可带 `If-None-Match` | 200资源字节 + ETag；匹配则304；private immutable缓存 | 404 `NOT_FOUND` | 手（原生安装）、安 |
| GET `/downloads/android` | 无 | 200 APK字节，文件名 `WeftMate-Android.apk` | 404 `NOT_FOUND`；下载中断 | — |
| GET `/native/manifest` | 无 | 200 `{"schemaVersion":1,"macos":null}` 或macOS发布元数据（见下） | 缺包仍200/null | — |
| GET `/downloads/native/macos/{sha256}` | 无；必须匹配当前有效包哈希 | 200 DMG字节，文件名含version/build | 404 `NOT_FOUND`；下载中断 | — |

macOS发布元数据：`version,build,bytes,sha256,architecture:"universal/arm64/x86_64",channel:"trial",notes,fileName,downloadUrl`。不要把native manifest与Android mobile UI manifest混用。Apple独立 `PublicUpdates.swift` 使用公开分发入口，本次所核对 `PersonalClient.swift` 没有调用上述认证下载接口。

UPD-1 / D32：新版 `/app/manifest` 在上述兼容字段上增加统一签名字段，路径、认证与 SSE（服务器推送事件）通知不变。三层清单共同结构如下；桌面界面 `ui` 与程序本体 `app` 的清单来自配置的发布源，手机 `mobile-ui` 仍通过本接口提供：

```json
{
  "schemaVersion": 1,
  "layer": "mobile-ui",
  "version": "0.9.0",
  "channel": "stable",
  "minHostVersion": "0.1.0",
  "minNativeVersion": "0.8.8",
  "bridgeVersion": 1,
  "files": [{ "path": "index.html", "size": 123, "sha256": "<64 lowercase hex>" }],
  "publishedAt": "2026-10-08T10:00:00.000Z",
  "signature": { "algorithm": "Ed25519", "keyId": "<32 lowercase hex>", "value": "<base64 signature>" }
}
```

`layer=ui|app|mobile-ui`；`channel=stable|preview`。兼容字段为可选 `minAppVersion` / `maxAppVersion`、`minHostVersion` / `maxHostVersion`、`minNativeVersion` / `maxNativeVersion`，采用 SemVer（语义版本）边界且包含端点；`bridgeVersion` 必须与消费者支持的版本相等。`expiresAt` 可选，存在时过期即拒绝。`ui` 必须满足当前桌面 / 宿主版本，`app` 必须满足当前程序 / 宿主版本；手机包先由宿主检查宿主范围，再由原生壳检查原生范围、原生 code 与桥版本。文件路径只能是安全相对路径，不能含上级目录、绝对路径、空目录分段或符号链接。

签名覆盖除 `signature` 以外的**全部顶层字段**，包括兼容别名、`assetBase`、发布说明和未知扩展字段。编码为 UTF-8（统一字符编码）的紧凑 JSON（数据格式）：对象键递归按 UTF-16（16位字符编码）顺序排序，数组顺序不变，字符串使用标准 JSON 转义；清单数字使用安全整数。用 Ed25519（签名算法）直接签上述字节，不预哈希。`keyId` 是公钥 SPKI DER（公钥结构的二进制编码）的 SHA-256（哈希）前32个十六进制字符；客户端只使用原生程序内置可信公钥，来源不提供可新增的信任根。

手机清单继续使用 `schemaVersion=1`，且 `version=uiVersion`、`files=assets`，并保留 `minNativeVersionCode`、`entry=index.html`、`assetBase` 和 `releaseNotes`；别名值不一致即拒绝。旧壳忽略新增字段，继续读取与哈希校验既有字段。新安卓壳 0.8.9 / code22 支持512文件；超过旧250文件容量的包必须声明 `minNativeVersionCode >= 22`，防止旧壳下载无法安装的资源集合。新版安卓壳拒绝无签名、签名错误、渠道不同、不兼容或过期的包，保留当前已验证版本 / 内置页。已有旧清单可向旧壳提供，但新发布必须签名。

下载按本设备的逐文件大小 / 哈希复用内置或活动版本；全部验证后才更新待应用指针，不留下部分更新。桌面下次打开窗口且任务空闲、无未发送草稿时切换，启动自检失败 / 崩溃恢复上一完整版本并记录失败身份。手机沿用原生下载、暂存、空闲切换和启动失败回退机制。版本目录属于 `userData`（用户数据目录）或手机私有目录，业务数据和凭据不进入版本包。

桌面“关于”接入 `src/ui-core/update.js` 的 `readUpdateState()`、`checkUpdates()`、`restartForUpdate()`；这些是本机窗口的 IPC（进程间通信）动作，不新增远程安装权限或业务 HTTP（网络协议）路由。响应 `{layers:[{layer,currentVersion,availableVersion,status,error,channel}],canRestart}`；`status` 包含检查 / 下载 / 就绪 / 失败状态，手机宿主发布版本标 `scope=host-published`，手机设备本身的安装版本由原生状态返回。程序本体须先核签清单、再核对下载的安装包，用户明确重启且任务空闲才安装；正式发布源与代码签名交 UPD-3。

#### UPD-2 Apple 关于页只读版本状态

既有 GET `/personal/v1/status` 增加可选字段（认证 / owner-scoped / `sessions:read` 不变）：

```json
{
  "updates": {"layers": [
    {"layer":"ui","currentVersion":"0.3.0","availableVersion":"0.4.0","status":"ready","channel":"stable"},
    {"layer":"app","currentVersion":"0.2.0","availableVersion":null,"status":"disabled","channel":"stable"},
    {"layer":"mobile-ui","currentVersion":"0.9.0","availableVersion":null,"status":"current","channel":"stable"}
  ]},
  "nativeMinimumVersions": {"iOS":"0.2.0","macOS":"0.2.0"}
}
```

只读投影不包含更新源、内部错误路径、`canRestart` 或安装动作。Electron 宿主复用 UPD-1 当前三层状态；独立宿主不掌握桌面 UI 版本时返回 `currentVersion:null/status:"unknown"`。旧宿主缺字段时 Apple 关于页显示未提供版本，不能把 App 版本充作宿主层版本。

`nativeMinimumVersions` 为宿主原生协议兼容要求，键使用 ApplePlatform wire 名 `iOS / macOS / watchOS`，值使用 UPD-1 SemVer 边界。缺字段 / 空表表示未声明；无效要求不默认为兼容。登录、云宿主兑换、恢复、离线验证遇到最低版本高于本机时返回客户端 `NATIVE_UPDATE_REQUIRED` 提示，不发布已连接会话；关于页读到要求后阻止后续宿主操作。Android 手机界面清单的 `minNativeVersion` / `minNativeVersionCode` 不作为 Apple 原生协议要求。平台最低版本尚未在正式宿主配置。

Mac 最小口子使用 UPD-1 `layer=app` 整体 Ed25519 签名清单，增加签名扩展 `nativePlatform:"macOS"/nativeBuild/downloadPage`，来源与原始32字节公钥由构建配置提供，默认未配置。只检测并打开下载页，不下载或执行更新包；iPhone 保持 TestFlight / App Store 更新。发布接线与 Sparkle 沙盒阻碍见 [发布说明](../scripts/release/README.md)。

### 3.14 桌面 UI 静态资源（12个 GET 路径，不计入89业务接口）

| GET路径（都无查询） | 响应 / 错误 | 使用端 |
|---|---|---|
| `/ui`、`/ui/`、`/ui/index.html` | HTML；未装UI handler为404 `NOT_FOUND` | 桌（宿主页） |
| `/ui/app.js`、`/ui/timeline.js`、`/ui/styles.css`、`/ui/favicon.svg`、`/ui/file-sha256.js` | 对应JS/CSS/SVG资源；不存在404 | 桌（宿主页/导入） |
| `/ui/vendor/noble-hashes-2.3.0/sha2.js`、`/ui/vendor/noble-hashes-2.3.0/_md.js`、`/ui/vendor/noble-hashes-2.3.0/_u64.js`、`/ui/vendor/noble-hashes-2.3.0/utils.js` | JS资源；不存在404 | 桌（哈希模块导入） |

这些路由在认证前提供宿主登录UI，仍受Host/Origin校验。Android bridge中的本机模型、通知、剪贴板、语音等操作不是同名服务端API；`mods/notifications/capabilities` 等字符串出现在bridge允许路径中，也不能证明服务端实现了这些路由。

UPD-1：资源服务从当前已验证 `ui` 版本读取既有白名单中的路径，版本未包含的资源回退内置文件；白名单、无查询 / 无百分号规则与 FE-1a 的 CSP（内容安全策略）、`no-store`、`nosniff` 等安全头保留。新增 `/ui/ui-core/update.js` 是共享更新动作资源；可热更代码只在渲染器运行，主进程与 `/personal/v1` 实现随程序本体更新。

### 3.15 系统状态与后台模型（M0-6，6）

| 方法与路径 | 请求 | 成功响应 | 权限 / 错误 | 使用端 |
|---|---|---|---|---|
| GET `/system` | 无查询 | 200 `{model,host,memory,queue,canRestart}` | `sessions:read`；未接入管理器为 503 `CAPABILITY_UNAVAILABLE` | 桌、手（Android code15 起） |
| POST `/system/model/restart` | `{}` | 200，同 `/system`，操作完成后读取实际状态；客户端使用维护等待窗口（桌面 / 手机 / Android 为 6 分钟），不按普通短请求提前中断 | `commands:write`，仅宿主原账户；其他账户 403 `FORBIDDEN`；未配置入口维护能力 503 | 桌、手 |
| POST `/system/host/restart` | `{}` | 200，同 `/system`；替换 DSH（模型运行时），个人 API 保持可达 | 同上；进行中的运行会中断 | 桌、手 |
| POST `/system/memory/restart` | `{}` | 200，同 `/system`；关闭并重新初始化当前账户的 MemoWeft（记忆服务）进程，保留数据库与待写队列 | 同上；记忆未启用 503 | 桌、手 |
| GET `/settings/models` | 无查询 | 200 `{"backgroundModelProfileId":null,"defaultModelProfileId":null,"currentChatModelProfileId":null}`；当前聊天模型为账户最近使用的可用模型 | `sessions:read`；按账户隔离 | 桌、手（只读） |
| PATCH `/settings/models` | 至少一个 `backgroundModelProfileId,defaultModelProfileId`；`null` 分别恢复跟随主模型、沿用对话选择 | 200，同 GET；只影响后续后台请求 | `account:manage`；须为当前账户可见、已配置的模型，否则 409 `MODEL_UNAVAILABLE` | 桌 |

每项服务有 `state`、`version`（未知为 `null`）、`lastError`（最近安全错误码或 `null`）、`canRestart`。模型服务另有实际 `contextWindow` 与 `slots`、`currentModelId`（当前装载模型或 `null`）、`lastSwitch`（`{action,modelId,at,ok}` 或 `null`）。状态来自配置入口的 `/switch/status` 与 `/props`；未配置为 `unconfigured`，读取失败为 `unavailable`。模型重启经入口 `/switch/restart` 等待请求租约结束后调用现有控制脚本，保留当前模型与配置。不返回模型文件路径、控制脚本输出或入口凭据。宿主版本来自应用包；模型版本来自 llama.cpp `/props`；MemoWeft 优先用服务版本，再用其 Python（运行环境）源码包的声明版本；两者均未知时返回 `null`。`queue` 含 `active: "foreground"|"background"|null`、`foregroundPending`、`backgroundPending`，不包含提示或账户信息。手机只显示后台配置，不提供修改控件；重启仍走相同认证与 CSRF（跨站请求伪造防护）规则。

MS-1：`defaultModelProfileId` 按账户保存，用于新对话；已有对话继续使用原绑定。后台配置默认跟随账户当前 / 最近聊天的模型，有会话和无会话的积压任务使用同一规则；没有最近聊天时才使用账户默认或已授权会话绑定，绝不回退到启动配置 `authRef`。标题、记忆整理以及后续关心/健康归纳按后台路由。仅本机回环且 `/props.total_slots=1` 的入口排队，云 API、多槽和未知槽数直接并行。本机 ModelSwitcher（模型切换代理）的后台请求仅在所选模型已经加载且未切换时进入推理；模型不一致则等待并释放槽位给聊天，后台不主动触发装卸。状态未知的已确认单槽服务也等待。单槽主对话整轮运行（含工具间隙）时后台推理等待，主请求在等待队列中优先；已开始的后台推理会完成后释放单槽。原生 compaction（上下文压缩）属于当前主请求，继续按主模型执行。记忆形成使用后台路由；World/interactions（记忆与经历）召回的来源权限按接收内容的主模型 modelTier 判定。

### ST-1 个性化与助手设置

| 方法与路径 | 请求 | 响应 / 权限 |
|---|---|---|
| GET `/settings/personalization` | 无查询 | 200 `{settings,updatedAt,synced:true}`；`sessions:read`，同一账户各设备读同一份 |
| PATCH `/settings/personalization` | 下列字段的非空子集 | 200 同 GET；`account:manage`，沿用 Cookie（会话凭据）和 CSRF（跨站请求伪造防护）；非法类型、未知字段、超限返回 400 `INVALID_REQUEST` |
| POST `/settings/personalization/style` | `{}`，无查询 | 200 同 GET；同 PATCH 权限；仅宿主本机从账户的本人消息提炼表达习惯，不调用模型、不保存原文；临时内容、已删除片段不参与 |

`settings`：

- `preferredName:""`（80 字）、`bio:""`（500 字）、`tone:"natural"`（`natural|concise|detailed|formal|casual`）、`toneInstructions:""`（500 字）。
- `fixedInstructions:""`（4,000 字）；`useWritingStyle:false`、`writingStyle:""`（1,000 字）。长度按 Unicode（统一字符编码）码点计算，空文本合法；提炼结果可通过 PATCH 编辑／清空，清除不删除任何聊天记录。
- `webSearch:true`、`verbosity:"medium"`（`short|medium|thorough`）、`thinkingDisplay:"collapsed"`（`collapsed|expanded|hidden`）、`defaultDeepThinking:false`、`messageMode:"queue"`（`queue|steer`）。

服务端串行合并字段，冲突按最后一次成功写入为准；`updatedAt` 为宿主保存时间，旧账户无已保存设置时为 `null` 并返回默认值。旧本设备的 D36 引导偏好在首次读取时迁入未配置账户；以后账户值优先。客户端仅成功回执后显示「已同步」，读取／保存失败保留可重试状态，切账户丢弃迟到回执。

称呼、简介、语气、自定义语气、详细程度、写作风格和固定说明在每个新回合通过 DSH（助手运行时）原生系统提示段组装，回合内保持快照，不改写历史；主对话、普通／项目旁聊和临时对话共用此机制。固定说明从不写入本人消息或 MemoWeft（记忆服务）摄取边界，也不成为 Evidence（记忆证据）。关闭网页搜索会从原生模型工具目录移除并拒绝 `web_search|web_fetch|browser`；不撤销普通文件／电脑能力。

新建对话读取 `defaultDeepThinking`，仍沿 UX-3 的模型目录能力和 `/sessions/{id}/thinking`，不支持的模型以普通方式回答；既有对话保持自己的偏好。`assistant.message.data.modelThinking` 是可选的模型返回思考内容（最多 4,000 字，沿历史正文的安全投影），只用于展示三档，不作为回复正文、上下文交接或记忆输入；模型不提供时没有空思考块。原生来源接口与工具详情仍不返回此内容。

`POST /offline/sync` 的加密副本追加 `personalization`，只携带上述账户设置，沿用既有记忆、副本权限和删除代次；离线直连共用系统提示组装函数，没有新增记忆／文件导出。离线模型没有会话级原生推理能力时不承诺默认深入思考。Android（安卓）原生 code27 开放上述两个设置路径；发布此界面包须声明最低原生 code27，旧壳保留兼容界面。Apple（苹果端）接线清单见 ST-1 证据。

### 3.16 对话输出与来源（UI-1b，1）

| 方法与路径 | 请求参数 | 响应 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/sessions/{sessionId}/resources` | 可选单值 `afterSeq`，默认 -1，安全整数 ≥ -1；无其他查询参数 | 200 `{outputs,sources,nextSeq,hasMore}`；每次按现有时间线读取最多 200 条 | 400 `INVALID_REQUEST`；404 `SESSION_UNAVAILABLE`；503 `BACKEND_UNAVAILABLE` | 桌、远程浏览器 |

`outputs` 是当前账号、当前会话的成果 `Command` 元数据数组；同一 `fileName` 只返回按 `createdAt` 最新的一项，缺少文件名时按 `artifactId` 区分；旧成果仍可通过原 ID 访问。预览、下载仍走 3.8。`sources` 是这一页工具调用以及会话已有网页 / 项目文件快照的只读聚合，不新增存储、不读取任意磁盘路径、不改变执行或工具权限。客户端从 -1 开始读取，按 `nextSeq` 正向继续到 `hasMore:false`，随后沿同一水位增量读取；不需要用户先加载更早的消息。快照与成果每次重取现有记录，工具参数 / 输出原文留在既有详情接口；`uses[].summary` 优先描述动作、文件名或调用方提供的可读描述。

来源形状：`{key,kind,name,location?,url?,uses,source?}`。`kind` 为 `file / webpage / tool`；`key` 以类别与路径 / URL / 工具名组成，供同一会话内聚合，文件 `name` 为短文件名、`location` 为原调用路径。网页只接受 HTTP(S) 参数。现有快照 `source` 沿用 `publicSource` 字段。`uses` 每项为 `{id,callId?,seq?,at?,summary,path,verb?}`：`path` 是省略 `/personal/v1` 的已授权快照或 seq 详情路径；`verb` 可为 `读取 / 写入`。同一调用的开始、完成及快照按 `callId`（无则 `id`）去重，完成记录更新原使用记录；已有内容快照优先于调用原文。次数是调用 / 使用次数，执行成功仍看具体内容中的实际结果，不能当作任务完成证明。

文件引用来自公开工具详情中的 `file_path / filePath / path / paths`，网页来自 `url / urls`，不猜测脚本代码里的未执行路径。无法读取参数时仍保留工具来源；列表不返回原始输出。现有记忆自动注入只在模型请求内，公开时间线没有逐条召回引用；本接口不将记忆查询工具调用冒充为「引用了某条记忆」。逐条记忆引用与「用到了 N 条记忆」入口需由记忆工作包提供真实引用字段，届时追加兼容来源类别。


### 3.17 用量与费用（USE-1，M1）

| 方法与路径 | 请求 | 响应 / 权限 |
|---|---|---|
| GET `/usage` | 可选 `month=YYYY-MM`、`sessionId`、`timeZone`（IANA〔互联网号码分配机构〕时区名，例如 `Asia/Shanghai`）；缺省时区为宿主系统时区，月份默认该时区当前月；非法时区 / 月份返回 400 `INVALID_REQUEST` | 200 `UsageSummary`；`sessions:read`，只读取当前账号；对话不属于账号返回 404 |
| GET `/settings/usage` | 无查询 | 200 `UsageSettings`；`sessions:read` |
| PATCH `/settings/usage` | `{monthlyLimit?:number|null,temporaryLimit?:number|null,profileId?:string,price?:Price|null,timeZone?:string}` | 200 `UsageSettings`；`account:manage`，Cookie（会话凭据）与 CSRF（跨站请求伪造防护）；金额为有限非负数，非法请求 400 |

`Price = {cachedInput,input,output}`，三个字段单位均为人民币元 / 百万 token（令牌）。`profileId` 与 `price` 一起提交；模型必须为当前账号可见，否则 409 `MODEL_UNAVAILABLE`。`price:null` 恢复预设。官方 `mimo-v2.6-flash` 预设缓存输入 0.02、未缓存输入 1、输出 2；本地 / 局域网模型默认三项 0，并在界面标「本地」。其他云模型未设单价时为 `null`，费用未知，不能当作免费。每个请求保存发出时的单价快照，之后改价不重算历史。价格来源：[MiMo 官方价格](https://mimo.mi.com/docs/pricing)。

`UsageSettings = {monthlyLimit,temporaryLimit,temporaryMonth,prices,timeZone,canManage,models}`；`models:[{id,name,model,local,price}]` 只含当前账号可见模型，不含地址或密钥。`monthlyLimit:null` 默认不限，0 暂停后续云端请求；`temporaryLimit` 为仅本月覆盖值，`null` 清除覆盖，按账号保存的 `timeZone` 到下月自动失效。`timeZone` 接受有效 IANA 时区名，缺省（含旧账本）用宿主系统时区；有管理权限的客户端打开用量设置或保存设置时上报所在时区，保存到账号，多个设备以最后上报为准。临时上限的 `temporaryMonth` 在设置时按更新后的账号时区确定；仅更新时区不会延长已保存的临时月份。查询时区只影响统计，不修改账号设置。每个账号独立设置。

`UsageSummary = {month,timeZone,sessionId,total,days,sessions,models,budget}`。`timeZone` 返回实际使用的规范时区名。请求记录仍保存 UTC（协调世界时）时间戳，按查询时区的当地日历日期归入月 / 日；夏令时跳时 / 重复小时使用该时区在请求发生时的偏移，不假设每天固定 24 小时。`total` 与各分组均含 `{requests,unknownRequests,unpricedRequests,inputTokens,cachedInputTokens,outputTokens,cost}`。输入包含缓存命中，`cachedInputTokens` 是其子集；输出包含服务商计入输出的推理用量。`days:[{day:"YYYY-MM-DD",...统计}]` 按日期排列并包含没有请求的零值日；`sessions:[{sessionId,...统计}]`、`models:[{profileId,...统计}]` 按费用降序，费用相同时按请求数降序。`sessionId:null` 表示未绑定对话的后台或手机独立代理请求；标题 / 模型名称从现有目录读取，不复制进用量账本。带 `sessionId` 时仅过滤统计，但 `budget` 始终按账号保存时区的当前月全账号总费用判断，包括查询历史月份或其他时区；与请求前 80% / 100% 判定一致。

`budget = {monthlyLimit,effectiveLimit,temporaryLimit,state:"unlimited"|"ok"|"warning"|"blocked"}`。已知费用达到有效上限 80% 提示；达到 100% 在每次后续云请求发出前拒绝，包括对话、工具循环、子任务、标题、记忆后台和手机模型代理；HTTP（网页传输协议）返回 **402 `USAGE_LIMIT_REACHED`**，界面说明「本月用量已达到上限，云端模型请求已暂停。请在设置 → 用量提高本月上限，或切换本地模型」。已发出的请求不会中途取消，因此正在运行 / 并发的请求可能跨过上限；后续请求被拒。本地目的地不受限，即使用户给本地模型填了非零单价仍可请求。未报告用量 / 未定价的费用不估算，无法据此保证实际供应商账单上限。

原生 DSH（模型执行框架）用量事件优先；OpenAI-compatible（OpenAI 兼容协议）JSON（结构化数据）或 SSE（服务端事件流）响应 `usage` 用于手机代理 / 记忆后台。缓存输入使用 `prompt_tokens_details.cached_tokens` 或 `prompt_cache_hit_tokens`，原生适配器的缓存读写计数按实际语义合并；DSH 适配器合成的全零事件无法证明供应商提供了用量，保留未知。缺失或不完整用量的整次请求计 `unknownRequests`，该请求费用不计入 `cost`，保留请求标识与时间；没有自行估算。只存账号 / 对话 / 模型 / 请求标识、时间、数字与来源类别，不存消息正文、工具参数或响应正文。宿主账本保留已删除对话的费用统计，不恢复对话内容；历史账单 / 外部供应商账单导入未实现。

桌面与手机功能读取 / 保存统一位于 `src/ui-core/usage.js`；实际手机页面使用同一宿主账本。手机独立离线直连模型尚无宿主回传，离线聊天记账随 S6 接入；Apple（苹果客户端）已在 A5 接入本节的统计 / 上限 / 402 提示，A15 起先读账户 `UsageSettings.timeZone`，再读该时区的月份统计；用量读取不写账户时区。Android（安卓）原生 `host.business` 已增加精确用量路径，旧原生壳未升级时返回不支持，不能以未知错误显示为零费用。


### 3.18 提醒与定时任务（SCH-1，M2）

宿主复用 DSH schedule（原生定时调度）的持久事件、计时、事务与派发，执行使用原对话命令队列和 DSH jobs（后台任务）。用户在对话中建立一次性、固定间隔、每日或每周任务；时间按 3.17 保存的账号 `timeZone` 解释，未保存时沿用宿主时区。确认用一句话复述当地时间、重复规则和内容。建立和口头取消由模型调用原生 `schedule_create/list/delete` 与管理工具完成，不增加第二个调度器或自然语言 HTTP（网络接口）解析端点。

所有路径均以 `/personal/v1` 为前缀，沿用账号 Cookie（会话凭据）/设备认证、Origin（来源）和写操作 CSRF（跨站请求伪造）校验。读取要求 `sessions:read`，管理要求 `commands:write`；仅返回当前账号拥有的 `personal-remote` 对话，不允许操作其他账号或只读共享对话。

| 方法与路径 | 请求 | 响应 / 语义 |
|---|---|---|
| GET `/schedules` | 无查询参数 | 200 `{items:Schedule[]}`；包含有效、暂停与已完成项；删除后不再返回 |
| POST `/schedules/{sessionId}/{id}/pause` | `{}` | 200 `{ok:true}`；停止未来派发，保留管理项和规则；重复暂停幂等 |
| POST `/schedules/{sessionId}/{id}/resume` | `{}` | 200 `{ok:true}`；暂停项重新交给 DSH，重复恢复幂等；周期项从下一次当地日历/间隔时间继续，已过期的一次性项恢复后立即提醒 |
| DELETE `/schedules/{sessionId}/{id}` | 无请求体 | 200 `{ok:true}`；删除未来派发与管理项，保留历史提醒和已启动的对话任务；不存在项404 |
| POST `/schedules/{sessionId}/{id}/run` | `{}` | 200 `{ok:true}`；立即提醒或将工作排入原对话，暂停状态与原下次时间保持；每次请求代表一次独立手动运行，客户端不得在响应不确定时自动重发 |
| GET `/notifications` | 无查询参数 | 200 `{items:Notification[]}`；持久提醒/定时执行通知列表，手机可读取；S3 远程推送另包接入 |

`Schedule`：`{id,nativeId,sessionId,text,kind,timeZone,repeat,state,nextRunAt,lastRunAt,approvalMode}`。`id` 是对话内稳定管理标识；日历续期或恢复时 `nativeId` 可变，客户端只使用 `sessionId/id` 管理。`kind=reminder|task`；`repeat=null|{kind:interval,seconds}|{kind:daily,time}|{kind:weekly,time,weekday}`，`time` 为 `HH:mm:ss`，`weekday` 为0–6（周日0、周一1）。`state=scheduled|paused|completed`；暂停/完成时 `nextRunAt=null`；时间戳为 UTC（协调世界时）ISO 字符串。`approvalMode` 记录建立时模式；实际执行读取原对话当时的模式和分类授权，沿用原用户回执建立的账号意图；建立时登录凭据到期不取消长期任务，设备撤销、账号授权、当前认证版本及原对话审批仍有效。

`Notification`：`{id,sessionId,text,kind,scheduledAt,createdAt,missed,messageId}`。原对话历史增加 `assistant.message.data.reminder=true`（可选字段，旧客户端可忽略）；该消息采用原生持久 seq（事件序号），正常历史分页和事件订阅均可见。纯提醒无需模型推理；Windows 程序显示系统通知，点击进入所属对话；桌面按账号/会话/seq 持久去重，开机补发也显示一次。任务先在原对话提示，再按正常审批模式执行，步骤、审批和成果继续使用已有任务契约。

宿主启动时恢复拥有有效任务的原对话。一次性错过后补一次；固定间隔使用 DSH 最新一次决策，不逐次重放积压；日历重复补一次后重建下一次未来日期，保留当地时间（含夏令时切换）。迟到至少一分钟时消息标明「错过了 X 的提醒/定时任务」。原生 `at` 拒绝首次选择的不存在夏令时时刻，重叠时选择较早瞬间；日历续期遇到不存在的时刻跳过该次，保留下一个有效日期。宿主关机期间不在云端执行电脑任务（D13）；手机通过通知列表等宿主恢复，远程推送留 S3。派发、模型完成和用户读到通知是不同状态；保持 DSH 原生崩溃恢复边界，不宣称外部副作用严格恰好一次。


### 3.19 手机离线记忆副本（M3-A / S6）

仅已批准内容设备的 Cookie（会话凭据）＋CSRF（跨站请求防护）会话可调用，需要 `account:manage`。内容仍经既有宿主中继，云端只持有删除代次。Android（安卓）最低原生版本 code24；网页使用 WebCrypto（浏览器密码接口）；A14 的 iPhone / Mac 原生端已接相同契约。细节见 [M3_OFFLINE.md](M3_OFFLINE.md)。

| 方法与路径 | 请求 | 响应 |
|---|---|---|
| `POST /personal/v1/offline/sync` | `{publicJwk:{kty:"RSA",n,e:"AQAB"},generation:0,hashes:{}}`，RSA 公钥必须 2048 位，私钥不得上传 | `{version:1,algorithm:"RSA-OAEP-256+A256GCM",aad,wrappedKey,iv,ciphertext}`；全部二进制字段使用无填充 base64url（URL 安全编码），密文末尾含 16 字节认证标签 |
| `POST /personal/v1/offline/turns` | `{generation,turns:[{id,conversationId,timestamp,messages:[{role:"user",text},{role:"assistant",text}]}]}`；每次最多 50 轮，单条 16,384 字，整包 256 KiB。可只有用户消息 | `{generation,receipts:[{id,state:"synced"}]}`；相同设备／轮次和正文幂等，复用轮次 ID 改正文返回 `REQUEST_CONFLICT`（409） |

`aad` 解码后为 JSON（数据交换格式）`{version:1,ownerId,hostId,deviceId,keyId}`；客户端必须核对当前账户／宿主／设备。`wrappedKey` 用设备 RSA-OAEP 私钥解开，摘要与 MGF1（掩码生成函数）均为 SHA-256。内容钥匙为 32 字节 AES，GCM 的 `additionalData` 使用原始 `aad` 字节，不重编码 JSON。

每个补交轮次还携带 `memoryRefs:[{kind,id}]`（最多64个唯一引用）与 `dependencyComplete`（布尔值）。引用包含当前召回及有界对话上下文所继承的记忆依赖，不能填正文。宿主将它写入助手消息的 Core `model_context_dependencies`，使遗忘能级联清除已经补交的回复副本；旧客户端或近期对话无法完整追溯时标记 `unavailable`，不伪造完整依赖。接口 `timestamp` 使用毫秒，宿主转换为 Core 的秒值。去重绑定本地受信物理设备身份，不受云会话续期后新 Cookie 设备编号影响。

解密副本为 `{generation,reset,worldRevision,items,remove,hashes,truncated,recent,model,control,syncedAt}`。`items` 是新增或变化项：`{id,kind,text,viewpoint,sources:[{id,summary}],updatedAt,currentState:"current"}`；`remove` 是删除标识；`hashes` 是当前完整项目哈希表。`reset:true` 必须先清除旧副本和待补交离线对话，再应用。任何删除项也清理可能引用旧内容的离线对话。`recent` 最多 10 段×20 条；`model` 含账户选定的 `profileId,name,baseUrl,modelId,apiKey`，只能在设备安全层解密，安卓不得传 API key（模型凭据）到页面。`control` 为云状态接口地址、`hostId`、绑定的云 `accountId` 与 `generation`；核对授权时须逐一匹配账户和代次，不能把同一宿主另一账户的授权用于此副本。

`OFFLINE_CLOUD_REQUIRED`／`OFFLINE_MODEL_REQUIRED`（409）表示需要绑定云账户／配置云模型；`OFFLINE_RESET_REQUIRED`（409）表示旧代次已无效，须删除副本与旧待补交内容。`MEMORY_REVISION_CHANGED`（409）重取快照。`synced` 只证明 Core（记忆核心）已接收，正式形成是原有后台任务。

云端 `POST /personal/v1/cloud/hosts/offline/status`：请求 `{hostId}`，使用既有云 DPoP（设备密钥持有证明）授权。只有同账户宿主成员的已批准设备能取得 `{hostId,accountId,generation,authorized:true}`。手机每次读取副本用于模型请求前及模型响应落盘前都核对，失败不调用模型；401／403／404 或代次不一致立即清理本地钥匙、密文、内存与待补交内容。离线期间仍能接收云端撤权，不能宣称完全断网的设备已收到清理。

宿主通过既有安装签名 `POST /personal/v1/cloud/hosts/offline/publish` 发送 `{hostId,proof}`，签名载荷带 `action,sub,generation`；云只单调递增保存 `offline_controls`，不保存正文、模型密钥或设备解密私钥。云数据库 schema（结构版本）7，账号／宿主删除级联清除此表；本包未部署。

## 4. 对话时间线事件（正式：M0-3 / M1-0a）

### 4.1 事件结构与原生来源

沿用 `{seq,type,at?,data}`。所有 ID 在会话 / 账号范围解释。步骤的 `taskId` 是稳定的原生回合键 `turn-<turn>`，不是 `/tasks/{id}` 的根消息命令 ID；两者不要混用。`stepId/callId` 是 DSH callId（工具调用标识），`groupHint` 是工具名称。`detailRef:{seq}` 指向 3.4 的按需详情接口。正文描述为 `summary`，例如「读取 3 个文件」「运行命令 npm test」「打开网页 example.com」。同一条目的字段只追加，不修改原生 seq。

| type | data 关键字段 | 来源 / 语义 |
|---|---|---|
| `step.started` | `taskId,stepId,callId,toolName,summary,groupHint,detailRef,state:"running",turn?` | 原生 `tool/call`，包含本次调用请求；审批前也可出现 |
| `step.completed` | 同上，`state:"completed/failed"` | 原生 `tool/result`；按 callId 补齐工具名和描述。工具结束不等于用户目标已验证 |
| `approval.requested` | `taskId,approvalId,stepId?,toolName?,summary,detailRef` | 原生 `approval/asked`。可读 reason（理由）保留影响范围说明；可操作状态与回执从 3.7 审批接口读取 |
| `approval.resolved` | `taskId,approvalId,summary,outcome,detailRef` | 原生 `approval/decided`。以 approvalId 更新原请求卡，保留开始位置 |
| `question.asked` | `taskId,stepId,callId,toolName,summary,questions,turn,detailRef,state` | 原生 `ask_user_question` 工具调用；具体提问操作使用 3.7 的原生问题批次 UUID。问题列表追加 `observedSeq`，用于定位该 turn 内不晚于水位的最后一个提问调用 |
| `question.answered` | `taskId,stepId,callId,summary,turn,detailRef,state` | `ask_user_question` 的原生工具结果；答案原文从详情取。提交答案登记仍以问题接口的 answered / answerAcceptedAt / resolved 区分，不能把登记当成执行端消费 |
| `artifact.created` | `taskId,artifactId,fileName,contentType,size,detailSeq,completedStep,artifacts?` | 原生 tool/result 含成果引用时，该 seq 投影为成果条目；completedStep 带同一步的完成字段，客户端同时结束该 stepId。同一步生成多个文件时，artifacts 数组逐项含 taskId、artifactId、fileName、contentType、size；顶层字段保留首项供旧客户端读取。每项以 artifactId 渲染卡片，共享原生 seq。此 taskId 可为根命令 ID，completedStep.taskId 仍是原生回合键。预览、下载和验证元数据仍使用 3.8 成果接口 |
| `task.started` | `taskId,turn,receiptId?,commandId?,requestId?,turnTaskId?` | 原生 step/start 的 step=1；原生输入回执关联已登记命令时 taskId 为根命令 ID，turnTaskId 为 `turn-<turn>`；保留独立 seq 的既有 turn.started |
| `task.ended` | `taskId,turn?,reason,receiptId?,commandId?,requestId?,turnTaskId?,nativeTurnEndSeq?,endReasonKind?,tasks?` | 执行结束来自原生最终 step/end + turn/end；排队取消来自原生 inbox canceled（已取消）splice，`reason:"canceled"` 且无 turn。中间模型 step 不结束任务；保留 turn.ended，未进入 step 的阻断回合仍只返回 turn.ended |
| `task.queued` | `taskId,receiptId,text,commandId?,requestId?,tasks?,inherited?` | 投影原生 `agent/inbox/spliced` 向 next-turn 的插入；seq 保留原值，taskId 为已关联的根命令 ID。next-step 插话不生成新目标排队卡。极少数原生批量 splice 用 tasks 数组表示同 seq 的多项，顶层为首项；UX-4 锚点分支的构造种子内插入标 `inherited:true`，沿用原生 Inbox（收件队列）忽略构造种子的语义，不显示为新分支的待执行目标 |

M1-0b 生命周期事件的 `receiptId` 为原生关联键。与已登记命令匹配时，`taskId` 指向 `/tasks/{id}` 根命令；步骤仍按 `turnTaskId` 或 turn 关联，不能把步骤的原生回合键发到任务控制接口。极短的派发窗口里，回执尚未写入命令表，task.queued 的 taskId 暂为 receiptId，started/ended 暂保留原生回合键；客户端通过 Command.receiptId 与 rootTaskId 补齐关联，不假造新 seq。用户消息仍仅在 DSH 实际领取时出现，以 receiptId 结束对应排队展示。取消的任务没有 user.message，保留 canceled 时间线事实。queued/started/ended 使用原生 seq，历史分页和 SSE（服务端事件流）重连水位保持不变。

既有日志不会被回写，也不向固定 DSH 追加私有事件类型：生命周期来自原生 step 标记与 inbox splice（队列变更），成果来自工具结果，所以旧日志同样可投影。固定 DSH 的持久事件目录不支持注册外部类型；读取必须保持原生恢复兼容。原有成果与控制信息仍可通过根任务快照补充到原对话。DSH 自带工具界面按 callId 关联调用与结果、用可折叠原始详情展示；本实现复用这一呈现方式，独立 Web 界面保持自身组件和样式。

M1-1：个人入口使用 DSH native tools（原生工具），包括 Windows 的 `pwsh`、其他桌面平台的 `bash`，以及 `read/write/edit`、`grep/glob`、`web_fetch`、`todo_write`、`subagent`。浏览器统一为 `browser` 的 open/read/follow 动作，不要求专用浏览器工作区或用户原文含 URL。旧 `personal_open_notepad`、`personal_save_document`、项目读取与三个浏览器工具不再注册，也没有个人预设的回合调用限次。既有日志及来源读取仍兼容。

新个人对话的 cwd（工作目录）为宿主数据目录下 `conversations/<sessionId>`，相对文件路径、命令与原生子任务使用该目录；旧会话保留其原生 cwd。工作目录不进入客户端接口。文件修改观察器在真实工具执行后读取磁盘，登记新增或内容变化的文件，并在原生工具结果中附上宿主成果引用。显式 write/edit 文件路径及 shell 的 workdir（命令工作目录）也可登记；无需额外保存工具或来源参数。当前成果预览沿用 3.8 的非空 UTF-8 文本、128 KiB 和安全文件名范围，其他文件仍可由原生工具写出，工具结果会说明成果格式暂不支持。审批沿用 DSH 默认机制，五种用户审批模式属于 M1-2。 原生子任务继承父模型和工作目录，委派消息使用 DSH 自身执行/审批，不要求另一个入口回执。需要取得文件成果时以 run_in_background:false 等待；父调用结束时登记这些文件。子任务直接使用原生 web_fetch，browser 的渲染交付留在原始入口对话。

### 4.2 分组、分页与各端呈现

连续相邻步骤在同一 taskId 下合成执行块，开始 / 完成只计同一 stepId 一次；artifact.created.completedStep 同样合并到该步，成果卡仍形成分组边界。迟到完成事件更新原行，不另建一行、不重排开始顺序；完成先到时先显示可读完成描述，随后上翻补齐开始。审批、提问、成果、用户 / 助手消息和任务切换形成边界；不同任务绝不合并。分页按原始时间线条目计数，不因折叠改变游标。

桌面运行块默认展开，手机默认收起。完成或该任务结束后自动收为「执行了 N 步 · 用时 X」；可以再次展开。步骤详情再次点开才请求原始参数 / 输出，并提供复制。审批 / 提问卡使用原有账号、来源、回执检查和操作接口，已处理记录保留在原位置；不新增「总是允许此类」权限。

成果通过桌面右侧面板 / 手机全屏页打开，关闭回到原对话，可下载 / 保存。来源、成果及原有任务停止控制位于对话内；独立任务页、任务详情弹窗和侧栏入口已删除，运行会话显示状态点。输入区停止保持既有语义；M1-0b 排队和插话后端契约见 3.5 / 3.6，界面接入另包。

## 5. 客户端差异（Apple逐项对照）

以下结论来自当前 `PersonalClient.swift` 和相关Codable/intent模型与上述服务端路径/字段对照；A2/A3 已同步修复 Swift 客户端；S1c-Apple 已加入云账号与内容设备客户端（云浏览器接线缺口见 5.2）。表中的「一致」只确认静态请求/响应契约，不代表真机/部署连通性已验收。

### 5.1 已调用接口的逐项核对

| Apple调用的方法与路径（前缀同上） | 路径/字段/错误处理结论 |
|---|---|
| POST `/auth/register`；POST `/auth/login` | 请求 `username,password,deviceName,displayName?` 与服务端一致；读取Cookie/CSRF再用status核对owner/host |
| GET `/auth/me`；GET `/status` | `account.ownerId,device.id,csrfToken` 与 `ownerId,hostId` 一致；身份不匹配或401清凭据，5xx/超时保留离线身份便于恢复 |
| POST `/auth/logout`；GET `/auth/devices` | `{}`注销体、Cookie/Origin/CSRF一致；设备createdAt/lastSeenAt等可选字段兼容。注销先清本地身份，服务端失败仍报告未确认 |
| 云 OIDC discovery/auth/token/jwks（7.2） | S1c-Apple：系统 ASWebAuthenticationSession；Code + PKCE S256、精确 callback/state、ID token nonce/issuer/aud/RS256/exp 验证，JOSESwift 3.0.0 签验 JWS。按 7.7 发送 `wm_device_id=apple-<公钥指纹>`、`wm_public_jwk`，云浏览器隐藏字段仍需邮件确认；公开 client `weftmate-apple`、redirect `com.weftmate.apple:/oauth/callback` 须在云端登记；无 client secret。轮换 refresh token 存 ThisDeviceOnly Keychain，恢复时取新 access token |
| POST `/auth/cloud-nonce`；POST `/auth/cloud-session`；POST `/cloud/pairings/redeem` | S1c-Apple：host:session resource + 设备 P-256 DPoP；每次新 nonce/jti/ath/精确 htu，无 Authorization；202 保持等待，不建立内容 session，允许/拒绝与重试/取消有明确界面；200 Cookie/CSRF 后再核对 status 的 ownerId/hostId |
| GET `/cloud/devices/pending`；POST `/cloud/devices/{id}/decision` | S1c-Apple：已登录前台读取，显示设备名、平台（官方客户端在 deviceName 中带 Mac/iPhone）、请求时间，允许/拒绝使用当前 Cookie/CSRF；现有响应无独立 platform 字段，其他名称显示「平台未提供」 |
| POST 云 `/personal/v1/cloud/hosts/relay/discover` | S1c-Apple：cloud:account Bearer + hostId 取得 relay base URL；offline/revoked/网络断流显示连接不可用，保留云登录。目录不含 pin；HTTPS 用系统 CA/域名验证再比较当面配对得到的 P-256 SPKI，上传/下载沿用同一验证；不接受目录覆盖旧 pin |
| PATCH `/sessions/{id}/metadata`；POST `/sessions/{id}/fork`；`/session-groups` | A7 接入置顶 / 未读 / 用户标题 / 分组与分叉；已归档迁入设置；UI-5 既有契约不变 |
| GET `…/forget-preview`；记忆 / 会话 DELETE | A7 接入只读级联名称 / 类型 / 数量、默认不勾原话删除与预览修订核对；记忆选项随不可变原请求保存；FG-1 既有契约不变 |
| GET `/sessions`；GET `/models` | A5 已接入 `archived`、归档 / 恢复 / 删除（默认不勾 `forgetMemories`）；会话 `running,sendAvailable,unavailable?,conversationId?,modelProfileId?` 与模型 `id,name,model,configured,routeFingerprint` 一致；Apple限制会话≤20,000、模型≤500 |
| GET `/sessions/{id}/events` | 已在 A3 修复：无游标尾页、beforeSeq 上翻、afterSeq 增量；上翻不覆盖正向水位，按 seq 去重。公开事件 data（含 endReasonKind）完整缓存/投影；步骤详情走按 seq 详情接口，historyLimit 枚举与全量扫描路径已移除 |
| GET `/commands` | before/limit/nextBefore一致；服务端按账号列全部命令，Apple读一页后过滤选中会话根任务，不是服务端按session过滤；可能需继续翻页才找到当前会话任务 |
| GET `/commands/by-request/{id}`；POST `/commands` | 404且code为NOT_FOUND才认定未登记；持久requestId与原体核对一致。A5 新消息发显式 `intent:steer|queue`，省略默认插话；旧已保存 `mode:queue` 请求沿用原体重放，读取 `rootTaskId/taskAction` 并在消息旁标注插话。消息与附件上限已在 A2 对齐 |
| GET `/tasks/{id}`；POST `/tasks/{id}/stop|cancel` | GET裸Task、POST202的task外壳、requestId一致；停止先查canStop，仅把匹配202当登记证据，后续Task状态不伪称该请求已确认。A5 接入按回执关联的排队取消 / 编辑重排、409 竞争提示、停止保留队列；任务控制不再依赖 `desktopOpenApp`，由任务响应的 `control` 决定。插话走新消息 `intent:steer`；独立续做入口另包 |
| GET `/tasks/{id}/sources/{snapshotId}` | 项目/网页来源字段与文本响应一致；区分项目原文件hash与网页文本hash |
| GET `/sessions/{id}/approvals`；POST `/sessions/{id}/approvals/{approvalId}` | A4a：接入可选 riskCategories / decisionScope 与允许 scope；允许一次 / 本对话总是允许此类 / 拒绝，分类 scope 保存在原请求中用于重试；旧记录省略 scope 保持 once。POST200为answered登记，resolved才显示已允许/已拒绝；Watch仍只允许一次/拒绝 |
| GET/PATCH `/sessions/{id}/approval-mode`；GET/PATCH `/settings/approvals` | A4a：macOS / iOS 输入区五种模式菜单、全部允许风险提示与账户默认；按对话保存，默认只影响新对话。分类授权仅本对话；风险类别用于显示后果，接口没有独立撤销能力字段 |
| GET `/sessions/{id}/questions`；POST `/sessions/{id}/questions/{questionRpcId}` | questions数组、answer.answers中的id/selected/custom、多选与plan-review字段一致；以answerAcceptedAt区分登记与消费；已在 A3 修复：按 approvalId 或同 turn 内不晚于 observedSeq 的最后一次提问定位时间线卡；200 登记与原生消费保持区分 |
| GET `/artifacts/{id}`；GET `/artifacts/{id}/preview`；GET `/artifacts/{id}/download` | 元数据、preview.text、download字节一致；Apple核对task绑定、size/sha256与UTF-8，符合当前≤128KiB文本成果范围；不可据此认为支持未来任意二进制成果 |
| GET `/memory/status`；GET `/memory/items`；GET `/memory/items/{kind}/{id}`；GET `/memory/items/{kind}/{id}/sources` | kind/query/after游标、owner/worldRevision与availableActions一致；详情/来源可由Apple额外传本地expectedWorldRevision校验，未将其臆造为HTTP查询字段 |
| POST `/memory/items/{kind}/{id}/correct`；POST `…/mute`；DELETE `/memory/items/{kind}/{id}`；DELETE `/memory/evidence/{id}` | requestId/expectedWorldRevision/text一致；允许读取409 receipt并区分error外壳；同requestID原体重放。纠正体字节上限不一致（见下） |
| GET `/memory/commands/by-request/{id}`；POST `…/retry-cleanup` | receipt/空体与清理状态一致；先查原删除回执再重试底层清理，NOT_FOUND/脱敏重放分别处理 |
| GET `/sync/events`；POST `/sync/events` | GET默认从0每页100，sourceDeviceId/eventId/seq一致；POST仅验收SPI提交隔离测试记录，四类kind与字段在此验收范围一致，不是Apple日常离线发消息接口 |
| POST `/sync/capabilities` | platform+sharedConversations一致，只声明共享，不声明accountModelTransfer；严格校验三个响应键，未来增加字段需评估兼容 |
| GET `/sync/conversations/{id}/shared`；POST `/sync/conversations/{id}/shared` | GET binding/切换水位与POST独立requestId/modelProfileId/expectedSyncSeq一致，POST202读取command+共享投影；没有表达acknowledgeUncertainLocalTurn的字段（见下） |

Apple通用网络错误保留HTTP status与大写 `error.code`，无合法code回退 `HTTP_<status>`，响应>1 MiB或3xx会拒绝；读取通常接受全部2xx，不自动轮询到任务完成。记忆变更显式接受409并解析回执；其他领域409作为APIFailure返回上层。这些处理符合现有接口；不是所有409都应转成重新登录，也不能因5xx换新requestId重发。

### 5.2 明确不一致与后续缺口

差异列保留 M0-5 核对时的现象；「已在 A2 / A3 修复」标注当前 Apple 客户端结果。服务端接口未变。

| 分类 | 差异 / 可观察后果 | 对应工作 |
|---|---|---|
| 请求上限不一致 | Apple消息校验允许≤16,384 UTF-16，服务端只允许≤8,192；超出服务端上限会400 INVALID_REQUEST。Apple命令总bytes允许262,144，服务端通常12KiB；即使字符数合法，高字节文字/JSON转义也可能413 BODY_TOO_LARGE | 已在 A2 修复：消息 ≤8,192 UTF-16；原发送 JSON ≤12 KiB，上传前校验并在输入处提示，保留草稿 |
| 请求上限不一致 | Apple纠正文本≤4,000 UTF-16一致，但intent允许纠正JSON体16KiB，服务端读取≤12KiB；长多字节/转义文本可能413 | 已在 A2 修复：纠正 JSON ≤12 KiB；输入处提示，保留原 requestId/请求体重放 |
| 名称计数不一致 | Apple认证时deviceName用Swift字符串count≤128（扩展字素），服务端按UTF-16长度≤128；含emoji/组合字符的长名称可通过Apple本地检查后400 INVALID_REQUEST | 已在 A2 修复：deviceName 按 UTF-16 ≤128 校验，超限不发送认证请求 |
| 接管字段缺口 | 服务端允许 `acknowledgeUncertainLocalTurn:true`；Apple接管intent没有该字段，并要求canAdopt。已有uncertain本地turn无法在Apple确认后接管，返回/显示LOCAL_TURN_UNCONFIRMED | 已在 A2 修复：仅用户明确点击「确认并继续」后发送该字段；普通接管省略，确认写入原 intent 供重放 |
| 任务适用范围 | Apple可给任何列出的会话查询根任务，但服务端/tasks只接受personal-remote；接管后shared-chat的任务详情/停止会404 NOT_FOUND。应按实际可用范围呈现，不能推定所有可发送会话都有任务控制 | 已在 A2 修复：结合账号桌面能力与实时会话可发送状态确认 personal-remote；shared-chat 隐藏任务详情/停止，不请求 /tasks；范围不明时隐藏 |
| 历史与时间线 | Apple从头全量读历史，未实现M0-3尾页/上滑更早；只转文字消息。共享HistoryData忽略endReasonKind及新工具/审批/成果data，即使未来服务端添加字段也不会自动渲染 | 已在 A3 修复：在线/离线尾页与上翻、增量合并；可折叠执行块、按 seq 详情、审批/提问/成果卡；来源/停止回到原对话，独立任务目录/详情页面已删除 |
| 附件 | Apple能解码原件元数据并计数，但没有上述四个附件PUT/GET；SharedCommandPayload无attachments、originalAttachments、attachmentMessageId，无法从该client上传/发送/下载附件或仅发附件 | 已在 A2 修复：四个 PUT/GET 与显示版、附件引用/仅附件发送、历史原件及旧图片下载接入；Mac/iPhone「+」、缩略图、侧栏/全屏 Quick Look、保存/分享；原件大小/hash 校验 |
| 任务输入 | Apple message mode固定queue，无steer；无supplements/resume；Task读取未呈现executionSteps/background job全部字段。不能把现有session.cancel当可取消排队卡片 | M1-0b/M1-0d/M1-4 |
| 账号/设备 | 无auth/state/setup/profile/change-password、设备PATCH/DELETE；登录/注册/列设备已有能力 | Apple账号设置接入（setup仍是宿主专属流程） |
| 云账号页/目录（剩余缺口） | S1c-Web 已正式提供 7.7 原生 deviceId/JWK 浏览器 bootstrap，Apple 已接入；注册/找回密码尚无云浏览器页面。discover 必须传 hostId，尚无账号宿主列表；已有设备批准也没有原生可信 pin 转交接口。首次无配对材料的云登录仍不能自动发现宿主并固定可信 pin | 云轨道补账号页与账号宿主目录/已有信任通道的 pin 交付；部署登记 Apple client 并更新 S1c-Web 服务。Apple 不猜造接口、不信云目录替换 pin；系统浏览器与已取得配对信息的登录按现有正式契约实现 |
| Apple 配对/密钥 | iPhone 相机或图片二维码读取 7.7 标准 URL `#pair=<base64url JSON>`、`wm1.` 复制码，兼容 7.4/7.6 裸 pairing JSON；Mac 粘贴电脑配对信息或在另一设备批准。P-256 优先 Secure Enclave，不可用用 Keychain；不跨设备同步。二维码过期/已用由宿主最终拒绝，重试不隐式允许 | S1c-Apple 已接入；真机 Secure Enclave/相机、可信 pin 转交与生产内容证书仍待对应轨道验证；电脑 QR 展示已由 S1c-Web 实现。Watch 无变更 |
| 模型 | 有GET models与create选择modelProfileId；无verify、模型代理chat/completions、account/models九项管理/转移接口。未声明密钥转移，符合当前权限范围 | Apple模型设置/手机独立对话后续包 |
| 项目 / 浏览器 | A11 已接项目列表 / 项目内新对话（原回执恢复）/ 移动 / 说明与权限设置 / 移除；Mac 系统选择框仅在 canManage + 可信本机 hostId 匹配时启用，普通 Mac 远程连接只显示项目名；当前目录检查后端仍仅 Windows。浏览器工作区新建尚未接 | Mac 执行宿主 / 浏览器工作区后续包 |
| 日常同步/本地turn | GET sync/events与共享接管已有；日常POST sync/events只有验收SPI，local-turns创建/查/续租/finish四项未接入 | M3离线对话与跨端合并 |
| 分发更新 | 无认证app/native/downloads六项请求；Apple公开更新另有PublicUpdates，不能宣称缺所有更新能力 | 当前保持已有公开分发；本契约只记录认证入口 |
| Watch | 旧首页没有任务进度、审批或完成触感 | 已在 A3 修复：通过 iPhone WatchConnectivity 读取一行进度、允许一次/拒绝、最近回复；前台/刷新观察到新完成才触感提醒。尚无远程推送，审批须手机可达，未验收真机配对 |
| 五端共同待实现 | M1-2 已有分类授权接口，Apple 在 A4a 接入（Watch保持允许一次）；消息 chunk（文本片段）流仍待实现；排队取消与 D9 插话已在 A5 接入，使用既有原生生命周期和根命令 / 回执关联，不建立客户端执行调度器 | A5 已接入；真实 DSH 引擎 / 真机仍按各自环境验收 |

本包未覆盖：内部 `/weftmate/api/v1` 网关、Electron IPC/Android全部bridge、公开官网分发、DSH原始完整事件schema、真实Windows宿主及Apple真机端到端场景。上述接口清单和使用标记来自本地源码对照，独立部署可能落后于此基线；M0-3/M1-0a已更新此文档与STATE契约栏。

## 6. 健康摘要（H2 正式接口）

> **H2 / MW-2 已接通服务端摘要与 MemoWeft observed。** 遵循 `COMPANION.md` 第 4、5、11 节；原始样本只在设备内计算。依赖支持 observed v1 的 MemoWeft Core；已交付/待交付与撤回状态由回执明确区分。模型目的地按来源过滤健康与衍生项，其他记忆照常召回。

### 6.1 上传与幂等

`POST /personal/v1/health/daily-summaries`，Cookie 账号认证、同源 Origin、CSRF（继承第 1 节）。每次一个日摘要，JSON ≤12 KiB；日期是 `timeZone` 中的 `YYYY-MM-DD`，时间戳为 UTC ISO 8601。账号从凭据确定，不从体中的字段选择。

按 **账号 + sourceDeviceId + date** 幂等 upsert：同日重试不新增证据；新的摘要替换该日原版本，删除省略的指标，更新云端使用策略及自评频率。不同采集设备保留来源，服务端不能将两部手机的同一天步数相加。`sourceDeviceId` 是汇总设备的账号设备 ID（离线队列可能使用当前账号之前签发的设备 ID）；服务端验证来源归属账号。`summarizedAt` 较旧的迟到提交返回 409 `STALE_HEALTH_SUMMARY`；相同时间、相同规范化内容返回 duplicate=true，相同时间不同内容同样返回 409。Apple 单设备上传顺序串行，收到 200 / 201 / 204 才移出本地队列；202 尚未确认持久化，保留重试。

```json
{
  "schemaVersion": 1,
  "date": "2026-10-06",
  "timeZone": "America/Los_Angeles",
  "sourceDeviceId": "device-phone",
  "sourceDevices": ["Apple Watch · Watch7,12", "iPhone"],
  "summarizedAt": "2026-10-07T01:00:00Z",
  "cloudModelAllowed": false,
  "selfAssessmentFrequency": "low",
  "readStates": {
    "sleep": "dataAvailable", "steps": "dataAvailable", "activeEnergy": "dataAvailable",
    "heartRate": "dataAvailable", "restingHeartRate": "dataAvailable", "hrv": "dataAvailable",
    "respiratoryRate": "noDataOrReadDenied", "workouts": "dataAvailable"
  },
  "metrics": {
    "sleep": {"value": 460, "unit": "min", "baselineMean": 480, "baselineDays": 12, "deviationPercent": -4.1667},
    "steps": {"value": 6432, "unit": "count", "baselineMean": 7000, "baselineDays": 14, "deviationPercent": -8.1143},
    "activeEnergy": {"value": 380, "unit": "kcal", "baselineDays": 0},
    "heartRate": {"value": 72, "unit": "bpm", "baselineDays": 0},
    "restingHeartRate": {"value": 58, "unit": "bpm", "baselineDays": 0},
    "hrv": {"value": 40, "unit": "ms", "baselineMean": 50, "baselineDays": 10, "deviationPercent": -20}
  },
  "sleep": {"totalMinutes": 460, "fellAsleepAt": "2026-10-06T05:00:00Z", "wokeAt": "2026-10-06T13:00:00Z"},
  "workoutCount": 1,
  "workoutMinutes": 30
}
```

`metrics` 仅包含有数据且用户启用的项目；缺数据不写 0。心率、静息心率、HRV、呼吸频率为当日样本算术均值；步数/活动能量用 HealthKit 原生累计统计处理手机与 Watch 重叠来源。睡眠仅算 asleep 阶段（不含 inBed/awake），重叠区间取并集；间隔不超过 2 小时的睡眠段作为一次睡眠，以最后起床的本地日期归属，间隔不计时长；同日起床的夜间睡眠和小睡合计。`fellAsleepAt/wokeAt` 是当日睡眠最早入睡与最后起床，不表示中间连续睡着。锻炼按开始日期计次，时长使用 HealthKit workout 的活动 duration（排除暂停），来源为 HealthKit 中已有锻炼；本包不启动实时锻炼或原始传感器采集。

基线为当前日期**之前 14 个本地日历日**内有数据日期的均值，排除当日及缺数据日，`baselineDays` 表示实际天数（首次回填的较早日期可能不足 14 天）。偏离为 `(value / baselineMean - 1) * 100`；无基线或均值为 0 时省略 `baselineMean/deviationPercent` 中无法计算的字段。H1 仅提供日统计；H3 的可选本地估算分数见 6.4，不用于医疗诊断。`sourceDevices` 是去重的 HealthKit 来源应用/设备描述，统计来源未提供硬件名时使用来源应用名；不是原始样本 ID、设备序列号或样本时间线。

`cloudModelAllowed` 必传，默认 false；首次请求健康授权前询问，设置可随时改。true 只允许云端使用摘要，不扩大原始数据权限；false 要从云端召回、提示词与后续云端模型请求中排除这些摘要，仍可供本地模型使用。已上传的摘要在使用选择改变时重新上传替换；服务端应把最新明确选择用于账号已有健康证据，并确保旧索引/衍生记忆不绕过该选择。用户离线改为 false 后，本地即采用新选择，服务器只能在联网提交成功后生效。`selfAssessmentFrequency` 为 `off / low / moderate`，省略时为 low；服务端按账号最新汇总时间将选择与频率应用到全部摘要/待写证据（相同时间 false 优先），旧回填和幂等重试不能覆盖更新的选择。本包只保存频率，不上传自评答案、不实现询问界面。

`readStates` 为 `disabled / notRequested / dataAvailable / noDataOrReadDenied / unavailable / failed`。Apple 不公开读取授权是否被拒绝/撤销，空结果不能据此断言拒绝；`dataAvailable` 只代表此次读到数据。应用内逐类关闭会停止该类查询、移除本地与排队摘要的指标并重新上传替换。系统撤权后再次读取为空，会更新近期摘要，既有摘要不会因此自动等同用户要求全部删除；删除需明确操作。查询失败保留此前已读取数值并标注 failed。

POST 返回 200：`{"summary":{…当前持久化版本…},"duplicate":false,"memory":{"state":"queued","pendingObservedCount":1,"reasonCode":"MEMORY_OBSERVED_UNSUPPORTED"}}`。200 表示摘要与 observed 待办已原子持久化；`memory.state=delivered`、`pendingObservedCount=0` 表示 Core 写入及来源权限已确认。queued 表示待交付，原因可能为 MEMORY_OBSERVED_UNSUPPORTED（旧 Core/未启用）或 MEMORY_OBSERVED_PENDING（传输/清理待重试）；200 本身不保证 Core 已完成。请求只接受上述字段与 6.4 的可选 `derived/hourly`；各指标要求对应 readState 为 dataAvailable/failed、单位匹配、非负有限数值与 0–14 baselineDays；拒绝原始样本和任意追加文本。`metrics.workouts`（如提供）单位 min，`metrics.respiratoryRate` 单位 breaths/min。账号由凭据确定，来源设备必须是本账号签发过的 ID，已撤销设备仍可标记其历史离线摘要。较新汇总完整覆盖同来源/日期记录。

### 6.2 撤权与删除

| 方法与路径 | 请求 / 返回 | 客户端行为 |
|---|---|---|
| DELETE `/personal/v1/health/daily-summaries/{date}` | `{}`；删除账号该日期的所有来源摘要及 observed，并级联撤回 Core 衍生项与索引；200 `{"deleted":true,"date":"2026-10-06"}` （另含 deletedCount、memory；empty 表示 Core 撤回及清理已确认，queued 表示待重试） | 幂等，无记录也成功；Core 有按日期调用方法，H1 设置页只提供全部删除 |
| DELETE `/personal/v1/health/daily-summaries` | `{}`；删除账号全部健康摘要及 observed，并级联撤回 Core 衍生项与索引；200 `{"deleted":true,"scope":"all"}` （另含 deletedCount、memory；empty 表示 Core 撤回及清理已确认，queued 表示待重试） | 设置中明确点击后删除本地摘要、清空上传队列并关闭所有读取类别；先持久化删除待办，成功前保留重试；用户重新开启读取时先完成删除，再上传新摘要 |

撤销系统读取权限在 Apple “健康”应用完成；WeftMate 不写/删 HealthKit 原始记录。关闭读取和删除已上传证据分别表达；服务器删除不是移除用户对话或非健康记忆。服务端原子移除摘要及其 observed 待写内容，只留无健康内容的日期/全部删除时间水位（服务器删除时间与已知汇总时间的较大值）。旧汇总时间不大于水位时 POST 返回 409，重新读取生成的较新摘要可上传；全部删除合并各日期水位。DELETE 同样要求 application/json `{}`、同源 Origin 和 CSRF，JSON ≤12 KiB。当前没有本包写入的 Core 证据，因而不宣称已完成真实 Core 撤回。

### 6.3 错误与重试

| 状态 / 错误码（含兼容旧宿主的客户端重试约定） | 语义 / Apple 行为 |
|---|---|
| 400 `INVALID_HEALTH_SUMMARY` / `INVALID_DATE` | schema、日期、单位或值不合法；保留本地摘要，不宣称上传成功 |
| 401 `UNAUTHORIZED`；403 `FORBIDDEN` / `ORIGIN_NOT_ALLOWED` | 沿用账号认证，账号不匹配不发送；离线队列绝不跨账号上传 |
| 404 `NOT_FOUND`；501 `NOT_IMPLEMENTED` | 服务器尚未实现；**静默保留本地队列**，下次前台/刷新/定时重试，不弹错误 |
| 409 `STALE_HEALTH_SUMMARY` | 旧汇总时间不得覆盖新版本；保留待办，重新读取生成新版本后重试 |
| 413 `BODY_TOO_LARGE`；415 `UNSUPPORTED_MEDIA_TYPE` | 沿用通用约定；不丢摘要、不截断健康内容 |
| 429 `RATE_LIMITED`；503 `STORAGE_UNAVAILABLE` / `SERVICE_UNAVAILABLE`；网络错误 | 安静保留队列，下一次运行重试；不阻塞聊天 |

H1 在进入前台、打开健康设置、手动更新及前台每 15 分钟重读最近 15 天，处理迟到 Watch 同步；不承诺后台定时唤醒。每次先落本地摘要，再尝试队列；404/501 结束本轮，无忙循环。不使用真实宿主进行本包验证。H2 验证客户端 HTTP 边界；MW-2 已用真实 Python Core 与隔离账号通过 observed 写入、目的地过滤、权限变更、衍生项删除/导出/重启集成验收。真实日用宿主与跨设备上传仍未验证。


### 6.4 读取与记忆使用状态

`GET /personal/v1/health/daily-summaries?days=14&timeZone=UTC`：days 默认 14，整数 1–365；timeZone 默认 UTC，必须为系统认可时区。返回该查询时区今日及此前 days-1 日（含两端）的记录，不含未来日期；按日期降序、来源设备 ID 升序，所有来源分别返回。重复或未知查询参数拒绝为 400。账号从凭据确定，GET 不要求 CSRF（如带 Origin 仍需同源）。

```json
{
  "summaries": [{"schemaVersion": 1, "date": "2026-10-06", "sourceDeviceId": "device-phone", "metrics": {"sleep": {"value": 340, "unit": "min", "baselineDays": 0}}, "cloudModelAllowed": false}],
  "days": 14,
  "timeZone": "UTC",
  "preferences": {"cloudModelAllowed": false, "selfAssessmentFrequency": "low", "summarizedAt": "2026-10-07T01:00:00.000Z"},
  "memory": {"state": "queued", "pendingObservedCount": 1, "reasonCode": "MEMORY_OBSERVED_UNSUPPORTED"}
}
```

示例摘要为简化投影；真实 summaries 返回完整已存摘要。memory.pendingObservedCount 是本账号全部待交付来源和待撤回来源的数量，与查询日期窗口无关。已写入 Core 时 memory.state=delivered；没有摘要且撤回清理已确认时为 empty；待交付/待撤回时为 queued。健康文件在宿主 `<personal-access-root>/accounts/<ownerId>/health/daily-summaries.json`，沿用私有目录/文件保护与原子写入。

每条日摘要生成 source_kind=observed 的中文事实，稳定来源为账号/设备/日期。现有 `personal-memory` 管理器通过正式 observed upsert / 来源权限更新 / 真正撤回 RPC 交付，不构造 user/assistant boundary，不另写 SQLite。摘要和交付标记同一宿主文件保存；收到 Core 回执后才清除待办。进程中断或 Core 不可用时，后续健康写入、记忆 status / recall 会重放；DELETE 先移除宿主内容，保留仅含来源哈希与水位的撤回待办，清理完成后移除。

召回使用 3.10 的实际地址及用户 `modelTier` 覆盖判断，initialize 与每次 World / interactions 召回使用最终 local/cloud。`cloudModelAllowed=false` 排除已写入的健康证据及其衍生项、依赖它们的助手历史，保留其他可读记忆；true 后云端可用，撤销选择后立即作用于全账号来源。来源同步失败时该次注入暂缓，待同步成功恢复，不使用旧授权数据。GET 提供客户端读取摘要，客户端不得把本地专用摘要自行注入云端模型。

### 6.4 H3 可选设备端指标与小时聚合

不新增端点或 schemaVersion。H1 的日摘要保持兼容；H3 在同一 JSON 可选增加 `derived` 与 `hourly`，服务端仍只校验、持久化和投影 observed，不在宿主计算。省略字段在下一次较新 upsert 中移除旧值。H3 必须 `cloudModelAllowed=false`；true 返回 `INVALID_HEALTH_SUMMARY`，旧 H1 云使用选择不能放宽 H3。MemoWeft 来源权限沿用 H2，全部设备端分数 / 压力区间的内容明确标记估算；200 仅证明摘要与 observed 待办持久化，Core delivered 仍看回执。

```json
{
  "derived": {
    "algorithmVersion": "weftmate-h3-v1",
    "recovery": {"value":70,"inputs":["hrv","restingHeartRate","sleep"],"baselineDays":14},
    "load": {"value":6.2,"inputs":["activeEnergy","workouts","heartRate"],"elevatedHeartRateMinutes":12,"acuteDays":7,"chronicDays":28,"acute7Mean":5.5,"chronic28Mean":5,"ratio":1.1},
    "sleep": {"stageMinutes":{"core":300,"deep":80,"rem":100},"continuityPercent":96,"durationScore":100,"midpointDeviationMinutes":20,"baselineDays":14}
  },
  "hourly": [{"start":"2026-10-06T18:00:00Z","end":"2026-10-06T19:00:00Z","bodyBattery":64,
    "stress":{"lower":20,"upper":60,"sampleCount":1,"latestSampleAt":"2026-10-06T18:15:00Z","confidence":"sparse"}}]
}
```

以上为添加到 6.1 日摘要的字段片段，不是单独上传体；时区为 America/Los_Angeles、相应 readStates 必须有 dataAvailable，示例睡眠总时长为480分钟。计算依据和所有系数见 COMPANION 4b 的 H3 表。

| 字段 | 约束与含义 |
|---|---|
| `derived.algorithmVersion` | 固定 `weftmate-h3-v1`，随日摘要保存算法版本；不接受任意说明或样本。 |
| `derived.recovery` | 可省略；value为有限0–100；inputs非空去重，只能 sleep/hrv/restingHeartRate/respiratoryRate，要求相应读取状态 dataAvailable；baselineDays 1–14。缺项重归一化，inputs与实际有效天数标明依据。 |
| `derived.load` | 可省略；value有限非负相对单位；inputs为activeEnergy/workouts/heartRate有效组成。elevatedHeartRateMinutes为可选实际样本覆盖分钟；acuteDays 0–7/chronicDays 0–28。完整且输入一致才分别提供acute7Mean/chronic28Mean；两窗完整且慢性均值>0才提供ratio。各值非负有限。 |
| `derived.sleep` | 可省略，要求已有sleep日摘要。stageMinutes仅core/deep/rem/unspecified有限非负分钟，合计≤总睡眠分钟；continuityPercent 0–100。可选durationScore 0–100、midpointDeviationMinutes 0–720，baselineDays 0–14。这些是个人历史比较，不是医学睡眠效率。 |
| `hourly[]` | 可省略，最多25个按UTC升序且不重叠的小时聚合；start/end为UTC ISO8601，每桶0<时长≤1小时，全部落在本摘要日期 / 时区内，end≤summarizedAt。夏令时23/25小时用独立UTC桶；当前小时可不完整。 |
| `hourly[].bodyBattery` | 可省略，有限0–100，是桶结束时的电量估算。缺压力 / 活动只积分已知贡献，不把结果表达为实际测得电量。 |
| `hourly[].stress` | 可省略；lower/upper有限0–100且lower≤upper；sampleCount为正安全整数；latestSampleAt在本桶内；confidence为sparse/sampled。这是启发式区间，不是统计置信区间或持续测量。要求本日hrv/heartRate读取状态dataAvailable。无样本的小时省略stress，不补0或延续上一小时。 |

所有可选字段缺失时不编码null；每小时至少提供电量或压力之一。单位和健康读取项目沿用6.1，不接受原始观测、任意文本或追加健康类别。12 KiB上限不变，H3仅传聚合；应用内关闭任一贡献输入先从本地 / 排队摘要移除派生字段，再从剩余启用数据重新计算；删除仍使用6.2并清空所有日 / 小时数据。

## 7. 云端账号与宿主云身份（S1a / S1b / S1c-Web / S1d）

7.1–7.3 由独立 `services/cloud/` 提供；7.4 是电脑宿主接口。桌面/手机浏览器与 Android 壳已接入 S1c-Web；Apple 客户端另包。云账号只授予云控制面访问，不授予宿主内容、shell 或备份解密权限；S1b 已实现宿主验签、DPoP、认领和 `/auth/cloud-session`。现有本地 `/auth/login(username)`、Cookie、ownerId 和数据不变。本节路径使用完整前缀，不计入第 1 节原宿主 81 项基线。

### 7.1 账号交互接口

issuer 示例 `https://api.example.com/personal/v1/cloud/oidc`；账号接口 origin 为 `https://api.example.com`。除标准 OIDC token/revocation 外，所有 POST 要求云 Origin 或 `CLOUD_OIDC_CLIENTS` 已登记回调的 HTTP(S) origin；JSON 或表单、体 ≤16 KiB。GET `/account` 接受云 access token 的 Bearer / DPoP，不接受本地 Cookie/ID token。登录 Cookie 用于 OIDC 交互，host-only、HttpOnly，HTTPS 下 Secure/SameSite=None（支持 App 内跨 origin 交互），隔离 HTTP 回环开发仍为 SameSite=Lax；登录与设备确认额外绑定 Cookie/interaction/CSRF。D29 新客户端按 **7.8** 完成 App 内账号页，不导航到云网页。

`Account` = `{"cloudAccountId":"<UUID>","email":"account@example.com","auth_epoch":0}`。ID 永久不变且作为 OIDC public `sub`；邮箱 trim/NFKC/ASCII 小写、唯一，不折叠加号或服务商特定点号。密码 15–128 个 Unicode code points。`Challenge` = `{"challengeId":"<UUID>","expiresIn":600}`；验证码只有开发 outbox 或实际邮箱可见，接口不回传。

| 方法与路径 | 请求 | 响应 / 语义 |
|---|---|---|
| POST `/personal/v1/cloud/auth/register` | `{email,password}` | 201 Challenge；只建 pending 账号，验证后激活。邮箱占用 409 `EMAIL_IN_USE` |
| POST `/personal/v1/cloud/auth/register/resend` | `{email}` | 200 Challenge；不替换原密码，不存在/已激活邮箱返回同形随机 challenge，不发邮件 |
| POST `/personal/v1/cloud/auth/register/verify` | `{challengeId,code}` | 200 `{account:Account,verified:true}`；一次性激活，未验证账号不能登录 |
| GET `/personal/v1/cloud/interactions/{uid}` | OIDC 授权重定向得到的地址，携带交互 Cookie | `Accept: application/json` 返回 `{interactionUid,csrfToken,clientId}`；否则是最小登录表单。uid 不由客户端自造 |
| POST `/personal/v1/cloud/auth/login` | `{interactionUid,csrfToken,email,password,deviceId,publicJwk?}`，携带交互 Cookie | 已确认设备 200 `{account:Account,resumeUrl}`；新设备 202 `{confirmationRequired:true,challengeId,expiresIn:600}`，此时没有令牌/授权码 |
| POST `/personal/v1/cloud/auth/device/confirm` | `{interactionUid,csrfToken,challengeId,code}`，同一交互 Cookie | 200 `{account:Account,resumeUrl}`；验证码须来自该登录交互。浏览器表单成功时 303 到 resumeUrl |
| POST `/personal/v1/cloud/auth/password/request` | `{email}` | 200 Challenge；未激活/不存在邮箱返回同形随机 challenge，不发邮件 |
| POST `/personal/v1/cloud/auth/password/reset` | `{challengeId,code,password}` | 200 `{passwordChanged:true,notificationAccepted:true}`；更新密码、epoch +1，撤销旧刷新族/云会话/授权码/pending 验证码；通知服务失败时 notificationAccepted=false，重置已提交，不回滚 |
| GET `/personal/v1/cloud/account` | `Authorization: Bearer <cloud access token>` | 200 `{account:Account}`；校验 issuer/audience/RS256/type/exp/实时 epoch/设备/scope |
| POST `/personal/v1/cloud/auth/email/request` | 云 Bearer + `{email,password}` | 200 Challenge；验证当前密码后给新邮箱发验证码，已占用 409 |
| POST `/personal/v1/cloud/auth/email/confirm` | 云 Bearer + `{challengeId,code}` | 200 `{account:Account}`；ID 不变，新邮箱生效、epoch +1，撤销旧会话/刷新族及旧邮箱验证码，需重新登录 |

`deviceId` 格式 `[A-Za-z0-9_.:-]{1,128}`。可选 `publicJwk` 为 RSA/EC/OKP 公钥 JWK，不得含任何私钥字段；新标识或同标识的新公钥均要求邮件确认，无全局设备数上限。S1a 登记的是调用方声明的标识/公钥，**尚无私钥持有证明**，不能当成宿主信任设备。每次新的 OIDC 授权都要求密码交互，旧 SSO Cookie 不能跳过本次设备检查。

200 resumeUrl 是恢复 OIDC 授权的云同源地址；不是 access token。旧客户端可继续用原认证浏览器打开；D29 客户端通过 7.8 的 `/auth/authorization/resume` 获取回调数据，全部留在 App 内。保存最终授权码并用原 PKCE verifier 交换，校验原 state 与 nonce。最小云浏览器表单仍只覆盖登录/新设备确认，完整账号页面由 LG-1 / LG-2 实现。

### 7.2 OIDC 与令牌

| 方法与路径 | 契约 |
|---|---|
| GET `/personal/v1/cloud/oidc/.well-known/openid-configuration` | 标准 OIDC discovery；固定 issuer、授权/token/JWKS/revocation 地址 |
| GET `/personal/v1/cloud/oidc/.well-known/oauth-authorization-server` | provider 的 OAuth metadata 同路径挂载 |
| GET `/personal/v1/cloud/oidc/auth` | `client_id,redirect_uri,response_type=code,scope=openid offline_access cloud:account,prompt=consent,state,nonce,code_challenge,code_challenge_method=S256`；公开客户端须预登记 redirect URI。offline_access 须明确 consent |
| GET `/personal/v1/cloud/oidc/auth/{uid}` | provider 内部恢复路由，只沿交互返回的 resumeUrl 使用 |
| POST `/personal/v1/cloud/oidc/token` | 标准 `application/x-www-form-urlencoded`：code 交换用 `grant_type=authorization_code,client_id,redirect_uri,code,code_verifier`；刷新用 `grant_type=refresh_token,client_id,refresh_token` |
| POST `/personal/v1/cloud/oidc/token/revocation` | 标准 RFC7009 form：`client_id,token,token_type_hint?`；撤销 provider 管理的刷新授权族 |
| GET `/personal/v1/cloud/oidc/jwks` | 公开 RSA JWKS，kid 轮换；不含私钥，旧 key 保留至已发 token 过期与时钟余量结束 |

不支持 password grant、implicit response、动态客户端注册或未登记宿主 audience。客户端是 public/native、无 client secret。授权码 60 秒且单次使用；PKCE 只接受 S256。标准 token 响应包含 `access_token,token_type=Bearer,expires_in=300,id_token,refresh_token,scope`，openid/离线范围请求决定 ID/refresh 字段是否出现。每次刷新须原子替换已保存的 refresh token；旧 token 复用会撤销整个族及后继，族绝对寿命 30 天。

访问令牌是 RS256、`typ=at+jwt`，包含 `iss,aud,sub,device_id,device_fingerprint,scope,auth_epoch,iat,exp,jti,client_id`。控制面 aud 为 `<issuer origin>/personal/v1/cloud`。S1b 另支持显式 `resource=<cloud audience>/hosts/<hostId>`、`scope=openid offline_access host:session`；仅已登记宿主的成员可授权。宿主 access token 增加 `host_id` 和 DPoP `cnf.jkt`，aud 为该确定宿主 resource，scope 含 host:session；token endpoint 必须提交标准 DPoP 证明，密钥须与该登录交互的邮件已确认设备公钥一致，返回 token_type=DPoP。云与宿主 token 均不含邮箱/用户内容。ID token 的 aud 是 client_id、含 nonce；不可用它授权 API。未知 kid 从固定 JWKS 地址刷新一次；issuer/aud/算法/有效期不匹配或获取失败时拒绝，不信 JWT 自带 jku/x5u。原生刷新凭据放 Keychain/Keystore/系统凭据库；浏览器不放 localStorage。

复用/撤销让刷新与授权码失效；已发自包含 JWT 仍有最多 5 分钟的离线有效窗口。密码重置与换邮箱同时递增 epoch，本服务实时检查立即拒绝旧 JWT；S1b 宿主通过签名撤销事件与轮询接收，事件到达后关闭活跃流并拒绝旧会话；离线宿主不能称立即生效。

### 7.3 错误、限速与邮件

业务错误形状 `{error:{code:"CODE_INVALID"}}`；标准 OIDC token 错误遵循 OAuth `{error:"invalid_grant",error_description:"…"}`，不能用宿主错误解析器混读。

| 状态 / 业务码 | 含义 |
|---|---|
| 400 `INVALID_EMAIL / INVALID_PASSWORD / INVALID_DEVICE / INVALID_DEVICE_KEY / INVALID_REQUEST` | 输入无效；邮箱不接受非 ASCII 登录字符，支持 NFKC 后合法形式 |
| 400 `CODE_INVALID / CHALLENGE_INVALID / INTERACTION_INVALID / HOST_NOT_ALLOWED` | 错验证码；challenge 过期/已用/错误次数用尽/用途或 epoch 不符；交互 Cookie 不符；Host 不匹配 issuer |
| 401 `INVALID_CREDENTIALS / UNAUTHORIZED` | 密码错误、云令牌无效或已撤销 epoch |
| 403 `EMAIL_NOT_VERIFIED / CSRF_INVALID / ORIGIN_NOT_ALLOWED / FORBIDDEN` | 未激活、交互 CSRF 错、Origin 错、不是同账号 challenge |
| 409 `EMAIL_IN_USE` | 邮箱规范化后占用，包括 pending 注册 |
| 413 / 415 / 405 | `BODY_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE / METHOD_NOT_ALLOWED` |
| 429 `RATE_LIMITED` | 遵循整数秒 `Retry-After`，不得立即忙重试 |
| 503 `MAIL_UNAVAILABLE / SERVICE_UNAVAILABLE` | 验证邮件投递失败 / 服务存储不可用；密码已提交但通知失败通过 notificationAccepted 单独表达 |

六位验证码有效 10 分钟、单次使用、每 challenge 最多 5 次错误。失败按账号和来源分别计数，跨接口共享小时窗口，第 5 次起 1 秒指数退避、最多 1 小时；验证码与登录均覆盖。邮件请求另按账号/来源限制，第 5 次后 10 分钟退避。限速状态重开保留，来源地址只存 HMAC 桶，默认不信调用方 X-Forwarded-For；部署时由显式回环代理设置真实来源。

file 开发传输只写专属私有 JSON outbox；Resend 要显式环境变量密钥与发件人。模板含注册验证码、找回、新设备确认、新邮箱验证、密码已更改；provider 接受不等于邮箱已送达。本包只验 file 与 Resend mock，无真实发信、客户端/宿主或公网验收。


### 7.4 宿主认领、会话交换与内容设备（S1b）

以下路径由**个人电脑宿主**提供，仍在 `/personal/v1`。旧本地账号绑定使用原 Cookie + `X-WeftMate-CSRF`；任何写操作要求同源 Origin、JSON ≤16 KiB，拒绝多余字段与 query。认领/绑定/解绑/生成当面配对挑战还要求原**电脑直接地址**的本地密码 Cookie 或 7.8 自动绑定电脑的已受信云 Cookie（普通手机云 Cookie / 管理 Bearer 不可用）；无密码 legacy 账号沿用原 setup grant。D29 新电脑无需先本地登录，使用 7.8 `/auth/cloud-desktop`。调用方不传 ownerId，账号从 Cookie 或验证后的云 sub 确定。

| 方法与路径 | 请求 | 返回 / 语义 |
|---|---|---|
| POST `/personal/v1/cloud/claims` | `{}` + 本地 Cookie/CSRF | 200 `{claimId,hostId,challenge}`；生成/保留安装与内容 TLS 密钥，主动向云取挑战；中断后同本地账号取回原 claimId，已完成相同绑定也幂等 |
| POST `/personal/v1/cloud/binding` | `{claimId,accessToken}` + 本地 Cookie/CSRF；accessToken 为新鲜 cloud:account 控制面令牌 | 200 `{bound:true,ownerId,hostId}`；保存 pending，安装密钥签名，云确认成员后 active；可用原 claimId、新云登录重试。冲突不合并账号，不上传 ownerId/内容 |
| DELETE `/personal/v1/cloud/binding` | `{}` + 本地 Cookie/CSRF | 200 `{unbound:true}`；撤销当前账号云映射与内容设备，异步幂等撤销云 membership；保留本地账号、密码与所有数据 |
| POST `/personal/v1/auth/cloud-nonce` | `{}`；无 Cookie/Bearer 要求，但需同源 Origin | 200 `{nonce,expiresIn:120}`，同时返回 `DPoP-Nonce`；宿主随机 nonce 单次使用，保存在本机日志 |
| POST `/personal/v1/auth/cloud-session` | `{accessToken,deviceName}` + `DPoP: <proof JWT>`；**不得带 Authorization**；旧 Cookie 可随浏览器自动携带但不参与授权 | 已受信 200，响应形状与 `/auth/login` 相同：`{account,device,csrfToken}` + 宿主 HttpOnly/SameSite=Strict Cookie（HTTPS Secure）；未受信 202 `{status:"pending_approval",requestId}`，无 Cookie/内容 |
| GET `/personal/v1/cloud/devices/pending` | 已认证本账号本地/云 Cookie（account:manage） | 200 `{devices:[{id,name,requestedAt,fingerprint}]}`；仅当前 owner 的待批准设备公钥指纹，不含另一账号的数据 |
| POST `/personal/v1/cloud/devices/{id}/decision` | `{decision:"allow"}` 或 `{decision:"deny"}` + 同账号 Cookie/CSRF | 200 `{decision}`；同一决定幂等。允许后该设备以**新 nonce/新 DPoP** 重试交换；相反决定 409，跨账号 404 |
| POST `/personal/v1/cloud/pairings` | `{}` + 电脑直接地址本地 Cookie/CSRF | 201 `{challenge,expiresIn:120,hostId,tlsSpki,publicJwk,origin}`；一次性当面配对材料，供 S1c 二维码展示/扫描；pub 为安装公钥，pin 来自宿主本机 |
| POST `/personal/v1/cloud/pairings/redeem` | `{challenge,accessToken,deviceName}` + DPoP；无 Authorization；旧 Cookie 忽略 | 校验该云 sub 已绑定且 challenge 属于相同 owner、未过期/未用；本地登记 DPoP 公钥并返回 200 宿主 Cookie/CSRF，响应与交换相同 |

DPoP proof 是 ES256 `typ=dpop+jwt`、仅公钥 `jwk`；含随机 `jti`、±60 秒 `iat`、`htm=POST`、**精确宿主 origin + 本次入口路径** `htu`（无 query/fragment）、`ath=base64url(SHA-256(accessToken))` 与宿主 nonce。nonce 与 `(公钥指纹,jti)` 提交后不可复用，重启不清空。宿主检查固定 issuer、RS256、固定 JWKS、`typ=at+jwt`、aud/host_id、host:session、sub/device_id/auth_epoch/iat/exp/jti/cnf.jkt；不接受 ID token，不读取 token jku/x5u，不把 JWT 送旧 Bearer tokenHash 路径。仅 DPoP 有效不构成内容信任；未知公钥仍返回等待批准。

桌面/手机 Web 与 Android 在打开应用及前台每 15 秒读取待批准设备，可允许/拒绝；桌面设备卡展示一次性二维码并在两分钟后刷新。Android 本包用输入配对码，相机扫描另包；推送提醒在 S3。这里的 tlsSpki 已有本机内容密钥，实际 TLS listener/证书/原生 pin 连接验收在 S2。

新增宿主业务码：401 `CLOUD_TOKEN_INVALID / DPOP_INVALID / DPOP_REPLAY / PAIRING_INVALID`；403 `LOCAL_SESSION_REQUIRED / CLOUD_NOT_BOUND / DEVICE_NOT_TRUSTED`；400 `CLAIM_INVALID`；409 `CLOUD_BINDING_CONFLICT / DEVICE_DECISION_CONFLICT`；503 `CLOUD_UNAVAILABLE / STORAGE_UNAVAILABLE`。Origin、CSRF、媒体类型、大小与原宿主约定一致。等待批准是正常 202，禁止当作已登录内容账户；拒绝/撤销返回 403，需电脑/受信设备重新明确批准，不能自动用邮箱恢复信任。

显式 DELETE 原 `/auth/devices/{localDeviceId}` 也撤销其对应云内容公钥及全部该公钥会话；当前流立即关闭，本地 outbox 等联网后同步。logout 只退出当前 Cookie。云 epoch 撤销与本地 authEpoch 分开；新的云 epoch 不自动撤销既有公钥信任，旧 Cookie 无效，本地密码/旧合法本地 Cookie/Bearer 不变。云已发 JWT 尚有最多 5 分钟有效窗；宿主每 60 秒轮询及启动同步，收到签名事件后立即失效；断网不能承诺取得最新撤权。有效宿主 Cookie 不要求每次请求联网，云离线不阻断本地登录。

### 7.5 云控制面的宿主配合接口

此表仍由 `services/cloud/` 提供，全部 POST/云或已登记回调 Origin/JSON ≤16 KiB。云只保存安装公钥、内容 TLS 公钥 pin、cloudAccountId/hostId/member 与最小撤权/设备元数据；目录不返回可信 pin。

| 方法与路径 | 请求 / 授权 | 响应 / 语义 |
|---|---|---|
| POST `/personal/v1/cloud/hosts/claims` | `{claimId,hostId,publicJwk,tlsSpki}` | 200 `{claimId,challenge,status}`；相同内容幂等，公钥/hostId/pin 冲突 409；pending 挑战 10 分钟，过期可用相同 claimId 更新 |
| POST `/personal/v1/cloud/hosts/claims/confirm` | cloud:account Bearer + `{claimId,proof}` | 200 `{confirmed:true,hostId,sub}`；proof 为安装密钥 ES256、typ=wm-host-claim+jwt、iss=hostId、aud=issuer、iat/exp 与 claimId/challenge/sub；仅已验证且实时 epoch 有效账号可确认；相同 claimId/sub 幂等 |
| POST `/personal/v1/cloud/hosts/revocations` | `{hostId,proof}`；安装密钥 ES256 typ=wm-host-request+jwt，iss=hostId/aud=issuer、iat/exp/jti、action=/hosts/revocations、afterSeq | 200 `{eventToken}`；RS256 typ=wm-cloud-revocations+jwt、iss=issuer/aud=该宿主 resource，含有序 events 与 watermark；只含此宿主成员的 epoch/device 事件，批次最多 1000，水位可续取 |
| POST `/personal/v1/cloud/hosts/devices/revoke` | 同上安装 proof，action=/hosts/devices/revoke、sub/deviceId/jkt/requestId | 200 `{revoked:true}`；确认 member，按 requestId 幂等登记该宿主内容设备撤销；不删除账号/内容 |
| POST `/personal/v1/cloud/hosts/memberships/unbind` | 同上安装 proof，action=/hosts/memberships/unbind、sub/claimId/requestId | 200 `{unbound:true}`；仅删除匹配 claimId 的旧 membership，旧重试不能撤销新绑定 |
| POST `/personal/v1/cloud/auth/devices/revoke` | cloud:account Bearer + `{deviceId}` | 200 `{revoked:true}`；仅本云账号，撤销该设备云登录/刷新族，写 device 事件，供所有已绑定宿主同步 |

安装请求 proof 有效 60 秒、允许 30 秒时钟差，jti 重放记录在云 SQLite；每次重试生成新 proof，业务 requestId/claimId 保持不变。eventToken 有效 300 秒，事件形状为 `{seq,sub,kind:"epoch",epoch}` 或 `{seq,sub,kind:"device",deviceId,jkt?}`；不含内容、邮箱、本地 ownerId。密码重置/换邮箱递增 epoch 的事件与原云操作同一数据库事务提交。宿主只从固定 JWKS 验证事件；后续推送/中继通道可交付相同签名 envelope。

### 7.6 经中继访问宿主（S2）

云控制面与内容宿主是不同 origin。客户端先以 cloud:account Bearer 调用下表 discover，选择确定的 hostId，然后将**宿主** base URL 改为 `https://h-<32 位随机 hex>.hosts.example.com`（TCP 443）；原 `/personal/v1/…` 路径、账号与 ownerId、历史游标、requestId、附件校验保持。内容、宿主密码与宿主 Cookie 只发宿主 origin，不送 `api.example.com`。宿主提供同 origin 的 Web UI/静态资源；不开放跨 origin 内容 CORS。

| 提供者 / 方法与完整路径 | 请求 / 授权 | 响应 / 语义 |
|---|---|---|
| 云 POST `/personal/v1/cloud/hosts/relay/discover` | `{hostId}` + cloud:account Bearer；同源云 Origin | 200 `{hostId,baseUrl,status:"online"\|"offline"\|"revoked"}`；尚未建立中继时 baseUrl=null；非成员 404 `NOT_FOUND`；无 pin/凭据 |
| 云 POST `/personal/v1/cloud/hosts/relay/account-revoke` | `{hostId}` + cloud:account Bearer；同源云 Origin；仅原认领成员的 transport owner | 200 `{revoked:true,closedConnections}`；先持久撤销，再关闭该宿主现有控制与内容连接；普通成员 403，不影响宿主本地账号/数据/直连 |
| 云 POST `/personal/v1/cloud/hosts/relay/credentials` | `{hostId,proof}`，沿用 7.5 安装签名，action 对应路径 | 200 `{hostId,baseUrl,status,credential,generation,serverAddr,serverPort:443,serverName,proxyName}`；仅已认领安装。首次分配随机域名、重复取回幂等；credential 是秘密，只供宿主 frpc，不给客户端 |
| 云 POST `/personal/v1/cloud/hosts/relay/rotate` | 同上安装 proof，额外签入稳定 requestId | 200 同 credentials；同 requestId 幂等；新 generation 关闭旧连接，域名与内容 pin 不变；宿主 `rotateRelayCredential(requestId)` 同时重启 sidecar |
| 云 POST `/personal/v1/cloud/hosts/relay/revoke` | 同上安装 proof | 200 `{revoked:true,closedConnections}`；安装本身也可撤销；撤销记录重开后仍有效，取凭据不会自动恢复 |
| 云 POST `/personal/v1/cloud/hosts/relay/dns/present`、`…/dns/cleanup` | 同上安装 proof，额外签入 `{value:"<43 字符 base64url ACME TXT>"}` | 200 `{name:"_acme-challenge.<自己的宿主域名>",updated:true}`；name/type/zone/TTL 不可由调用方指定；云 provider 未配置时 503 `DNS_NOT_CONFIGURED`；present 在全部权威 NS 查询到 TXT 后返回（约 90 秒等待）；503 `DNS_PROVIDER_ERROR` / `DNS_PROPAGATION_TIMEOUT` / `DNS_ZONE_MISMATCH` 表示 API/传播/区配置失败；cleanup 仅删 provider 自己写入的 RecordId，输入错误 400 `INVALID_DNS_CHALLENGE` |
| 宿主 GET `/personal/v1/status` | 原宿主 Cookie / 合法 Bearer | 新增 `relay:{state:"disabled"\|"stopped"\|"connecting"\|"online"\|"offline",baseUrl:string\|null,errorCode?:"RELAY_UNAVAILABLE"\|"FRPC_START_FAILED",certificateExpiresAt?:string\|null,certificateErrorCode?:string\|null}`；来自私有 frpc 代理状态；到期为 UTC ISO8601，最近签发错误为 DNS_NOT_CONFIGURED / DNS_PROVIDER_ERROR / DNS_PROPAGATION_TIMEOUT / DNS_ZONE_MISMATCH / CLOUD_UNAVAILABLE / CERTIFICATE_KEY_DOMAIN_MISMATCH / CERTIFICATE_INVALID_DATES / CERTIFICATE_ISSUANCE_FAILED 或 null；未启用中继时证书字段可省略，不含秘密 |
| 宿主 POST `/personal/v1/cloud/pairings` | 沿用 7.4 的**已认证直接地址**本地密码或自动绑定电脑的受信 Cookie/CSRF | 原响应额外含 `relay`（同上状态/baseUrl）；`tlsSpki` 是实际 TLS listener 同一把内容公钥的 DER SPKI SHA256、base64url 无 padding。已有信任/当面配对通道是 pin 来源 |

安装请求仍要求有效 60 秒、允许 30 秒偏差、云持久防重放 jti 与同源 Origin；不得把凭据取回接口当作公开目录。新增云错误：503 `RELAY_NOT_CONFIGURED / DNS_NOT_CONFIGURED`，403 `HOST_NOT_CLAIMED / RELAY_REVOKED`。最初认领的成员只具有宿主**传输**管理权；不会获得其他本地账号内容权限；既有 S1b 宿主迁移保留其原首个 membership 作为 transport owner。最后一个成员解绑也撤销中继。重新启用已撤销宿主的管理/客户端流程留给后续包，本包不自动复活凭据。

浏览器同源写入必须带该宿主 public `Origin`、JSON 与原 `X-WeftMate-CSRF`；Cookie host-only/HttpOnly/SameSite=Strict/HTTPS Secure。adapter 拒绝客户端 Forwarded/X-Forwarded-*，覆盖宿主可信转发头；Host/SNI 必须是认领域名。`auth/setup`、认领/绑定/解绑/生成当面配对仍只允许电脑直接地址，不通过中继执行。DPoP 的 htu 使用本次实际宿主 HTTPS origin + 完整入口路径；既有配对、nonce 与 CSRF 规则不变。

**离线与断流不是云伪造的宿主响应**：透传入口无法在不终止内容 TLS 的情况下保证返回宿主 JSON。离线/撤销/未就绪时可能 TLS 握手失败、EOF/连接重置、超时；已开始的 SSE/下载会直接断流。客户端将这些网络错误呈现为「宿主离线 / 连接不可用」，结合 discover 的 offline/revoked 状态；不可当作正常 200 或自动退出云账号。若 TLS adapter 已收到请求但本机 HTTP 入口不可用，可返回 HTTP 502（空体）。请求到达宿主后的 401/403/503 仍按原契约；云接口自身不可用为 503，和内容路径网络失败区分。online 仅为最近 15 秒连接/心跳指示，不是请求完成证明。

重连后继续使用未过期宿主 Cookie，历史用 beforeSeq/afterSeq 与原水位，SSE 重新订阅；附件断流须按大小/SHA256 重取，未见终止标记不得认定已完成。原生端先执行标准 CA/域名验证，再比较配对得到的 SPKI；错误 pin 或同域另一合法证书均拒绝，不能以云目录覆盖 pin。证书续期使用同一内容 key；换 key 的可信更新另包。普通浏览器远程访问已由 D24 允许，接受云/DNS 完全主动控制时可被冒充的边界。


### 7.7 浏览器与 Android 云登录（S1c-Web）

| 提供者 / 方法与路径 | 请求 / 响应 |
|---|---|
| 宿主 GET `/personal/v1/cloud/config` | 无认证；200 `{issuer,hostId,clientId}`。只公开固定发行者与公开客户端 ID，不含绑定账号、公钥、凭据；未启用云为原 404 |
| 宿主 GET `/personal/v1/cloud/binding` | 本账号 Cookie；200 `{status:"unbound"\|"pending"\|"active",canManage,hostId}`。只返回当前账号；canManage 仅电脑直接地址的本地密码 Cookie 为 true，实际写权限仍按 7.4 检查 |

浏览器从宿主同 origin 的 `/personal/v1/ui/` 登录。`WEFTMATE_CLOUD_WEB_CLIENT_ID` 默认 `weftmate-web`；云 `CLOUD_OIDC_CLIENTS` 增加可选 `application_type:"web"\|"native"`（旧配置默认 native），**预登记精确回调 URI**。浏览器回调固定 `<宿主 origin>/personal/v1/ui/`，包括实际直接地址与中继地址；禁止通配符。Android 客户端 ID 为 `weftmate-android`，回调为 `com.memoweft.weftmate:/oauth`。部署配置需同时登记两个公开客户端；开发的回环 HTTP 仅在已有隔离测试开关下使用。

授权请求仍为 7.2 Code + S256 PKCE，浏览器用标准 `response_mode=fragment`，Android 用 query。附加 `wm_device_id` 和 `wm_public_jwk`（仅公钥 JSON）给云同源登录表单自动填入隐藏字段；设备标识、公钥仍经过原邮件确认，不能因此获得内容信任。表单 publicJwk JSON 字符串由服务器解析后走原验证，JSON 调用方仍可传对象。OIDC CORS 只允许该客户端已登记回调 origin（公开 JWKS 按已登记 origin），S1d 账号业务也接受已登记回调 origin，支持 App 内表单；宿主不开放内容 CORS。云表单 CSP 的 form-action 仅允许 self 和该次已登记回调的 origin/scheme，防止浏览器拦截成功授权的返回跳转。

WebCrypto 生成不可导出的 P-256 私钥，CryptoKey 与公开设备标识存 IndexedDB。校验 state、nonce、回调、固定 issuer/JWKS、RS256、audience、期限及 ID/access token 同一 sub；不使用 ID token 访问内容。等待批准时保留云凭据在 IndexedDB、正常每 3 秒用新 nonce/DPoP 重试；网络失败显示连接不可用并减慢重试，拒绝不自动重新排队。刷新原子替换旧 refresh token；得到宿主 HttpOnly Cookie 后删除临时云令牌。本地密码和云表单密码均不持久化，刷新令牌不进入 localStorage。

桌面「添加新设备」二维码是 `<relay.baseUrl 或直接 origin>/personal/v1/ui/#pair=<base64url 配对 JSON>`；可复制码为 `wm1.<同一 base64url>`。内容完全来自 7.4/7.6 配对响应（包括 challenge、hostId、origin、tlsSpki、publicJwk、relay），两分钟单次使用，消费仍走 `/cloud/pairings/redeem` 与原 DPoP 验证。二维码持有者仍需登录同一云账号；短码不是独立认证。浏览器遵循 D24，不能在 WebCrypto 中声称实现 TLS pin。

Android 0.8.2 / native code 15 的 WebView 保持本地界面，OIDC 在系统认证浏览器打开，经自定义 scheme 回到同一 Activity；只接收匹配原 state 的回调。首次云登录用输入配对码取得宿主 pin，无相机权限；密钥仍由 WebCrypto/IndexedDB 保存，刷新凭据与宿主 Cookie 存原生 Keystore 加密设置。原生所有宿主 HTTP/SSE/下载/更新连接先完成系统 CA/域名验证，再比较当面配对的 SPKI；不接受云目录替换已有 pin。电脑 key 轮换、相机扫描、Android 真机往返与 Apple 接入另包。此版手机 UI 发布时需 `--min-native-version-code 15`，旧壳保留原本地登录。此段描述已交付的 S1c 兼容路径；D29 的新页面改走下节 App 内接口，由 LG-1 / LG-2 接线。

Windows（视窗系统）日用桌面部署使用 `weftmate-desktop`、`application_type=native`（原生客户端），预登记 `http://127.0.0.1:18186/personal/v1/ui/`。宿主的 `WEFTMATE_CLOUD_WEB_CLIENT_ID` 在此部署也设为 `weftmate-desktop`，使 `/cloud/config` 的默认客户端与桌面一致；桌面另设 `WEFTMATE_CLOUD_DESKTOP_CLIENT_ID` / `WEFTMATE_CLOUD_DESKTOP_REDIRECT_URI`。旧本地账号从「离线使用这台电脑」以本地账户名和原密码登录，设置中的绑定使用 7.8 App（应用）内云账号页及原生凭据桥：先 `/cloud/claims`，再将云控制面令牌提交 `/cloud/binding`。保留原本地 Cookie（会话凭据）、ownerId、密码和数据，不调用 `/auth/cloud-desktop` 创建另一个账号。注册、找回或绑定失败重试仍保留同一认领；取消结束本次绑定。成功后清除仅供绑定使用的云令牌，继续原本地会话。远程浏览器的 HTTPS（加密连接）登录须另行登记真实来源，不能复用桌面回环回调。

### 7.8 App 内账号与设置设备（S1d / D29）

本节供 LG-1（Windows 程序 / 网页 / Android）与 LG-2（Apple）调用，页面留在 App 内。云仍用锁定的 `oidc-provider`，沿用 **Authorization Code + PKCE S256（授权码与校验）/ DPoP（设备密钥持有证明）/ refresh rotation（刷新令牌轮换）**。没有密码授权模式或第二套令牌。所有新账号接口 JSON ≤16 KiB、`Cache-Control: no-store`，请求 Origin 为云自身或已预登记回调 origin；原生请求可显式带云 Origin。注册/找回的 `passwordTicket` 是随机、服务端只存 HMAC（带密钥摘要）的短期设置密码凭据，不是登录/内容令牌。

**账号页接口（以下路径均由云提供）**：

| 方法与完整路径 | 请求 | 响应 / 语义 |
|---|---|---|
| POST `/personal/v1/cloud/auth/registration/request` | `{email}` | 200 `{challengeId,expiresIn:600}`；仅邮箱，不提前要求密码；已激活邮箱 409 EMAIL_IN_USE；pending 可重发 |
| POST `/personal/v1/cloud/auth/registration/verify` | `{challengeId,code}` | 200 `{passwordTicket,expiresIn:600}`；消费注册验证码，账号仍不能登录 |
| POST `/personal/v1/cloud/auth/registration/complete` | `{passwordTicket,password}` | 200 `{account:{cloudAccountId,email,auth_epoch},verified:true}`；设置独立 scrypt 密码并激活；随后在同一 App 走登录接口 |
| POST `/personal/v1/cloud/auth/recovery/request` | `{email}` | 200 `{challengeId,expiresIn:600}`；未知/未激活邮箱同形响应，不发信 |
| POST `/personal/v1/cloud/auth/recovery/verify` | `{challengeId,code}` | 200 `{passwordTicket,expiresIn:600}`；消费找回验证码 |
| POST `/personal/v1/cloud/auth/recovery/complete` | `{passwordTicket,password}` | 200 `{passwordChanged:true,notificationAccepted}`；递增 epoch，撤销此账号旧授权码/刷新族/会话/票据，回登录页 |
| POST `/personal/v1/cloud/auth/authorization` | `{clientId,redirectUri,deviceId,publicJwk,codeChallenge,state,nonce}` | 200 `{interactionUid,csrfToken,clientId,appLogin:true,deviceId}` + 交互 Cookie；redirect 必须预登记，P-256 公钥、S256 challenge 43 字符、state/nonce 16–256 字符；服务端通过 provider 标准 HTTP 授权端点开始交互 |
| POST `/personal/v1/cloud/auth/login` | `{interactionUid,csrfToken,email,password,deviceId,publicJwk,deviceName?,deviceType?}` | 沿用 7.1：新标识/公钥 202 `{confirmationRequired:true,challengeId,expiresIn}`，否则 200 `{account,resumeUrl}`；App 交互必须与 bootstrap（初始登记）的 deviceId/JWK 一致。name 默认 WeftMate device，type 为 windows/macos/android/ios/web/unknown |
| POST `/personal/v1/cloud/auth/device/confirm` | `{interactionUid,csrfToken,challengeId,code}` | 200 `{account,resumeUrl}`；新云设备邮件确认只允许云登录，内容仍按 D23 等待批准 |
| POST `/personal/v1/cloud/auth/authorization/resume` | `{resumeUrl}` + 同一交互 Cookie | 200 `{callbackUrl}`；恢复 provider 授权，不打开回调网页/系统浏览器；只允许固定 issuer 下的授权恢复路径 |
| POST `/personal/v1/cloud/oidc/token` | 标准 form（表单）`grant_type=authorization_code,client_id,redirect_uri,code,code_verifier` + DPoP | 7.2 标准 token 响应，**token_type=DPoP**；App grant（授权记录）缺 proof/错误 key 不发弱化 Bearer；刷新同端点 `grant_type=refresh_token`，每次生成新 proof 并原子保存新 refresh token |
| POST `/personal/v1/cloud/auth/password/change` | `{currentPassword,password}` + 下述云 DPoP 授权 | 200 `{passwordChanged:true,notificationAccepted}`；验证当前密码，递增 epoch/撤销全部旧云会话；客户端重新登录。不是更改电脑的离线应急密码 |
| POST `/personal/v1/cloud/auth/logout` | `{}` + 云 DPoP 授权 | 200 `{loggedOut:true}`；只撤销当前设备指纹的全部云授权族/登录记录，写该 key 的宿主撤权事件；其他设备继续有效。客户端同时调用宿主原 `/auth/logout` 清 Cookie，删除本地云令牌 |

客户端网络层保存这一轮 HttpOnly（脚本不可读）交互 Cookie：浏览器 `credentials:"include"`，原生使用独立 cookie jar（Cookie 容器）。返回 `callbackUrl` 只当数据解析：校验精确已登记回调、原 state，随后兑换 code 并核对固定 issuer/JWKS/RS256/nonce/audience/有效期/sub。获得宿主 Cookie 后仍保留受保护的云 refresh family，以便设置页列设备、改密码/退出和选择其他宿主；云与宿主 access token 按各自 audience 保存，每次刷新只原子替换该 family 的最新 refresh token。密码、验证码、ticket 不持久化；原生 key/refresh 存系统受保护存储，网页按 7.7 存不可导出 key/IndexedDB，不能存 localStorage。普通浏览器若屏蔽第三方 Cookie，应使用同站点部署的官方 origin；原生壳用自己的网络层持有交互 Cookie，不依赖外部认证浏览器。

本节的**云 DPoP 授权**为 `Authorization: DPoP <cloud audience access token>` + `DPoP: <ES256 proof>`，proof 包含 P-256 公钥 JWK、`iat,jti,htm,htu,ath`；htu 是固定云 origin + 精确本次路径（无 query/fragment），ath 为 access token 的 SHA256/base64url，iat ±60 秒，jti 单次使用；无需宿主 nonce。服务端检查实时 epoch、已登录设备指纹、token cnf.jkt 和 proof key。受信内容 Cookie 仍由宿主 7.4 的独立 nonce/DPoP 交换产生。

**设置 → 设备**：

| 提供者 / 方法与完整路径 | 请求 / 授权 | 响应 / 语义 |
|---|---|---|
| 云 GET `/personal/v1/cloud/devices` | 云 DPoP 授权 | 200 `{devices,hosts,sharing:{supported:false}}`。devices 每项 `{id,name,type,online,lastUsedAt,isCurrent}`；hosts 每项同字段及 `hostId`，type=computer。仅同账号已登录设备/已认领宿主；不返回邮箱、安装 key、pin、内容、frpc 凭据 |
| 云 POST `/personal/v1/cloud/hosts/connect` | `{hostId}` + 云 DPoP 授权 | 200 `{hostId,baseUrl,status,resource,approval,pairingRequired}`；status=online/offline/revoked（无中继配置或尚无地址时 offline/null）；approval=pending/trusted/denied/revoked，pairingRequired 为未受信。非成员 404；旧非 App grant 403 APP_LOGIN_REQUIRED。增加本设备现有 provider grant 与尚未消费 refresh model（刷新记录）的该宿主 resource，不另发令牌/改变生命周期或消费状态 |
| 宿主 POST `/personal/v1/auth/cloud-desktop` | `{accessToken,deviceName}` + 云 audience access token 的宿主 nonce/DPoP（htu 为本路径），无 Authorization | 只允许本机回环 socket、直接 Host/Origin、无转发头。首次云登录自动创建独立本地 owner、S1b claim/member/binding、受信电脑 key；空白安装的首个账号自动成为执行账号（完整通用工具与审批），并返回原宿主 `{account,device,csrfToken}` + Cookie；不读取或接管已有本地账号数据。执行归属持久保存；已有旧本地账号或历史设备/会话/命令时不转移归属，另一云账号仅可隔离聊天（D30），`GET /status.executionAccount=false`。相同 sub/key 重试保留 owner/claim；已绑定宿主的另一未知 key 202 等待批准，拒绝/撤销 key 403。已绑旧本地账号仍须已有设备批准 |
| 宿主 POST `/personal/v1/cloud/devices/{requestId}/trust` | `{}` + 同账号已受信宿主 Cookie/CSRF（电脑/受信设备） | 200 `{sub,hostId,deviceId,jkt,tlsSpki,publicJwk,origin,relay,trustToken,expiresIn:120}`。仅已批准的指定 recipient（接收设备）；pending 403，跨 owner 404。返回值只能从已有信任的宿主 TLS（传输层安全）连接取得，再经可信设备通道转交 |
| 宿主 POST `/personal/v1/cloud/emergency-password` | `{password}` + 自动绑定电脑的直接地址受信 Cookie/CSRF | 200 `{configured:true}`；云创建账号可首次设置本机独立离线密码，后续改密码走原本地接口；手机/旧密码账号/再次初始设置 403。创建时随机不可用的本地密码不会交给客户端 |
| 宿主 POST `/personal/v1/auth/cloud-offline` | `{cloudAccountId,password,deviceName}`，直接地址 Origin/JSON | 200 原本地登录响应；只查本机已设置应急密码的云映射并走原密码校验/限速，不调用云。旧本地账号继续原 `/auth/login`；cloudAccountId 仅用于选择账号，不构成认证 |

devices 的 online 指最近 60 秒云 API/登录/刷新活动；hosts 指最近 90 秒安装签名心跳（宿主默认 60 秒同步），lastUsedAt 为 UTC ISO8601，旧未上报宿主可为 null。isCurrent 使用令牌设备指纹；电脑宿主通过签名的 device-host 映射标「这台设备」，客户端无需传可伪造的 currentHostId。这是最近活动提示，不能当作内容连接成功证明。可每 30 秒以新 proof 读取目录维持前台设备状态。

连接时先从目录选择 hostId，调用 `/hosts/connect`，用**同一个轮换 refresh family（刷新授权族）**向 `/oidc/token` 指定返回的 resource，取得 7.4 宿主 token。未知 pin 时不要先试宿主内容连接：提示电脑展示二维码、扫描 7.7 的 wm1 / URL 材料建立 pin，再走 `/cloud/pairings/redeem`；受信设备批准场景可由下述 trust 交付建立 pin 后调用 `/auth/cloud-session`。待批准请求仍由宿主 `/cloud/devices/pending` / decision 管理；signed outbox（签名待同步记录）只向云报告最小批准状态，最终内容授权以宿主为准，离线/撤权延迟沿用 7.4 / 7.6。

`trustToken` 为宿主安装 key 签的 ES256、`typ=wm-host-trust+jwt`，`iss=hostId,aud=recipient jkt,sub,hostId,deviceId,jkt,tlsSpki,publicJwk,origin,relay,iat,exp,jti`；寿命 120 秒。接收端先从**已经受信的发送设备通道/当面二维码**取得安装公钥作为 trust anchor（信任锚），再验签/iss/aud/sub/deviceId/jkt/期限及公钥一致，保存 pin。不得把云目录、未验证响应里的公钥、或 JWT 自带 key 当作信任锚；`src/personal-cloud/trust.mjs` 提供使用外部锚的参考校验。首次无可信设备通道用电脑二维码；本包提供服务端交付接口，不实现 LG-1 / LG-2 的相机与设备间传输界面。原生仍先标准 CA（证书机构）/域名验证再 pin；普通网页保持 D24 边界。

宿主安装签名新增 `/personal/v1/cloud/hosts/status`（签入 action/sub/name）和 `/hosts/devices/status`（签入 action/sub/deviceId/jkt/status、可选 isHost=true）；沿用 7.5 的 `{hostId,proof}`、60 秒期限/jti 防重放/member 检查，只收名称、活动与内容信任元数据，不收 pin 交付材料或内容。云 schema 6 存放票据、设备元数据与映射。跨账号共享只有 `sharing.supported=false` 接口位置；本包所有连接/配对/信任交付都拒绝越权，S5 再实现主账号扫码确认。

新增业务码：400 `PASSWORD_TICKET_INVALID`（过期/错用途/已用/旧 epoch）、401 `DPOP_INVALID`、403 `APP_LOGIN_REQUIRED`；账号密码/验证码限速与 7.3 相同。接口必须来自固定配置的云/宿主 origin，不以邮箱或目录 pin 推断本地 owner 或宿主信任。S1d 不部署；本节服务端已交付，客户端完整页面与真机扫码由 LG-1 / LG-2 验收。

**Apple 实现备注（LG-2）**：iPhone / Mac 账号页面在 App 内走本节 JSON 接口，使用独立内存 Cookie 容器。`/auth/authorization/resume` 是 provider 恢复路由的 JSON 包装：原生网络层须同时取本 App 接口路径与返回的固定 issuer `/oidc/auth/{uid}` 路径对应的交互 / resume Cookie；仅按包装接口路径筛选会漏掉 provider 的 resume Cookie。Cookie 只发往已配置的云 origin，不跨宿主传送。代码 / 刷新均发送 DPoP，同一 single-use refresh family 的消费在模型网络层串行；没有新增服务端路径或第二种登录协议。

App 内每次开始授权会清除本客户端先前的 OIDC（身份认证协议）会话 Cookie（会话凭据），再走原密码 / 验证码 / PKCE（授权码校验）流程；避免账号改变时进入提供方的 HTML（网页标记语言）自动注销表单。云 DPoP（设备密钥持有证明）凭据和其他客户端不随之撤权。

### 7.9 账号生命周期（S1e / D30）

本节接口由云提供，使用 **7.8 云 DPoP（设备密钥持有证明）授权**：`Authorization: DPoP <cloud audience access token>` + 本次精确 URL/方法/令牌摘要对应的 `DPoP` proof（证明）。不接受宿主 Cookie（会话凭据）、ID token（身份令牌）或无 proof 的 Bearer（未绑定设备密钥的令牌）。所有写操作要求已登记 Origin（来源地址）、JSON ≤16 KiB、无 query（查询参数）/多余字段；响应 `Cache-Control: no-store`。页面与确认文案由 LG-1 / LG-2 接线，本包不改界面。

| 方法与完整路径 | 请求 | 响应 / 语义 |
|---|---|---|
| POST `/personal/v1/cloud/auth/account/delete` | `{password}` | 200 `{deleted:true,localDataPreserved:true}`；重新校验当前密码与实时设备授权，再不可恢复地删除账号全部已实现的云数据，立即撤销令牌与在线中继连接；本机对话、记忆、内容密钥及独立应急密码保留 |
| POST `/personal/v1/cloud/auth/email/change/request` | `{email}` | 200 `{challengeId,expiresIn:600}`；已登录设备输入新邮箱，新邮箱收一次六位验证码；无需重新输入密码；邮箱已被占用（含未激活注册）409 EMAIL_IN_USE |
| POST `/personal/v1/cloud/auth/email/change/confirm` | `{challengeId,code}` | 200 `{account:{cloudAccountId,email,auth_epoch},notificationAccepted}`；验证码绑定账号与 epoch（认证版本），十分钟内单次有效；提交时再次查占用，换绑后通知旧邮箱「邮箱已更改」；subject（账号标识）保持，epoch +1，原云会话/刷新族/旧邮箱验证码撤销，客户端用新邮箱重新登录 |
| POST `/personal/v1/cloud/devices/rename` | `{deviceId,name}` | 200 `{renamed:true,deviceId,name}`；只改本账号设备，名称去首尾空白、非空、最多 128 个字符；关联电脑的云目录名称一起更新，后续心跳不覆盖；未知/其他账号设备 404 NOT_FOUND |
| POST `/personal/v1/cloud/auth/logout/others` | `{}` | 200 `{loggedOut:true,revokedDevices}`；撤销除当前 token 设备指纹外的全部云设备/授权族，取消未完成的其他设备确认，向各宿主写 device 撤权事件；同 deviceId 的另一 key 也撤销，当前 key 的云/宿主会话与刷新族有效；重复调用返回 revokedDevices=0 |

注销必须先在客户端明确展示：**云端账号数据全部删除且不可恢复；本机的对话与记忆仍留在设备上。** 成功后删除客户端云令牌并清原宿主 Cookie（调用原 `/auth/logout`）；本地数据由用户在设备上另行删除。同一邮箱可重新注册，获得全新 cloudAccountId，不继承旧账号内容/设备信任。密码/验证码不持久化。不做手机号或多账号同时登录。

删除范围：`cloud_accounts`（邮箱/密码哈希）、`cloud_devices`（公钥）、`grant_bindings`/`oidc_records`（所有令牌族/会话/账号相关未完成交互）、`interaction_forms`（相关 CSRF）、`email_challenges`/`password_tickets`（验证/授权记录）、`host_claims`/`host_memberships`、`device_host_links`/`host_device_status`、账号的 `cloud_revocations`。账号拥有的安装还删除 `cloud_hosts`/`host_relays`（安装 key、归属、路由与凭据派生记录）和该安装的其他成员关系；仅作为成员加入的他人宿主保持。该安装自有 ACME（自动证书管理）TXT 先经原 DNS provider（域名解析服务适配器）清理；清理失败返回 503，账号删除尚未提交，可重试。file（文件）邮件按账号清理，包括换绑前的旧邮箱通知；SQLite（嵌入式数据库）启用 secure_delete（覆盖删除页）并在删除后 checkpoint（检查点落盘）清 WAL（预写日志）。S3 推送标识、S4 备份密文/包裹密钥、S5 独立共享对象目前尚无表或文件，后续模块必须接入同一注销删除事务，不能保留到注销之后。

撤权沿用宿主 `/hosts/revocations` 云签名 `wm-cloud-revocations+jwt`（撤权令牌），新增可选 `memberships:[{sub,epoch}]` 权威归属快照。新宿主验证原 issuer（发行者）/固定 JWKS（签名公钥集合）/host audience（宿主受众）后，对快照中消失的活跃绑定标为 unbound，撤销其云 Cookie、内容设备与正在进行的响应；本地账号/应急密码不变。快照先于 outbox（待同步记录）发送处理，已删除账号的旧状态记录不能阻塞撤权；发送后再拉一次事件以保持单次同步撤权。已删除安装无公钥可认证请求，只返回不含账号信息的云签名空快照，不保留账号墓碑。watermark（事件水位）取 AUTOINCREMENT（递增序列），删除不会倒退。沿用每 60 秒/启动同步的宿主撤权延迟；云端中继 socket（连接）在删除提交后立即关闭，离线宿主联网同步后撤权。

业务码复用 400 CHALLENGE_INVALID / CODE_INVALID / INVALID_REQUEST / INVALID_DEVICE、401 INVALID_CREDENTIALS / UNAUTHORIZED / DPOP_INVALID、403 FORBIDDEN / ORIGIN_NOT_ALLOWED、409 EMAIL_IN_USE、429 RATE_LIMITED（Retry-After）。旧 7.1 `/auth/email/{request,confirm}` 的密码 + Bearer 形式保留兼容并补旧邮箱通知；新客户端使用本节接口。旧邮箱通知故障不回滚已完成换绑，notificationAccepted=false；发验证码失败仍为 503 MAIL_UNAVAILABLE。

## 8. 本地备份与恢复（BK-1）

以下接口由内容宿主提供，沿用 Cookie（会话凭据）/CSRF（跨站请求伪造防护）与 `account:manage` 权限。备份包含整个宿主，只有本地旧所有者或该安装已验证的桌面云归属账号可访问；普通配对成员返回 403 `FORBIDDEN`。路径均是宿主电脑上的路径，远程客户端不能用手机本地路径代替。无 query（查询参数），写请求字段须精确匹配。

| 方法与完整路径 | 请求 | 响应 / 语义 |
|---|---|---|
| GET `/personal/v1/backups` | — | 200 `{settings,status,backups,excludedCredentials:true,localUnencrypted:true}`；`settings={enabled,directory,dailyDays,weeklyCopies}`，默认启用、宿主数据目录旁 `Backups/`、7 天与 4 周；每条 `backups={id,createdAt,reason,size,verification}`，大小字节，`verification=valid\|invalid` 为重新流式 SHA-256（安全哈希算法）校验结果，时间 UTC（协调世界时）ISO 8601 |
| PATCH `/personal/v1/backups/settings` | 上述设置字段的子集 | 200 `{settings}`；目录须为绝对路径，不能位于宿主数据根内；天数与周份数均为正整数 |
| POST `/personal/v1/backups` | `{}` | 202 `{state:"succeeded",restartsHost:false,requiresLogin:false,backup}`；拒绝活动任务，程序内完成在线快照后返回；窗口、进程和登录保持，结果持久化到 `status` |
| POST `/personal/v1/backups/import` | `{path}` | 201 `{id}`；校验宿主电脑上的外来 `.wmb` 包，复制到当前备份目录并再次校验，原子发布，不替换数据 |
| POST `/personal/v1/backups/restore` | `{id,confirm:true}` | 202 `{state:"pending",restartsHost:true,requiresLogin:true}`；先校验来源、备份当前状态、停写入服务、重新校验、暂存/替换、重启；新数据成功启动后提交，替换/启动失败自动回滚；按新 `GET /backups` 的 `status` 判断结果 |
| POST `/personal/v1/backups/prepare-account-deletion` | `{}` | 本机注销前调用：程序内完成在线安全快照后返回 200 `{ready:true,restartsHost:false}`，同一次确认中继续执行 7.9 的云注销；备份失败不执行云注销，密码仅留在当次页面内存 |

`status` 为 `null`，或 `{state,at?,reason?,backup?,restored?,code?}`；`state=pending\|running\|deferred\|succeeded\|failed\|rolled-back`。`succeeded` 表示上次操作成功；恢复重启的 API（应用接口）可用之前不会提交事务，启动失败回滚后报告 `rolled-back`。只有请求恢复后拒绝新的写请求，避免关闭前接收新任务；普通备份仅短暂排队文件写入，并在这一边界为 SQLite 固定只读事务视图；恢复文件写入后在线复制该视图，后续 WAL（预写日志）提交不进入该数据库快照，数据库复制、压缩和校验期间正常接收操作。每日调度遇到任务会推迟，暂停写入/排空/捕获超时（最多 2 秒）不发布包，标记 `deferred`，下个每分钟检查再试。仅恢复或升级安装重启，恢复后接入端口可能变化，客户端需重新发现连接。原机浏览器登录保持；恢复会清除包内设备会话，因此须重新登录。

包包含账号/设置、DSH（助手运行时）会话与日志、对话工作目录/经验、成果、用量、健康和 MemoWeft Core（记忆核心）数据库。数据库使用 SQLite（嵌入式数据库）安全在线备份，不复制活动 WAL（预写日志）或 SHM（共享内存文件）。模型密钥、云令牌、设备私钥、浏览器登录与缓存、自动生成的 DSH 依赖链接不进包；账号密码哈希保留供重新登录，历史设备仅留撤销后的元数据与不可用的校验值以维持命令引用；来源会话不能继续使用。换机后重新填写模型密钥；云端重新验证 subject（账号标识）与 issuer（发行者）、重新认领新安装后，使用包内不含凭据的归属映射接回原账号，不能靠邮箱推断归属。当前安装 ID 与其本机私钥保持，来源安装私钥不会被导入。

默认保留最近 7 天全部成功包，再加最近 4 个日历周各最新一份；UTC 周从周一开始，始终保留最新成功包，坏包不自动删除。临时文件落盘后原子改名，包内含版本、时间、原因、逐文件大小/SHA-256 与清单 SHA-256。坏包 409 `BACKUP_CORRUPT`，数据中的链接 409 `BACKUP_SYMLINK`，活动任务 409 `SESSION_BUSY`，已有操作 409 `CONFLICT`，暂停写入超时 409 `BACKUP_PAUSE_TIMEOUT`，无备份能力 503 `CAPABILITY_UNAVAILABLE`，关闭期间 503 `SERVICE_CLOSING`。本地包未加密，应保存在可信磁盘；S4 云端加密备份尚未实现。

## 9. 逻辑主对话与旁聊（IA-2）

### 9.1 身份与能力（IA-2.1 正式）

`GET /status` 增加 `personalCapabilities:{chats:1}`。只有精确支持的数字版本才可使用；缺失、0 或未知版本均退回原会话接口，不由客户端自行创建主对话。`chats:1` 在本步仅声明本节身份读取、列表和主对话已读偏好；不代表逻辑发送、跨段历史、搜索、旁聊创建、接力、动态或离线主对话可用。子能力分别见9.3/9.4/9.6/9.7；声明 `chatSend:1` 的空主对话可通过首次发送选模型并创建首段，未声明的旧宿主仍不可逻辑发送。

`chatId` 是账户内稳定逻辑身份，与 DSH（助手运行时）的 `sessionId`、同步 / 共享的 `conversationId` 分开。每账户恰有一个 `kind:main`；空主对话不创建原生会话，旧会话不作为主对话或复制到主对话。用户可见旧会话一对一映射为 `kind:side`，内部子任务不登记为旁聊。账户绑定云身份仍保留原本地账户的逻辑身份。

| 方法与路径 | 请求 | 响应及语义 |
|---|---|---|
| GET `/chats/main` | 无 | 200 `{chat}`；唯一主对话。未初始化 503 `CHAT_INITIALIZING` |
| GET `/chats/{chatId}` | 无 | 200 `{chat}`；非当前账户或不存在 404 `CHAT_UNAVAILABLE` |
| GET `/sessions/{sessionId}/chat` | 无 | 200 `{chatId,segmentId,kind,archived}`；旧深链通过原 `seq` 定位。原历史接口不重定向；不存在 404 `SESSION_UNAVAILABLE` |
| GET `/chats` | 可选 `kind=side,parentKind=main\|project,parentId,archived=false\|true\|all,q,cursor,limit` | 200 `{items,nextCursor,hasMore,groups,indexState:"ready"}`；默认活动旁聊 50 条，`limit` 1–200；`q` 最多 256 字符，仅搜标题，不搜全文 |
| PATCH `/chats/{chatId}/metadata` | 主对话 `{requestId,expectedRevision,unread:boolean}` | 200 `{chat}`；同请求重放返回原结果，异体 409 `REQUEST_CONFLICT`，旧修订 409 `REVISION_CHANGED`。旁聊逻辑元数据见9.7，原会话接口兼容 |

`Chat` 含 `{chatId,kind,title,parent,pinned,archived,unread,groupId,projectId,memoryMode,activeSegmentId,activeSessionId,revision,contentRevision,timeZone,running,sendAvailable,taskAvailable}`，按原事实附 `modelProfileId,projectName,projectRevoked,projectNotice,parentSessionId,conversationId,workspaceKind,processing,contextUsage`。主对话 `parent:null,title:"WeftMate",pinned:true,archived:false,groupId:null,projectId:null`；未建执行段时 active 字段为 `null`。普通旁聊父级为 `{kind:"main",id:mainChatId}`，项目旁聊为 `{kind:"project",id:projectId}`。标题、项目、分组、归档、模型、已读水位与发送权限继续投影原会话事实，不另建可独立修改的副本。`revision` 随会话元数据变更增加；`contentRevision` 留作原话删除后缓存失效水位。`timeZone` 在迁移 / 账户创建时固定为宿主实际时区并返回，客户端不自行猜测。

旁聊列表置顶优先，再按最近宿主命令活动时间、创建时间和稳定 ID 排序。游标是 opaque cursor（不透明游标），固定本次列表的 ID 顺序与过滤条件；客户端原样续传同一过滤和页大小。后续新旁聊不会插入已开始的分页，已删除对象不返回。重启后或换账户 / 过滤的游标返回 409 `CURSOR_RESET_REQUIRED`，重新取第一页。每个页面的元数据取当前事实，游标不授予跨账户访问。

读取沿用 `sessions:read`，写入沿用 `commands:write` 与既有 Cookie（会话凭据）/CSRF（跨站请求伪造防护）。主对话改名、取消置顶、分组、移项目、归档、分叉与删除均 409 `MAIN_CHAT_PROTECTED`；只允许已读偏好。旁聊可使用9.7的逻辑生命周期接口；原 `/sessions/{id}` 接口兼容，映射在同一账户事务提交。主对话段不出现在旧 `/sessions` 列表；持有段 ID 的旧客户端可读历史及原回执，直接发送 409 `MAIN_CHAT_ROUTE_REQUIRED`，生命周期操作 409 `MAIN_CHAT_PROTECTED`。已登记原请求优先返回原回执；原任务控制仍保留。

### 9.2 迁移与回滚边界（IA-2.1 正式）

启动监听前在原子私有存储写入边界发布完整 `chatIdentity`，含一对一执行段映射；没有半发布状态。重启重复迁移不改变身份。随后每次账户事务同时登记旧客户端新建会话、投影旧修改与删除；DSH 日志、命令 / 回执、附件、工作目录、项目 / 分组和 MemoWeft（记忆核心）原 `sessionId` 来源均不改写、不回放、不重新摄取，也不为历史完成任务生成回写或通知。

升级沿第 8 节 BK-1（本地备份）完整快照；本功能另在首次迁移前保存私有 `personal-access/chat-identity-v1.before.json` 原始接入存储，覆盖应用版本未变的开发升级。原始副本只供停写后的演练 / 人工恢复，不自动读入，发生遗忘时移除；其中有原设备凭据校验值，因此不进入可携带备份，备份仍只保存撤销设备凭据后的当前接入存储。迁移提交失败保留旧存储；修复后可重跑。界面回退仍可使用旧旁聊，新逻辑元数据保留。

新版产生数据后不能用旧副本覆盖正在使用的数据目录。需要宿主降级时先停写、保留新版完整快照，再把旧完整快照恢复至独立目录；只运行一份任务。单独的接入存储副本不能代替 DSH、记忆及成果完整备份。已经发生的遗忘 / 撤权必须按原清理水位前向恢复，不从备份自动重新摄取。本步不提供主对话区间归档或清空；D42-A 的全部历史保留政策不变。

### 9.3 跨段历史、日期与搜索（IA-2.2 正式）

能力增加 `chatTimeline:1,chatSearch:1`。路径均以 `/personal/v1` 为前缀，读取沿用 `sessions:read`，只读当前账户自己的逻辑对话。主对话尚无段时正常返回空页；不创建执行段，不执行模型。ui-core（共用功能层）的 `readChatEvents/readChatChanges/readChatDates/locateChatDate/searchChat` 提供同一路径。

| GET 路径 | 参数 | 响应 |
|---|---|---|
| `/chats/{chatId}/events` | `before/after/around` 互斥；无方向为尾页；`around` 为 `eventId`；`limit` 默认50，1–200 | `{items,olderCursor,newerCursor,hasOlder,hasNewer,syncCursor,deletedAnchor,...}`；正序，锚点附近均衡窗口；未知或已删除锚点回尾页并给 `deletedAnchor:true` |
| `/chats/{chatId}/changes` | 必填 `cursor`，可选 `limit` 同上 | `{upserts,removals,nextCursor,hasMore,...}`；独立增量，空页仍返回水位；旧段迟到消息同样交付 |
| `/chats/{chatId}/dates` | `from,to` 必填，本地 `YYYY-MM-DD`，间隔≤31天 | `{days:[{date,count,firstEventId,lastEventId}],...}`；计数为公开条目数，未出现的日期不伪造条目 |
| `/chats/{chatId}/locate` | 必填 `date`，本地 `YYYY-MM-DD` | `{date,eventId,previousDate,nextDate,...}`；当天无记录为 `eventId:null` |
| `/chats/{chatId}/search` | `q` 非空≤256字符；可选 `from,to,role=user\|assistant,hasArtifact=true\|false,cursor,limit` | `{hits:[{eventId,sourceRef,at,snippet,highlights:[{start,end}]}],nextCursor,hasMore,...}`；中文字面子串、不区分大小写；范围为可见消息与结果摘要，工具输出和隐藏推理不索引 |

共同字段为 `{contentRevision,chatRevision,unread,indexState,timeZone}`。`indexState=building|ready|failed`；首次返回可读尾页后逐页整理早期索引，整理中搜索/日期只是部分结果，不能解释为没有历史。失败可重新打开重建；本步索引只在宿主内存中存必要检索文本与原文定位，宿主重启后渐进重建，不持久复制原生日志。日期使用账户用量设置中的时区，未设置沿宿主时区；修改时区重新分日，事件身份和顺序不变。`hasArtifact` 检查该公开消息上的附件/成果引用，不推测另一条工具输出属于哪条回复。

`items` 为 `{eventId,chatId,orderKey,revision,type,at,sourceRef,data}`。原生 `sourceRef={kind:"native",hostId,sessionId,seq}`，正文通过原历史公开投影读取；`eventId` 从原身份确定，索引重建不变。`orderKey` 按宿主段序及原生序号分配，与设备时钟无关；旧段迟到信息保留原段顺序。客户端遵从服务端顺序，不将 `orderKey` 当同步水位。展开、高度、焦点、选择以 `eventId` 保存；上翻后保留首个可见 ID 与像素偏移，不全量挂载历史。工具详情继续原 `sessionId/seq` 接口。

游标绑定账户、对话、索引代次、用途及搜索过滤；不透明且经宿主签名，客户端不能解码、拼接、加一或混用。历史页的 `syncCursor` 不覆盖已建立的增量水位；增量只续传 `nextCursor`。逐步索引早期内容也可能在增量出现，以 `eventId` 去重即可。搜索游标保持过滤/时区，新增匹配可在重新搜索时出现。重启、内容代次变化或不合法游标返回409 `CURSOR_RESET_REQUIRED`，客户端清理旧缓存再取尾页或保存的锚点。

`removals=[{eventId,revision,reason:"deleted"|"forgotten"}]` 不带正文；`removeEvents` 为 IA-2b 的持久原文清理完成后通知接缝，跨重启清理由 `contentRevision` 提升触发全缓存失效。D33 多段清理见9.5；接力见9.6。D42-A 保留全部原始历史，不增加区间归档或清空。固定 DSH 的原生冷 `inspect` 仍物化整个日志，测量脚本分别记录逻辑页与冷进程读取；不能把逻辑页的有界返回声称为原生磁盘读取已经有界。宿主公开投影缓存及首次未命中边界见9.7。

### 9.4 开旁聊与结果回写（IA-2.3 正式）

能力增加 `sideChats:1`。沿用原 `/commands` 的 `commands:write`、设备归属、模型/项目权限、Cookie（会话凭据）/CSRF（跨站请求伪造防护）及原命令查询回执，不增加执行器或新的模型授权。

`POST /commands` 新增客户端命令：

```json
{
  "requestId": "side-example",
  "kind": "session.side.create",
  "targetDeviceId": "host-example",
  "parent": {"kind": "main", "id": "chat-main-example"},
  "modelProfileId": "local",
  "title": "纸船安排",
  "originChatId": "chat-source-example",
  "originEventId": "event-source-example",
  "entry": "message"
}
```

必填 `requestId,kind,targetDeviceId,parent,modelProfileId`；`parent.kind=main|project`，`parent.id` 必须是当前账户主对话或已授权且未撤销项目。`title` 可选，去首尾空白后1–256字符；来源两个字段同时出现或省略，只能是当前账户可读的完整公开用户/助手消息。来源与组织父级分别保存：项目来源移到主对话父级不会继承项目写权限，目标项目使用原 D37 权限及目录。旁聊开出的新旁聊仍直接属于所选主对话或项目，不嵌套。

`entry` 可选 `composer|message|suggestion`；缺省有来源为 `message`、无来源为 `composer`。`message` 必须有来源。模型建议入口必须另传 `confirmed:true`，否则409 `SIDE_CHAT_CONFIRMATION_REQUIRED`；客户端只在用户点确认后提交。此 API（应用接口）没有注册成模型自动建聊工具。输入区草稿和待上传附件留在客户端，创建不发送首句、不执行原消息、不改变审批模式。

返回202 `{command}`，附 `kind:"session.side.create",chatId,sessionId,contextTransfer`；内部复用原持久 `session.create` 的创建/恢复流程。两项身份在首次受理时确定，同请求并发或重试返回同一命令；不同请求体409 `REQUEST_CONFLICT`。客户端等原 `/commands/by-request/{requestId}` 到 `accepted_by_dsh` 后才能使用旁聊。失败/不确定沿原回执处理，不换新请求编号重发。新旁聊使用独立原生会话与工作目录；项目旁聊沿原项目目录。

本步 `contextTransfer={state:"references_only",sourceRefs:[{chatId,eventId,kind:"native",hostId,sessionId,seq,contentRevision}],truncated:false}`，`Chat` 同时返回 `originRefs` 与 `contextTransfer`。**尚未接入原生摘要转移**；采用 IA_MAIN_CHAT 3.1 允许的仅引用回退，界面必须提示“相关上下文尚未带入”，允许用户编辑首句继续。不能把引用就绪显示为完整上下文已转移；不把客户端摘要当事实，也不复制整条历史或注入伪造真人消息。来源删除后原链接返回不可用，引用不能恢复正文。原 D34 分叉继续完整事件种子语义，本接口不等同分叉。临时来源409 `TEMPORARY_CONTEXT_CONFIRMATION_REQUIRED`，共享来源409 `SHARED_CONTEXT_UNAVAILABLE`；未实现绕过提示的确认布尔开关。

| 接口 | 请求 | 响应与规则 |
|---|---|---|
| POST `/chats/{sideChatId}/results` | `{requestId,sourceEventId,expectedRevision,taskId?}` | 201 `{result,mainEventId,activityId}`；原请求重放先于修订核对，异体409；新请求旧修订409 `REVISION_CHANGED`；正文由授权来源读取，客户端不提交摘要/成功状态 |
| `result` | — | `{resultId,sourceChatId,sourceEventId,sourceRef,taskId?,state,summary,resultRevision,requiresResponse,artifactRefs[],deleted?}`；`state=completed|failed|stopped`；摘要最多160个 Unicode（统一字符编码）码点，不额外调用模型 |
| 主对话 `items[]` | — | `type:"side.result"`，`sourceRef={kind:"result",resultId,sourceChatId,sourceEventId,native:{kind:"native",hostId,sessionId,seq}}`，没有伪造 `seq`；`data` 包含结果字段及 `activityId,notificationRevision`；历史、日期、搜索、增量走9.3 |

不带 `taskId` 是显式分享选中的完整助手答复，`completed` 只表示该答复可分享，不证明某项任务成功。带 `taskId` 时必须属于该旁聊原根任务，原生回合已确定完成/失败/停止，且后台工作无活动或未确认状态；否则409 `TASK_NOT_READY`。宿主先用原来源接口核对回合边界，再按范围读取公开答复；不会读取下一回合或工具原始输出作为摘要。找不到来源404 `SOURCE_UNAVAILABLE`。临时及共享旁聊同样拒绝回写；主对话409 `MAIN_CHAT_PROTECTED`。

自动回写在主对话身份/历史/日期/搜索/增量读取时对账：仅处理主对话身份建立后新受理的普通/项目旁聊根任务，原生工具或成果事实表明它是执行任务；纯闲聊不因每条回复生成卡。不追溯迁移前旧任务。原生 `completed/failed/aborted` 分别显示完成/失败/停止，停止绝不显示完成；缺乏确定证据保留待对账。归档不阻止已受理任务回写。回写不启动主对话模型、不追加 DSH 消息、不重新摄取记忆；没有新增后台计时器。

同一旁聊根任务保持同一 `resultId/mainEventId/activityId`，后续续做/显式更正增加 `resultRevision` 和 `notificationRevision`，更新原卡；手动分享已有自动结果也复用身份。普通手动分享以来源消息去重。`requiresResponse` 当前为false，不凭问号产生待办或代表用户认可/批准。TB-1（动态）复用根任务结果的 `activityId`，读写与通知见9.8；普通文字分享不据此生成“任务完成”。删除旁聊清空派生摘要、成果引用与搜索正文，保留 `deleted:true` 的无正文锚点；重复分享请求也只返回当前墓碑。D33 原话/派生数据跨段清理见9.5，接力见9.6。


### 9.5 D33 跨段清理（IA-2b / 2.5）

记忆遗忘、删除旁聊及勾选删除原话继续使用原接口、预览修订和回执。遗忘同时清除逻辑索引、结果摘要、交接资料、旁聊来源引用及创建命令中的同份资料；无法精确归因的混合摘要整份弃用。`contextTransfer` 可新增 `sourceDeleted:true`，此时 `sourceRefs=[]` 且状态为 `references_only`。结果保留无正文 `deleted:true` 墓碑，自动对账及重试不能重新发布旧正文。

受影响对话提升 `contentRevision`，旧游标409 `CURSOR_RESET_REQUIRED`；客户端必须清空旧正文、搜索及增量缓存，再取新页。正在读取的旧索引也会失效，不能以清理前响应填回新缓存。M3-A 同时提升既有副本代次并先丢弃待补交的旧离线内容；不可达设备不能视为已清理，重连先同步删除水位。

默认不勾选原话删除：原聊天记录仍可浏览，匹配来源回合通过 DSH 原生 surface（模型上下文视图）替换移出未来请求及压缩输入；原生混合压缩摘要及记忆注入副本清空。勾选后再物理清理原生日志和命令副本。源序号墓碑阻止保留原话被重新建旁聊或分享成结果。清理未完成时回执保持 pending（待完成），新发送返回既有409 `SESSION_BUSY`，已排队输入在清理成功后继续。过去备份与已导出的用户文件沿既有边界，不承诺远程擦除。


### 9.6 主对话发送与原生接力（IA-2b / 2.4）

声明 `personalCapabilities.chatSend=1` 后，主对话使用 `POST /commands`，请求为 `{requestId,kind:"chat.message",targetDeviceId,chatId,text,modelProfileId?,mode?,attachments?,attachmentSessionId?,attachmentMessageId?,originalAttachments?}`。首次发送必需 `modelProfileId`，后续沿当前段模型；不匹配返回409 `REQUEST_CONFLICT`，切换模型仍沿原模型接口。`mode=queue|steer`，省略为queue（排队）。仅宿主账户主对话支持本命令，并沿原 `session.create` 的密码/云账号登录授权；旧登记令牌没有可执行个人会话权限，返回409 `SESSION_READ_ONLY`。旁聊沿原 `session.message`。

返回202 `{command}`，查询仍用 `/commands/by-request/{requestId}` 或原命令ID。尚未派发时 `state=pending`、`sessionId` 可省略，正文已持久化；原子选定当前段后才附原生 `sessionId`，受理后沿原 `receiptId` 和任务端点。重复原请求只返回原回执，接力后也不改绑定。不同请求体同ID返回409。摘要失败保留旧段继续本次发送；创建/持久化失败按现有失败回执处理，未发布目标段保留用于下一次恢复，禁止另建重复目标。

可先 `PUT /chats/{chatId}/attachments/{attachmentId}?requestId=...&name=...` 暂存首条或后续文字/图片附件，字节、散列、媒体类型及响应复用原会话附件上传；该逻辑暂存不创建原生段。随后发送省略 `attachmentSessionId` 即使用同一逻辑暂存。如果附件已通过旧会话上传，则提供来源段 `attachmentSessionId`，宿主校验它属于同一主对话；切段只绑定执行目的地，暂存/原附件引用不重上传到两个段。旧附件读取仍按真实来源身份授权。

IA-3 补齐原件的同一逻辑暂存：`PUT /sync/attachments/{id}` 的 `conversationId` 可传当前账户主对话 `chatId`，宿主映射到该主对话同一附件暂存身份；不创建执行段，不扩大账户或命令权限。随后 `chat.message.originalAttachments/attachmentMessageId` 仍按同一暂存来源校验，原件下载继续沿既有授权。

主对话 `sendAvailable` 表示逻辑入口可发送，空主对话仍需选择已配置模型；可选 `contextOrganizing:true` 表示正在整理上下文，`relayError` 为脱敏失败代码。客户端保留草稿，按原命令状态展示排队；时间线仍按9.3日期和全局事件身份显示，不展示执行段编号。旧会话直接发送及封段任务续做返回 `MAIN_CHAT_ROUTE_REQUIRED`；旧历史、已受理任务回执和停止按原身份保留。

宿主按原生实际上下文容量、对应压缩配置阈值及压力压缩事实记待接力；当前个人预设阈值为85%，已有研究压力策略触发压缩后也记待接力，不按消息条数切段。无运行回合/队列、待审批/提问、未确认副作用、后台任务及未结束goal（长期目标）时，在下一发送的空闲边界复用原生 `compactNow`。交接按原生 surface（模型上下文视图）顺序覆盖摘要及保留尾部、未完成todo（待办），不复制隐藏推理或旧记忆召回包；资料来自插件，不摄取为新原话。未知容量或交接超过窗口20%时保留旧段。

新段复用逻辑主对话工作目录、当前模型与审批设置，持久化及原生交接资料落盘后原子切换。崩溃前未发布仍指旧段，恢复复用已分配目标；发布后只向新段派发。定时规则原生管理身份不变，主对话执行投递通过同一逻辑命令队列选当前段；未来定时触发不永久阻塞接力。D33 同时清理在途交接、已发布摘要和分段索引；保留原话时不得从todo或压缩副本恢复。


### 9.7 逻辑生命周期、资源与历史读取边界（IA-2b / 2.6）

能力增加 `chatLifecycle:1,chatResources:1`。所有路径仍以 `/personal/v1` 开头，账户和原来源授权保持。旁聊当前只有一个原生段；本包不启用旁聊自动接力，也不提供主对话整段删除/归档入口。

| 接口 | 请求 | 响应与语义 |
|---|---|---|
| PATCH `/chats/{id}/metadata` | `requestId,expectedRevision` + 原 `title,pinned,unread,groupId,projectId` | `{chat}`；旁聊复用原元数据/项目检查，主对话仍只允许已读偏好 |
| POST `/chats/{id}/archive` 或 `/unarchive` | `{requestId,expectedRevision}` | `{chat}`；仅旁聊，归档保留历史、经验和记忆 |
| DELETE `/chats/{id}` | `requestId,expectedRevision,forgetMemories=false,deleteConversationSnippets=false,memoryWorldRevision?,expectedContentRevision?` | `{chatId,deleted:true}`；仅旁聊，沿D16/D33与原删除流程；原请求重放跨重启仍为同一删除结果 |
| GET `/chats/{id}/forget-preview` | 无 | 原遗忘预览加 `chatId,contentRevision,sessionCount,snippetCount`；按各原生段聚合来源、记忆项和evidenceIds（来源标识）去重，同一worldRevision（记忆修订）；修订改变409，需重新预览 |
| GET `/chats/{id}/resources` | `cursor?,limit?`（默认50、1–200） | `{outputs,sources,nextCursor,hasMore,contentRevision}`；原资源形状加 `chatId,sessionId,segmentId`，详情/下载继续原来源端点 |

生命周期写入沿既有账户事务及幂等请求表，先记目标身份，原请求重放先于修订检查；旁聊操作只保存结果身份，重放投影当前元数据，避免持久复制标题与来源；删除完成后不恢复缓存的标题/来源响应。普通写入沿 `commands:write`，遗忘操作和预览仍需账户管理权限，逻辑遗忘入口要求Cookie（会话凭据）。主对话生命周期保护在服务端执行。

资源游标只包含受签名的位置与内容代次，不包含正文。每次最多读取一个原生公开历史页（200条），即使没有成果也可以返回空数组与前进游标；客户端继续取页，并按原资源身份合并重复来源/使用记录。内容代次变化或宿主重启返回409 `CURSOR_RESET_REQUIRED`，先清理旧缓存。该入口不是跨全账户成果库，TB-3继续复用原文件授权。

固定DSH的JSONL（逐行结构化日志）后端未实现 `loadStoredFrom` 物理范围读取接缝；`readFrom` 虽返回后缀，仍解码完整前缀。宿主在 `dsh-home/weftmate-history.sqlite` 保存可重建的**公开历史投影缓存**，不解析原生物理日志、不保存隐藏推理或原始工具输出。每次读取通过DSH `listSnapshots` 的原生修订号核对；正常空闲边界增量维护，冷页命中只读SQL（结构化查询语言）范围。原工具详情仍按需读原日志，源日志更改/缓存缺失时仍通过原生解码重建，不宣称原生范围解码已经具备。

同一固定日志、50条尾页、各30个新进程：十万条改前冷p95（第95百分位）531.94ms，缓存命中后7.59ms（原生日志事件读取0）；万条78.96ms→7.81ms。**首次未命中仍需一次全量建缓存**：本次万条224.78ms、十万条1539.38ms，不纳入缓存命中成绩，也不声称达到200ms。未来DSH需提供原生修订绑定的前/后范围、稳定水位及压缩帧索引，使旧日志首次无缓存打开也有物理范围保证。

D33与删除会话清理同一缓存，SQLite使用安全删除及VACUUM（数据库重整），清理前后均失效并等待在途缓存工作；不会从新的备份或缓存重建恢复被忘内容。真实Electron（桌面程序框架）/Core（记忆核心）复验的新备份110文件、缓存2表与Core36表、全部日志帧均0命中。逻辑搜索索引仍为9.3的渐进内存索引；不把公开投影缓存当作另一份记忆来源。


## 10. 临时对话（MEM-2）

`GET /status.personalCapabilities.temporaryChats=1` 表示支持本节；旧客户端忽略新增字段。主对话是长期关系，不能设置临时或关闭记忆，入口应新建临时旁聊。

| 接口 | 请求 / 响应 | 语义 |
|---|---|---|
| POST `/commands`，`kind:session.create` | 原字段外可加 `temporary:true,recallEnabled?:boolean,autoDeleteDays?:1\|7\|30\|null` | 临时对话默认不形成记忆、仍可召回已有记忆、30天删除；只在创建时接受 `temporary`，其余选项要求 `temporary:true` |
| POST `/sessions/temporary` | `{requestId,modelProfileId,recallEnabled?,autoDeleteDays?}` → 202 `{command}` | 同上；宿主填充固定目标身份，供手机原生业务桥使用。沿原 `/commands/by-request/{id}` 追踪同一请求，不重复发送 |
| PATCH `/sessions/{id}/metadata` | 新增 `memoryMode:"on"\|"off",recallEnabled:boolean,autoDeleteDays:1\|7\|30\|null` | 旁聊独立设置；现有 Cookie（会话凭据）与 CSRF（跨站请求伪造防护）、账号授权保持；主对话409 `MAIN_CHAT_PROTECTED` |
| PATCH `/chats/{id}/metadata` | 同上，加既有 `requestId,expectedRevision` | 逻辑旁聊同一行为；主对话仍只允许已读设置 |
| GET `/sessions`、`/chats`、`/chats/{id}` | 增加 `temporary,memoryMode,recallEnabled,autoDeleteDays,expiresAt,hasTemporaryContent` | `expiresAt` 是宿主绝对到期时间或null。`hasTemporaryContent` 在恢复普通模式后仍为true：保留的临时历史不能进入全局正文、离线副本或自动上下文传递 |
| GET `/sessions/{id}/events` | 增加 `cacheAllowed:boolean` | 含临时内容的会话返回false；客户端可当前展示，不应保存为离线历史副本；Android（安卓）code26不写该历史缓存并清除旧缓存 |

记忆开关在下一个开始处理的原生回合生效；宿主在首次模型步骤前持久保存回合策略，正在处理的回合及其重试不受中途切换影响。临时回合在宿主摄取入口直接跳过，不进入待交付队列、Core（记忆核心）Evidence（原始证据）、形成或近期原话桥。召回独立默认开启；关闭召回只影响之后的回合，不删除当前可见聊天或以前的记忆。Core查询为只读，不需要新增Core协议。

恢复 `memoryMode:on` 不追溯摄取旧内容，取消本次自动删除。模型上下文从恢复后的新普通回合重新开始，排除旧临时原话、混合摘要和工作目录经验；用户仍能浏览原历史。之前已形成的记忆保留，提示可去记忆页遗忘。再次关闭按保存的期限开始新的删除倒计时。`autoDeleteDays:null` 不自动删除；修改期限从修改时间重新计算。

宿主启动及每分钟检查到期对话，沿D33/FG原生生命周期停止任务、删除原生日志、专属工作目录、附件、成果副本与宿主命令正文；忙碌或原生清理未确认时保留原记录并重试，不返回虚假的删除完成。共享项目目录内的用户文件仍按D33保留。新备份排除含临时内容的整段会话、工作目录、命令与可重建历史缓存，普通回合已形成的长期记忆保留。过去导出的文件与旧备份沿既有删除边界处理。

临时内容不自动回写主对话、不进入动态正文、全局成果库、近期对话离线副本。分叉、引用开旁聊、发布结果对 `hasTemporaryContent` 会话返回409 `TEMPORARY_CONTEXT_CONFIRMATION_REQUIRED`，直到显式分享功能提供确认与预览。TB-1/TB-3未来的全局列表必须排除该标记；对话内自己的输出与来源仍可查看。MEM-2没有新增全局列表接口。

Apple（苹果端）接线：新建入口发送 `/sessions/temporary`；侧栏/标题/输入区显示状态；菜单分别接记忆与召回开关和四档期限；切换说明之前形成的保留；主对话导向临时旁聊。持久化模型添加本节公开字段，`cacheAllowed:false` 的历史不写离线缓存，离线副本继续消费宿主过滤结果；到期404移除本机展示缓存。原生界面与Watch（手表）实机验收由Apple工作包完成。

### 9.8 动态与通知（TB-1 正式，D19 / D35 / D41 / D43）

`GET /status.personalCapabilities` 增加精确数字版本 `activity:1, activityChanges:1, activityRead:1, activityNotification:1`。客户端只接受已认识的精确版本；旧宿主隐藏入口，手机显示升级说明。这里是原生事实的持久投影，不新增任务执行器或调度器。宿主每轮有界读取 DSH（助手运行时）公开事件与原生 schedule（调度）送达事实；来源离线保留水位，不把读取失败记作任务失败。后台工作仍在运行或副作用未核实时，不产生任务完成条目。

| 方法 / 路径 | 输入 | 响应 / 语义 |
|---|---|---|
| GET `/activity` | `filter=all\|unread\|actionable`，`type=task\|reminder\|memory\|approval\|question\|system` 或完整类型，可选 `cursor,limit`（1–200，默认50） | `{items,nextCursor,hasMore,unreadCount,actionableCount,timeZone,snapshotCursor,syncCursor}`；按时间与ID反序。分页冻结首次水位，新事件不挤入旧页；账户时区用于按天分组 |
| GET `/activity/changes` | 可选 `cursor,limit,filter,type`；筛选只决定返回的已读快照范围，不过滤变更本身 | `{upserts,removals,nextCursor,hasMore,unreadCount,actionableCount,snapshotCursor}`；修改、已读与删除均传递；空游标从0开始；按ID更新，删除只携带ID，无旧正文 |
| GET `/activity/unread` | 无参数 | `{unreadCount,actionableCount}`；已读与待处理分别计数，标读不批准任务 |
| PATCH `/activity/{id}/read` | `{requestId,read:boolean,attentionRevision}` | `{item}`；可见内容版本必须一致，否则409 `REQUEST_CONFLICT`；同请求同体幂等，异体或与原命令 / 审批 / 问题请求身份碰撞409 |
| POST `/activity/read` | `{requestId,through:snapshotCursor}` | `{unreadCount,actionableCount}`；只覆盖快照水位与筛选范围内未发生新内容的条目；旧页面不标读后来事件；幂等规则同上 |

读取要求原 `sessions:read`，写入要求原 `commands:write` 与 CSRF（跨站请求伪造防护）；按账户认证隔离，不接收客户端传入账户ID。游标签名绑定账户、用途、分页筛选与删除代次；无效或跨账户409 `CURSOR_RESET_REQUIRED`。删除代次使旧列表 / 已读快照失效；增量游标仍能读出无正文删除ID。客户端收到重置先清旧正文再重读，身份 / 筛选变化的迟到响应不得填回。

每项 `Activity={id,at,type,title,summary,source,actions,state,read,revision,attentionRevision,createdSequence,notification,temporary?}`。`id` 与首次 `at` 稳定；同项正文或状态变化增加版本与注意水位。`summary` 最多160字符；`state=pending|completed|unavailable` 是待办状态，任务成功 / 失败 / 停止由 `type` 区分。`source` 按真实可用来源携带 `hostId,chatId,chatKind,sessionId,projectId,taskId,eventId,seq,messageId,scheduleId,memoryJobId`，不暴露路径、工具参数、凭据或私有推理。主对话结果与动态复用同一根任务 `activityId`；正文显式分享不是任务成功事实。

`actions=[{kind,label,target}]` 只描述实际存在的类型化动作，不是可执行网址。TB-1 支持 `open_chat`（原对话 / 旁聊及消息定位）、`respond_approval`（原 `sessionId,taskId,approvalId`）、`answer_question`（原 `sessionId,taskId,questionRpcId`）、`view_memory`。批准 / 拒绝仍直接走3.7的原审批路径、原回执校验与持久请求身份；问题打开原问题条，整批回答仍走3.7。动态没有通用任意执行接口，也不会因标读而完成待办。有效回执后原审批条与动态同时收为已处理；外部回答、取消、失效与重启都沿原生终态同步。未知动作不提供按钮。

既有 `GET /sync/events` 事件通道兼容增加 `activity:{cursor,unreadCount,actionableCount}`，不占用手机聊天事件的 `seq` 或伪造对话消息。客户端据此或既有前台状态轮询，使用 `/activity/changes` 获取增量；桌面后台通知在主进程观察，窗口隐藏仍可送达。这里使用既有认证轮询通道，没有另建未授权推送服务或宣称已有安卓后台送达。旧 `/notifications` 继续从相同原生提醒事实读取，旧客户端读取不改变账户已读。

| `type` | 通知等级 `notification.level` | 首版来源与边界 |
|---|---|---|
| `reminder.triggered` | `important`（重要） | 原生提醒 / 定时任务已经送达，稳定送达 / 消息身份去重 |
| `approval.pending`, `question.pending` | `important` | 原审批 / 问题确实待处理；处理后的版本为 `silent` |
| `task.failed` | `important` | 原生任务失败，不把断线或未知结果冒充失败 |
| `task.completed`, `task.stopped` | `normal`（普通） | 原生终态；后台工作与副作用同时核对 |
| `memory.paused` | `normal` | 记忆暂停 / 不可用状态发生变化；MEM-D的正常形成不算暂停，模型不可用与本人暂停补整理按真实原因生成 |
| `memory.submission.completed` | `silent`（静默） | M3-A离线对话补交已受理，或MEM-D有实际提交的历史补交已结束；不称正式记忆形成 |
| `memory.report` | `normal` | 类型与接缝预留，MEM-3尚未生成周报 |
| `system.update.available` | `normal` | 现有更新状态确实提供新版本；不暴露更新源或增加安装授权 |
| `system.reconnected` | `silent` | 已观察就绪的宿主重启后再次就绪，或运行时不可用后恢复；首次安装启动不伪造恢复事件，不凭单个会话读取失败断言电脑离线 |

`notification={level,type}` 的 `type` 是 ST-6（通知设置）的按类型开关接缝；ST-6未实施前维持现有系统通知行为。等级不是权限，重要不跳过未来勿扰或主动打扰限制。桌面用现有原生通知，每条动态ID最多一份系统通知，内容修订不重复弹出；点击带对应 `activityId` 打开动态并聚焦条目。通知去重仅持久保存账户与条目ID，无标题 / 正文。删除增量关闭对应已显示通知。S3a后续消费同一ID、等级与类型接安卓后台通知，约15分钟以上延迟的边界仍按D41说明；不得创建第二个提醒调度器。

宿主可信接缝 `service.recordActivity(ownerId,{key,type,at?,title,summary,source?,actions?,level?})` 只允许已登记的记忆与系统类型，`key` 使用上游稳定事件 / 回执ID；相同事实与正文不会重复插入。它不暴露为公共HTTP（网络请求）写入接口。MEM-D / MEM-3 / S3a使用该接缝提供真实状态，不能提交临时正文或未发生的成功。

删除会话 / D33遗忘沿 `eraseChatCopies` 清动态摘要、动作、原生观察摘要与待完成投影；无正文墓碑和抑制水位防止旧通知、旧回执、迟到观察或重启重建正文。账户删除带走整个账户存储。临时 / 混合临时来源在持久化前只保留泛化标题、原来源ID和安全动作：完成摘要固定“临时对话中的任务已完成”，失败 / 停止也只描述状态；临时审批 / 问题不带对象、问题正文或工具参数。此规则同时约束系统通知。

## 11. 记忆摄取健康与历史补整理（MEM-D）

`GET /memory/status` 保留既有字段，新增可选 `pendingFormationCount`、`failedFormationCount`、`captureError` 和 `backfill`。`pendingBoundaryCount` 是宿主 outbox（持久待提交队列）条数，模型不可用时仍返回已知数量。`pendingFormationCount` 是 Core（记忆核心）已接受、尚在形成的作业数；两者不能混为已形成条数。`state=degraded` 也可表示正在整理，已有可用记忆继续沿 `capabilities.inject` 与原目的地权限使用。`reasonCode` 新增 `MEMORY_MODEL_WAITING`（切换中，等待原模型服务）、`MEMORY_FORMATION_PENDING`、`MEMORY_FORMATION_FAILED`；保留 `MEMORY_BUSY`、`MEMORY_MODEL_UNAVAILABLE` 与来源阻断原因。`GET /system.memory` 同步提供 `reasonCode,pendingBoundaryCount,pendingFormationCount,failedFormationCount`，供设置健康项显示。客户端必须区分正常、补交／形成中和暂停，不能把503当作空记忆。

| 接口 | 请求与结果 |
|---|---|
| `GET /memory/backfill` | 200 `{ownerId,previewId,sessionCount,turnCount,estimatedUsage:{inputTokens,outputTokens,approximate:true},job}`；扫描账户已完成的原生回合，仅返回计数与估算，不调用形成模型。估算含每回合提示与输出余量，实际重试与模型用量可能不同，不是价格承诺。 |
| `POST /memory/backfill` | `{action:"start",previewId,confirm:true}` → 202 `{ownerId,job}`；必须先读取预览，再由本人确认。相同预览的重复提交返回同一作业，不重复形成。 |
| `POST /memory/backfill` | `{action:"pause"\|"resume"\|"cancel",jobId}` → 202 `{ownerId,job}`；暂停／取消停止后续提交，已经交给Core的回合继续形成；取消不删除已经形成的记忆。 |
| `GET /memory/status` | `backfill:null` 或 `{id,state:"running"\|"paused"\|"cancelled"\|"completed",totalTurns,submittedTurns,skippedTurns,lastError,createdAt}`；`submittedTurns` 包含已检查并跳过的回合，实际提交数为两者之差。`completed` 表示补交结束，是否形成完毕另看形成计数。 |

读接口沿账户会话读取权限，写接口要求 `account:manage` 与原 CSRF（跨站请求伪造防护）。缺少确认／预览失效409 `MEMORY_PREVIEW_REQUIRED`，无此作业404 `MEMORY_JOB_NOT_FOUND`，参数无效400 `INVALID_REQUEST`。所有结果绑定 `ownerId`；切换账户时丢弃旧预览与迟到响应。

补整理按原回合时间顺序进行，每步重核对会话及来源；临时对话、当前关闭记忆的对话、回合冻结策略禁止摄取的内容和已遗忘来源均排除。排除已确认投递的回合及Core已接受的边界；事件标识沿实时摄取算法保持一致，重复确认、重启与未知回执不会重复形成。历史回合默认不自动运行；升级后新完成的普通回合由持久日志恢复漏掉的IPC（进程间通信），先写outbox再尝试投递，忙／路由不可用／子进程离线均退避重试。宿主重启恢复outbox和已确认的补整理进度，暂停状态也持久保留。

Windows（视窗系统）程序与远程手机网页、Android（安卓）界面包已接入。安卓现有 `host.business` 记忆路由支持这些接口，无需新增权限；Apple（苹果端）需接记忆页健康、预览／确认、暂停／继续／取消及进度，旧客户端可忽略新增字段。确认与溯源语义未改变，不把助手提议当作用户事实。


## 12. 首次使用引导与模型发现（ONB-1）

仅全新宿主安装建立未开始的引导；升级已有数据目录不补建。旧账户、预先配置的账户，以及已完成引导的安装不自动显示。引导开始后绑定当前账户；其他账户不读取该账户的中断进度。设置可主动重新查看。步骤与完成状态在宿主中原子保存，客户端不另存账户、模型或称呼。

| 路径 | 请求 | 返回与授权 |
|---|---|---|
| `GET /onboarding` | 无查询 | 200 `{onboarding:null\|{step,completed,started,ownerId?}}`；账户创建前可读安装进度，绑定账户后只有该账户可读，其他身份返回 `null`。旧安装返回 `null`。 |
| `PATCH /onboarding` | `{step,completed}` | 200 同上；`step=welcome\|account\|model\|memory\|import\|phone\|first`，`completed` 为布尔。无账户时仅宿主直接同源地址；有账户后沿 Cookie（会话凭据）/CSRF（跨站请求伪造防护）与 `account:manage`。用于每次前进 / 返回 / 完成，以及主动重新查看。 |
| `POST /models/discover` | `{addresses?:string[]}` | 200 `{results:[{baseUrl,models:string[]}]}`；`account:manage` 与原 Cookie/CSRF。只向本机及已发现的局域网邻居的常见模型端口读取 `/v1/models`；可补充明确的本机 / 私网地址。不发送密钥，不重定向，不发对话，不保存模型，必须由用户选中结果并保存。 |

当前默认探测端口为 11434、1234、8000、5000，避免自动探测日用模型代理 8081；邻居来源为操作系统已有邻居表，不枚举整个网段。其他端口可填补充地址，仍只读模型目录。`addresses` 不接受公网地址、带凭据 / 参数 / 片段的地址。目录不公开或需要密钥的服务仍走已有的模型表单与逐项诊断。未配置模型可跳过，但「开始聊天」要求当前账户至少有一个已配置模型，首页保留设置提示。

账户沿第7节注册 / 登录 / 本地设置流程；称呼写 ST-1 的 `PATCH /settings/personalization {preferredName}`；模型沿 `/account/models/check`、保存回执与 `/settings/models`，中断后只保存非秘密请求编号并核对原回执；记忆沿第11节状态和只读补整理预览，不自动运行；导入入口置灰。连接手机沿第7节一次性二维码 / 配对码及设备允许 / 拒绝，不新建信任协议。一次性码持有与同账户验证是原扫码批准路径；无配对码的新设备仍须在已登录电脑上明确允许。

Apple（苹果端）：Mac 执行宿主按本节读取安装进度并保存步骤，远程 iPhone / Mac 只接「连电脑」说明与现有扫码 / 批准流程；Watch（手表）不显示七步引导。文案与提供方获取密钥说明的中文来源为 `src/ui-core/onboarding-copy.js`，英文随 L10N-1 补齐。
