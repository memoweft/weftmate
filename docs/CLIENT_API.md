# 客户端契约：`/personal/v1`

> M0-5 基线：`main` 提交 `28b5d36`，按当前服务端行为整理；以后拆文件不改变这里的路径与语义。M0-5 首次建立文档基线；M0-3 / M1-0a 更新历史与时间线实现，不修改 Swift。实现核对来源：`src/personal-access/`、`src/personal-access-backend.mjs`、`src/personal-memory/http.mjs`、`src/personal-sync/`；客户端来源见下表。
> M0-3 / M1-0a 已实现：历史尾页、向前翻页、正向增量与对话时间线；Apple 保留旧正向读取，待 A1 / M1-0d 接入。产品决定见 [PLAN.md](PLAN.md) D5–D8、M0-5、M1-0；呈现规则见 [UI_SPEC.md](UI_SPEC.md)。

## 1. 范围与通用约定

本文覆盖 **82 个业务方法/路径组合**（第 3 节 78 项 + 第 6 节健康 4 项），另列 **12 个桌面 UI 静态路径**。同一路径的不同 HTTP 方法分别计数；`/commands` 的不同 `kind` 不重复计数，参数化资源路径计一种。表中路径均省略 `/personal/v1` 前缀，`{id}` 为调用方填入的资源标识；示例用短 ID 与示意哈希，真实请求须满足格式约束。响应示例仅保留关键字段，`Auth`、`Command`、`Task`、`Receipt` 等对象的 JSON 例子见第 2 节。未写查询参数的接口不要加查询串。

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

`Command`：`state` 为 `pending / dispatching / accepted_by_dsh / accepted_by_host / observed / uncertain / rejected`；可有 `errorCode`、`rootTaskId`、`taskAction`、`conversationId`、`sourceSyncEventId`、附件元数据、项目/浏览器字段。`desktop.write_artifact` 成果命令另含 `taskId,artifactId,fileName,contentType,size,sha256,verification`；只有 `observed` 且校验通过才可下载。模型命令不在此对象中。

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

`backend.capabilities` 还含 `desktopOpenApp,naturalLanguageDesktop`；`modules` 含 `memory,mods,tasks,notifications,workspaces,capabilities`。这些是能力/状态字段，不代表存在同名 HTTP 路由。

### 3.3 会话列表（1）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/sessions` | 无；当前无列表分页/搜索参数 | 200 `{"sessions":[{"sessionId":"session-…","title":"资料整理","running":true,"sendAvailable":true,"modelProfileId":"local"}]}` | 后端整体失败/单会话降级 | 桌、手、安、苹 |

项目会话可带 `projectId,projectRevision,projectName,projectRevoked`，浏览器会话带 `workspaceKind:"browser"`，共享会话带 `conversationId`。无法描述的会话返回 `title:"",running:false,sendAvailable:false,unavailable:true`。`sendAvailable` 是可发送权限，不是「当前空闲」；列表当前按会话 ID 遍历，客户端自行呈现排序。创建走 `/commands`，没有 POST `/sessions`。

### 3.4 历史与事件流（2）

| 方法与路径 | 请求参数 | 响应 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/sessions/{sessionId}/events` | 无游标：最近 N 条；`beforeSeq` 非负，排除边界向前翻页；`afterSeq` ≥ -1，排除边界正向增量。两者互斥。`limit` 默认 100，1–200 | 200 `{events,nextSeq,hasMore,nextBeforeSeq,hasOlder,latestSeq}`；事件按 seq 升序 | 400 `INVALID_REQUEST`；404 `SESSION_UNAVAILABLE`；503 `BACKEND_UNAVAILABLE` | 桌、手、安、苹（旧正向） |
| GET `/sessions/{sessionId}/events/{seq}/detail` | 非负安全整数 seq；无查询 | 200 `{"seq":42,"text":"原始参数与工具输出的 JSON 文本","truncated":true}`；`truncated` 仅截断时出现 | 400 `INVALID_REQUEST`；404 `SESSION_UNAVAILABLE`；503 `BACKEND_UNAVAILABLE`（无该工具详情时） | 桌、手、安 |

这是 JSON（结构化数据）分页 / 轮询，不是 SSE（服务端推送事件）。每页事件 seq 严格递增，但不保证连续；消息、执行与交互共用 DSH 原生 seq。`limit` 按公开时间线条目计数，过滤的文字 chunk（片段）、推理和注入上下文不占条目数。

- 首屏 `?limit=100` 只投影最新条目，不要求扫到会话开头。`nextSeq` 是稳定投影水位，`latestSeq` 是此次读取的原生日志尾部水位。通常相同；当最后一个 step/end 尚未由下一次 step/start 或 turn/end 确认时，nextSeq 会暂时停在它之前，避免漏掉随后确认的 task.ended。`hasMore:false`；`hasOlder` 表示是否还有更早公开条目，`nextBeforeSeq` 是下次排除的向前边界。
- 上翻 `?beforeSeq=<nextBeforeSeq>&limit=100` 返回更早条目，仍按 seq 升序。用新的 `nextBeforeSeq` 继续上翻；`hasOlder:false` 表示已到开头。**上翻响应不能覆盖客户端的正向增量游标**：它的 `nextSeq/latestSeq` 可能包含尚未增量读到的新事件。
- 增量 `?afterSeq=<nextSeq>&limit=100` 正向读取，`hasMore` 表示尚有后续条目。继续读取必须使用返回的 `nextSeq`，它可跨过过滤的内部事件；空页也可推进水位。此方向的 `nextBeforeSeq` 只是本页最早条目，`hasOlder:false` 不用于判断完整历史。
- **旧 `afterSeq=-1` 兼容**：继续从会话开头正向分页，绝不改成尾页。Apple 当前客户端可以照常读取文字和回合状态，新事件及字段均为追加。
- 空日志 `events:[],nextSeq:-1,latestSeq:-1,nextBeforeSeq:null,hasMore:false,hasOlder:false`。`beforeSeq=0` 可返回空页。客户端按 `(sessionId,seq)` 去重，开始/完成按 stepId 更新，禁止自行给 seq 加一。
- 消息最多显示 4,000 个 UTF-16（字符串编码）单元；工具投影不带原始参数 / 输出。单条大记录截断并标记 `truncated`，整页按字节分页；长会话不再返回 `HISTORY_WINDOW_LIMIT`。用户原件消息仍可由原有附件登记恢复显示文本。
- 详情只读取工具调用、工具结果和审批原始记录；推理、注入上下文不开放。返回最多 64,000 个 UTF-16 单元，超出标记截断。详情与历史使用同一账号 / 会话读取权限，不公开本机路径形式的下载引用。

保留既有类型：`user.message`（`text,receiptId,images,originalAttachments,attachmentMessageId` 等）、`assistant.message`（`text,images`）、`turn.started`（`turn`）、`turn.ended`（`reason`，可有 `turn,endReasonKind`）。输出预算耗尽仍为 `reason:"error",endReasonKind:"max-tokens"`。执行事件见第 4 节。历史图片下载仍见 3.5。

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
| `session.message` | 必填 `sessionId,text`，`text` ≤8,192个 UTF-16 单元；可选 `mode:"queue" / "steer"`，默认 `queue`；可选 `attachments`、`attachmentMessageId + originalAttachments`、`sourceSyncEventId`。只在有附件时允许空文字；同步来源事件须与当前设备/会话/文字对应 |
| `session.cancel` | 必填 `sessionId`；取消会话当前执行，不等于某个根任务停止已被观察到 |
| `desktop.open_app` | 必填 `appId:"notepad"`；现存窄能力，只宿主所有者可用，非 M1 通用工具方案；四类入口未见直接调用该命令 |

发送示例：`{"requestId":"send-1","kind":"session.message","targetDeviceId":"host-…","sessionId":"session-…","text":"整理资料","mode":"queue"}`。DSH 已接收不等于完成；现有 `queue` 参数不等于 M1-0b 的可取消任务队列已完成。

会话暂存附件 ID 必须 `attachment-<uuid>`，`requestId` 与后续消息相同；`attachments` 元数据五字段必须齐全：`attachmentId,name,contentType,size,sha256`。最多4个，图像单个≤5 MiB，文本单个/合计≤16 KiB，总计≤10 MiB；文本 MIME 支持 `text/plain,text/markdown,text/csv,application/json,application/x-ndjson`。GET 会话附件当前只读持久图片，不能用它下载所有暂存文本。

同步原件单个≤1 GiB，保留原 MIME，不意味着模型能读取其格式；显示版只收 JPEG、≤512 KiB，原件必须先存在。`originalAttachments` 最多4个，另需 `attachmentMessageId`；用于保留原件与模型输入的关系，不把1 GiB原件直接当成模型输入。同步消息的 `attachments` 数量上限为8，不能与发送命令上限混用。

### 3.6 停止 / 任务控制与命令查询（8）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/commands` | `before=<commandId>`；`limit` 默认50、1–100 | 200 `{"commands":[Command],"nextBefore":"cmd-…","hasMore":true}`，新到旧 | 404 `NOT_FOUND`（游标不存在） | 桌、手、安、苹 |
| GET `/commands/{commandId}` | 无 | 200 `{"command":Command}` | 404 `NOT_FOUND` | 桌、手、安 |
| GET `/commands/by-request/{requestId}` | 无 | 200 `{"command":Command}` | 404 `NOT_FOUND` | 桌、手、安、苹 |
| GET `/tasks/{taskId}` | 无；根命令 ID | 200 `Task`（无 `task` 外壳） | 404 `NOT_FOUND` | 桌、手、安、苹 |
| GET `/tasks/{taskId}/sources/{snapshotId}` | 无；只读该任务引用的项目/网页快照 | 200 `{"source":{"snapshotId":"snapshot-…","relativePath":"README.md","lineStart":1,"lineEnd":10,"fileSha256":"…","text":"…"}}` | 404 `NOT_FOUND`；快照校验失败 | 桌、手、安、苹 |
| POST `/tasks/{taskId}/stop` | `{"requestId":"stop-1"}` | 202 `{"task":Task}`；重放同请求不重复发起 | 409 `TASK_NOT_READY / REQUEST_CONFLICT`；404 `NOT_FOUND` | 桌、手、安、苹 |
| POST `/tasks/{taskId}/supplements` | `requestId,text`（沿用消息上限） | 202 `{"task":Task,"command":Command}`，子命令 `taskAction:"supplement"` | 409 `TASK_NOT_READY / REQUEST_CONFLICT` | 桌、手、安 |
| POST `/tasks/{taskId}/resume` | `requestId,text`；停止已确认且 `canResume` | 202 `{"task":Task,"command":Command}`，子命令 `taskAction:"resume"` | 409 `TASK_NOT_READY / REQUEST_CONFLICT` | 桌、手、安 |

来源快照项目字段还含 `totalLines,readAt,hasMore,projectId,projectRevision`；网页字段为 `kind:"webpage",title,url,requestedUrl,readAt,contentSha256,truncated,links`，可有分段/版本字段。网页预览兼容字段 `fileSha256` 是返回文本的哈希；项目 `fileSha256` 是原文件哈希，不是摘录文本哈希。

任务控制当前仅适用于 `personal-remote` 会话根消息；已接管的 `shared-chat` 会话命令仍可读/发/取消，但 `/tasks` 不提供它的任务详情（404 NOT_FOUND）。停止先登记 `stop_requested` 并使未处理审批/提问失效，再驱动取消与后台 job 停止；HTTP 202 不证明副作用已停止。`stopStatus` 可为 `requested / cancel_requested / stopped / completed / unconfirmed`，结合 `canResume,pendingReceipts,backgroundJobs` 呈现。M1-0 的任务卡、取消排队尚未作为独立契约落地；现有任务读取接口保留给对话内展示。

### 3.7 审批与提问（4）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/sessions/{sessionId}/approvals` | `before=<approvalId>`；`limit` 默认50、1–100 | 200 `{"approvals":[{"approvalId":"<uuid>","sessionId":"session-…","taskId":"cmd-…","toolName":"shell","reason":"覆盖文件","status":"pending","createdAt":"…"}],"nextBefore":null,"hasMore":false}` | 404 `SESSION_UNAVAILABLE / NOT_FOUND` | 桌、手、安、苹 |
| POST `/sessions/{sessionId}/approvals/{approvalId}` | `requestId,outcome`；仅 `allowed-once / rejected` | 200 `{"approval":{"approvalId":"<uuid>","status":"answered","decisionOutcome":"allowed-once","decisionRequestId":"approve-1","answeredAt":"…"},"requestId":"approve-1"}` | 409 `APPROVAL_NOT_PENDING / REQUEST_CONFLICT`；404 `NOT_FOUND` | 桌、手、安、苹 |
| GET `/sessions/{sessionId}/questions` | `before=<questionRpcId>`；`limit` 默认50、1–100 | 200 `{"questions":[{"questionRpcId":"<uuid>","status":"pending","questions":[{"id":"destination","question":"保存到哪里？","options":[{"label":"Downloads"}]}],"createdAt":"…"}],"nextBefore":null,"hasMore":false}` | 404 `SESSION_UNAVAILABLE / NOT_FOUND` | 桌、手、安、苹 |
| POST `/sessions/{sessionId}/questions/{questionRpcId}` | `{"requestId":"answer-1","answer":{"answers":[{"id":"destination","selected":["Downloads"]}]}}` | 200 `{"question":{"questionRpcId":"<uuid>","status":"answered","answer":{…},"answerRequestId":"answer-1","answeredAt":"…"},"requestId":"answer-1"}` | 409 `QUESTION_NOT_PENDING / REQUEST_CONFLICT`；404 `NOT_FOUND` | 桌、手、安、苹 |

列表新到旧，返回所有状态：`pending / answered / resolved / unavailable`。审批记录另含 `sourceCommandId,sourceReceiptId,turn,callId,rootCallId`，处理后可有 `outcome,resolvedAt`；列表读取会刷新实时状态。POST回执保持登记时的 `answered`，重放旧回执不能覆盖较新的 `resolved`。

每批问题按原顺序完整作答：`answers` 数量与问题数量相同、`id` 对应；`selected` 选项标签不可重复，可带非空 `custom`。单选不能同时给选项与自定义；多选由 `multiSelect` 标记。问题可含 `header,detail,intent:{kind:"plan-review",approve:"<label>"}`；它仍是信息提问，回答不授权工具。`answerAcceptedAt` 才是个人入口答案被消费的确认，200/`outcome:"answered"` 本身不是。UI_SPEC 的「总是允许此类」目前无提交值/策略接口，不能发送臆造 outcome。

### 3.8 成果下载（3）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/artifacts/{artifactId}` | 无 | 200 `{"artifact":{"kind":"desktop.write_artifact","artifactId":"artifact-…","taskId":"cmd-…","fileName":"报告.md","size":128,"sha256":"…","state":"observed","verification":{"status":"observed","method":"sha256_readback","observedAt":"…"}}}` | 404 `NOT_FOUND`；409 `ARTIFACT_UNVERIFIED` | 苹 |
| GET `/artifacts/{artifactId}/preview` | 无 | 200 `{"artifact":Command,"text":"报告内容"}` | 同上 | 桌、手、安、苹 |
| GET `/artifacts/{artifactId}/download` | 无 | 200 文件字节；`Content-Type,Content-Length,Content-Disposition` | 同上 | 桌、手、安、苹 |

现有成果是宿主登记且校验过的 UTF-8 文本、≤128 KiB，支持相应文本 MIME；未提供客户端直接登记成果/任意路径下载 API。来源校验通过才可打开/保存，客户端可核对元数据与字节哈希。

### 3.9 记忆（10）

`kind` 为 `cognition / entity / relationship / event`；下表均有顶层 `ownerId`。写入体 ≤12 KiB，`expectedWorldRevision` 是非负安全整数。

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/memory/status` | 无 | 200 `{"state":"disabled","worldRevision":null,"capabilities":{"list":false,"source":false,"correct":false,"mute":false,"inject":false,"deleteEvidence":false,"deleteWorldItem":false}}` | 内存服务错误；未配置仍200 | 桌、手、安、苹 |
| GET `/memory/items` | `kind` 默认cognition；`query` ≤120 UTF-16；`limit` 默认50、1–50；`after=<nextCursor>` | 200 `{"items":[{"id":"memory:1","kind":"cognition","text":"偏好中文","truncated":false,"currentState":"current","createdAt":"…","updatedAt":"…","lifecycle":{"invalidAt":null,"archivedAt":null,"mutedAt":null},"sourceCount":1}],"worldRevision":8,"nextCursor":null,"hasMore":false,"searchScope":"account_snapshot"}` | 409 `MEMORY_REVISION_CHANGED`；413 `MEMORY_SEARCH_LIMIT`；503 `MEMORY_DISABLED` | 桌、手、安、苹 |
| GET `/memory/items/{kind}/{itemId}` | 无 | 200 `{"item":{…},"worldRevision":8,"availableActions":{"correct":{"available":true},"mute":{"available":true},"delete":{"available":false,"reasonCode":"MEMORY_DELETE_UNAVAILABLE"}}}` | 404 `NOT_FOUND`；503 `MEMORY_RESPONSE_INVALID` | 桌、手、安、苹 |
| GET `/memory/items/{kind}/{itemId}/sources` | 无 | 200 `{"sources":[{"evidenceId":"evidence:1","relation":"supports","currentnessState":"current","permissions":{"allowLocalRead":true,"allowCloudRead":false,"allowInference":true},"contentAvailable":true,"summary":"…","rawContent":"…","rawContentTruncated":false,"recordedAt":"…"}],"worldRevision":8}` | 404 `NOT_FOUND`；503 `MEMORY_RESPONSE_INVALID` | 桌、手、安、苹 |
| POST `/memory/items/{kind}/{itemId}/correct` | `requestId,expectedWorldRevision,text`；非entity，非空文字≤4,000 UTF-16 | 200或409 `Receipt` | 422 `MEMORY_ACTION_UNSUPPORTED`；409 `MEMORY_REQUEST_CONFLICT / MEMORY_REPLAY_REDACTED` | 桌、手、安、苹 |
| POST `/memory/items/{kind}/{itemId}/mute` | `requestId,expectedWorldRevision` | 200或409 `Receipt` | 503 `MEMORY_ACTION_UNSUPPORTED / MEMORY_UNAVAILABLE`；409请求冲突 | 桌、手、安、苹 |
| DELETE `/memory/items/{kind}/{itemId}` | `requestId,expectedWorldRevision`（JSON体） | 200或409 `Receipt` | 503 `MEMORY_DELETE_UNAVAILABLE`；409请求冲突 | 桌、手、安、苹 |
| DELETE `/memory/evidence/{evidenceId}` | `requestId,expectedWorldRevision`（JSON体） | 200或409 `Receipt` | 404 `NOT_FOUND`；503 `MEMORY_DELETE_UNAVAILABLE` | 桌、手、安、苹 |
| GET `/memory/commands/by-request/{requestId}` | 无 | 200 `Receipt`（也可包含拒绝/冲突状态） | 404 `NOT_FOUND`；409 `MEMORY_REPLAY_REDACTED` | 桌、手、安、苹 |
| POST `/memory/commands/by-request/{requestId}/retry-cleanup` | `{}`，≤1 KiB；只重试原删除的底层清理 | 200 `Receipt` | 404 `NOT_FOUND`；422 `MEMORY_ACTION_UNSUPPORTED`；503 `SERVICE_UNAVAILABLE` | 桌、安（能力）、苹 |

查询对当前账号快照搜索，`query` 经 NFKC/trim/小写规范化；游标绑定账号、kind、query、worldRevision，修订变化后重新查首屏。`currentState` 另可 `not_current`。来源最多200条，摘要≤2,000、原文≤8,192 UTF-16；详情/来源内部大小上限256 KiB。拒绝删除的原因在 `receipt.reasonCode`，可为 `MEMORY_DELETE_CONFLICT / MEMORY_SOURCE_UNRECOVERABLE / MEMORY_DELETE_SOURCE_UNKNOWN / MEMORY_COMMAND_REJECTED`；外层未知错误会投影为 `SERVICE_UNAVAILABLE`。`capabilities.inject` 仅表示能力，当前没有公开「注入/采用记忆」HTTP路由。

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

`AccountModel`：`{"accountModelId":"account-model-<uuid>","revision":1,"profileId":"private-model-…","name":"自用","provider":"openai-compatible","baseUrl":"https://model.example/v1","modelId":"model","modelTier":"auto","sourceKind":"cloud","routeFingerprint":"…","configured":true,"status":"active","createdAt":"…","updatedAt":"…"}`。列表不含密钥；`transfer` 是已有的显式传密钥接口，重复 `requestId` 不作为可重放的密钥回执。改 `baseUrl` 必须同时给新 `apiKey`。账号模型变更要求密码Cookie管理权限，登记后由 `by-request` 核对。

模型配置的可选 `modelTier` 为 `auto / local / cloud`：POST 省略或设 auto 按地址判断，PATCH 省略保留原值、auto 恢复自动判断，local/cloud 为用户覆盖（例如把 loopback 云端代理设为 cloud）。`AccountModel` 与 GET `/models` 返回 modelTier（旧配置显示 auto）和最终 `sourceKind: local | cloud`。自动判断使用实际 base URL 主机：127.0.0.0/8、::1、localhost、10/8、172.16/12、192.168/16、`*.local` 为 local，其余为 cloud；不要求正式本地 profile。HTTP 地址可用于上述本机/局域网范围，其他地址仍要求 HTTPS。字段跟随模型 runtime 修订持久化、可转移；仅改变位置也生成新的 profileId，旧会话保留原配置。无字段的旧请求/存储继续兼容，非法值返回 400 `INVALID_REQUEST`。

`ModelOperation`：`{"operation":{"requestId":"model-1","kind":"create","accountModelId":"account-model-…","status":"pending","createdAt":"…","updatedAt":"…"},"model":AccountModel}`；状态 `pending / applying / succeeded / failed / uncertain`，可有 `expectedRevision,resultRevision,reasonCode,errorCode,testResult`。模型选择是创建会话时的 `modelProfileId`，当前没有独立的会话换模型 `/personal/v1` 路由。

模型代理是受限 OpenAI 兼容体：`model` 必须对应所选profile；messages 1–40条、文字≤16,384 UTF-16，角色 `system/user/assistant/tool`；最多8个function工具，`tool_choice` 仅 `auto/none/required`；`max_tokens` 1–8192，temperature 0–2。它是手机本地循环的模型请求通道，不是宿主DSH办事消息接口。`verify` 明确没有验证实际推理。

### 3.11 项目与浏览器工作区（6）

| 方法与路径 | 请求参数/体 | 响应示例 / 状态 | 主要领域错误 | 使用端 |
|---|---|---|---|---|
| GET `/projects` | 无 | 200 `{"projects":[{"projectId":"project-…","name":"资料","revision":1,"revoked":false,"createdAt":"…"}],"canManage":true}` | — | 桌、手、安 |
| POST `/projects` | `requestId,name,rootPath`；仅宿主所有者 | 201，重放200 `{"project":{…}}`；不回传rootPath | 403 `FORBIDDEN`；409 `REQUEST_CONFLICT`；503 `PROJECT_WINDOWS_REQUIRED / PROJECT_UNSAFE_PATH` | 桌 |
| POST `/projects/{projectId}/revoke` | `requestId`；仅宿主所有者 | 200 `{"project":{"projectId":"project-…","revision":2,"revoked":true,"revokedAt":"…"}}` | 404 `NOT_FOUND`；409 `PROJECT_REVOKED / REQUEST_CONFLICT` | 桌 |
| POST `/projects/{projectId}/sessions` | `requestId,modelProfileId` | 202 `{"command":Command}` | 404 `NOT_FOUND`；409 `PROJECT_REVOKED`；422 `MODEL_UNAVAILABLE` | 桌、手、安 |
| GET `/workspaces/browser` | 无 | 200 `{"available":true,"hostId":"host-…","workspaceKind":"browser"}`；可有 `reasonCode` | — | 桌、手、安 |
| POST `/workspaces/browser/sessions` | `requestId,modelProfileId`；宿主所有者 | 202 `{"command":Command}` | 503 `BROWSER_UNAVAILABLE / BROWSER_CLEANUP_FAILED`；422 `MODEL_UNAVAILABLE` | 桌、手、安 |

项目撤销使绑定旧revision的会话不可再发送。浏览器会话的消息文字需有初始 HTTP(S) URL，缺失可报400 `BROWSER_URL_REQUIRED`；执行失败可在命令/任务中出现 `BROWSER_*` 或 `PROJECT_*`。没有公开的任意项目文件/浏览器命令HTTP接口，成果与来源走任务/成果接口。

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

### 3.14 桌面 UI 静态资源（12个 GET 路径，不计入82业务接口）

| GET路径（都无查询） | 响应 / 错误 | 使用端 |
|---|---|---|
| `/ui`、`/ui/`、`/ui/index.html` | HTML；未装UI handler为404 `NOT_FOUND` | 桌（宿主页） |
| `/ui/app.js`、`/ui/timeline.js`、`/ui/styles.css`、`/ui/favicon.svg`、`/ui/file-sha256.js` | 对应JS/CSS/SVG资源；不存在404 | 桌（宿主页/导入） |
| `/ui/vendor/noble-hashes-2.3.0/sha2.js`、`/ui/vendor/noble-hashes-2.3.0/_md.js`、`/ui/vendor/noble-hashes-2.3.0/_u64.js`、`/ui/vendor/noble-hashes-2.3.0/utils.js` | JS资源；不存在404 | 桌（哈希模块导入） |

这些路由在认证前提供宿主登录UI，仍受Host/Origin校验。Android bridge中的本机模型、通知、剪贴板、语音等操作不是同名服务端API；`mods/notifications/capabilities` 等字符串出现在bridge允许路径中，也不能证明服务端实现了这些路由。

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
| `artifact.created` | `taskId,artifactId,fileName,contentType,size,detailSeq,completedStep` | 原生 tool/result 含成果引用时，该 seq 投影为成果条目；completedStep 带同一步的完成字段，客户端同时结束该 stepId。此 taskId 可为根命令 ID，completedStep.taskId 仍是原生回合键。预览、下载和验证元数据仍使用 3.8 成果接口 |
| `task.started` | `taskId,turn` | 原生 step/start 的 step=1；保留独立 seq 的既有 turn.started |
| `task.ended` | `taskId,turn,reason,nativeTurnEndSeq,endReasonKind?` | 原生最终 step/end，后续 turn/end 确认其结束原因；中间模型 step 不结束任务。保留独立 seq 的既有 turn.ended；未真正进入 step 的阻断回合仍只返回 turn.ended |
| `task.queued` | `taskId`，可附请求信息 | 保留该公开类型的投影；当前固定 DSH 不产生此事件，本包不新增队列生产者、排队取消或插话调度；M1-0b / D9 另包确认原生来源 |

既有日志不会被回写，也不向固定 DSH 追加私有事件类型：生命周期来自原生 step 标记，成果来自工具结果，所以旧日志同样可投影。固定 DSH 的持久事件目录不支持注册外部类型；读取必须保持原生恢复兼容。原有成果与控制信息仍可通过根任务快照补充到原对话。DSH 自带工具界面按 callId 关联调用与结果、用可折叠原始详情展示；本实现复用这一呈现方式，独立 Web 界面保持自身组件和样式。

### 4.2 分组、分页与各端呈现

连续相邻步骤在同一 taskId 下合成执行块，开始 / 完成只计同一 stepId 一次；artifact.created.completedStep 同样合并到该步，成果卡仍形成分组边界。迟到完成事件更新原行，不另建一行、不重排开始顺序；完成先到时先显示可读完成描述，随后上翻补齐开始。审批、提问、成果、用户 / 助手消息和任务切换形成边界；不同任务绝不合并。分页按原始时间线条目计数，不因折叠改变游标。

桌面运行块默认展开，手机默认收起。完成或该任务结束后自动收为「执行了 N 步 · 用时 X」；可以再次展开。步骤详情再次点开才请求原始参数 / 输出，并提供复制。审批 / 提问卡使用原有账号、来源、回执检查和操作接口，已处理记录保留在原位置；不新增「总是允许此类」权限。

成果通过桌面右侧面板 / 手机全屏页打开，关闭回到原对话，可下载 / 保存。来源、成果及原有任务停止控制位于对话内；独立任务页、任务详情弹窗和侧栏入口已删除，运行会话显示状态点。输入区停止保持既有语义；排队和插话不属于本包。

## 5. 客户端差异（Apple逐项对照）

以下结论来自当前 `PersonalClient.swift` 和相关Codable/intent模型与上述服务端路径/字段对照；不修改Swift。表中的「一致」只确认静态请求/响应契约，不代表真机/部署连通性已验收。

### 5.1 已调用接口的逐项核对

| Apple调用的方法与路径（前缀同上） | 路径/字段/错误处理结论 |
|---|---|
| POST `/auth/register`；POST `/auth/login` | 请求 `username,password,deviceName,displayName?` 与服务端一致；读取Cookie/CSRF再用status核对owner/host |
| GET `/auth/me`；GET `/status` | `account.ownerId,device.id,csrfToken` 与 `ownerId,hostId` 一致；身份不匹配或401清凭据，5xx/超时保留离线身份便于恢复 |
| POST `/auth/logout`；GET `/auth/devices` | `{}`注销体、Cookie/Origin/CSRF一致；设备createdAt/lastSeenAt等可选字段兼容。注销先清本地身份，服务端失败仍报告未确认 |
| GET `/sessions`；GET `/models` | 会话 `running,sendAvailable,unavailable?,conversationId?,modelProfileId?` 与模型 `id,name,model,configured,routeFingerprint` 一致；Apple限制会话≤20,000、模型≤500 |
| GET `/sessions/{id}/events` | 路径/afterSeq/nextSeq一致；Apple单页limit≤100（服务端≤200）。旧打开会话从-1累计读到无hasMore，累计>20,000报客户端historyLimit；缺尾页/beforeSeq。消息转换仅保留user/assistant；共享类型丢弃 `endReasonKind`，工具/新时间线data未建模 |
| GET `/commands` | before/limit/nextBefore一致；服务端按账号列全部命令，Apple读一页后过滤选中会话根任务，不是服务端按session过滤；可能需继续翻页才找到当前会话任务 |
| GET `/commands/by-request/{id}`；POST `/commands` | 404且code为NOT_FOUND才认定未登记；持久requestId与原体核对一致。create/message/cancel字段一致，但message长度、附件/steer范围有差异（见下） |
| GET `/tasks/{id}`；POST `/tasks/{id}/stop` | GET裸Task、POST202的task外壳、requestId一致；停止先查canStop，仅把匹配202当登记证据，后续Task状态不伪称该请求已确认。尚未接入补充/续做与executionSteps详情 |
| GET `/tasks/{id}/sources/{snapshotId}` | 项目/网页来源字段与文本响应一致；区分项目原文件hash与网页文本hash |
| GET `/sessions/{id}/approvals`；POST `/sessions/{id}/approvals/{approvalId}` | before/limit/approvalId、两种outcome与requestId一致；POST200为answered回执，不能覆盖后续resolved列表事实 |
| GET `/sessions/{id}/questions`；POST `/sessions/{id}/questions/{questionRpcId}` | questions数组、answer.answers中的id/selected/custom、多选与plan-review字段一致；以answerAcceptedAt区分登记与消费；当前无同名时间线事件 |
| GET `/artifacts/{id}`；GET `/artifacts/{id}/preview`；GET `/artifacts/{id}/download` | 元数据、preview.text、download字节一致；Apple核对task绑定、size/sha256与UTF-8，符合当前≤128KiB文本成果范围；不可据此认为支持未来任意二进制成果 |
| GET `/memory/status`；GET `/memory/items`；GET `/memory/items/{kind}/{id}`；GET `/memory/items/{kind}/{id}/sources` | kind/query/after游标、owner/worldRevision与availableActions一致；详情/来源可由Apple额外传本地expectedWorldRevision校验，未将其臆造为HTTP查询字段 |
| POST `/memory/items/{kind}/{id}/correct`；POST `…/mute`；DELETE `/memory/items/{kind}/{id}`；DELETE `/memory/evidence/{id}` | requestId/expectedWorldRevision/text一致；允许读取409 receipt并区分error外壳；同requestID原体重放。纠正体字节上限不一致（见下） |
| GET `/memory/commands/by-request/{id}`；POST `…/retry-cleanup` | receipt/空体与清理状态一致；先查原删除回执再重试底层清理，NOT_FOUND/脱敏重放分别处理 |
| GET `/sync/events`；POST `/sync/events` | GET默认从0每页100，sourceDeviceId/eventId/seq一致；POST仅验收SPI提交隔离测试记录，四类kind与字段在此验收范围一致，不是Apple日常离线发消息接口 |
| POST `/sync/capabilities` | platform+sharedConversations一致，只声明共享，不声明accountModelTransfer；严格校验三个响应键，未来增加字段需评估兼容 |
| GET `/sync/conversations/{id}/shared`；POST `/sync/conversations/{id}/shared` | GET binding/切换水位与POST独立requestId/modelProfileId/expectedSyncSeq一致，POST202读取command+共享投影；没有表达acknowledgeUncertainLocalTurn的字段（见下） |

Apple通用网络错误保留HTTP status与大写 `error.code`，无合法code回退 `HTTP_<status>`，响应>1 MiB或3xx会拒绝；读取通常接受全部2xx，不自动轮询到任务完成。记忆变更显式接受409并解析回执；其他领域409作为APIFailure返回上层。这些处理符合现有接口；不是所有409都应转成重新登录，也不能因5xx换新requestId重发。

### 5.2 明确不一致与后续缺口

差异列保留 M0-5 核对时的现象；「已在 A2 修复」标注当前 Apple 客户端结果。服务端接口未变。

| 分类 | 差异 / 可观察后果 | 对应工作 |
|---|---|---|
| 请求上限不一致 | Apple消息校验允许≤16,384 UTF-16，服务端只允许≤8,192；超出服务端上限会400 INVALID_REQUEST。Apple命令总bytes允许262,144，服务端通常12KiB；即使字符数合法，高字节文字/JSON转义也可能413 BODY_TOO_LARGE | 已在 A2 修复：消息 ≤8,192 UTF-16；原发送 JSON ≤12 KiB，上传前校验并在输入处提示，保留草稿 |
| 请求上限不一致 | Apple纠正文本≤4,000 UTF-16一致，但intent允许纠正JSON体16KiB，服务端读取≤12KiB；长多字节/转义文本可能413 | 已在 A2 修复：纠正 JSON ≤12 KiB；输入处提示，保留原 requestId/请求体重放 |
| 名称计数不一致 | Apple认证时deviceName用Swift字符串count≤128（扩展字素），服务端按UTF-16长度≤128；含emoji/组合字符的长名称可通过Apple本地检查后400 INVALID_REQUEST | 已在 A2 修复：deviceName 按 UTF-16 ≤128 校验，超限不发送认证请求 |
| 接管字段缺口 | 服务端允许 `acknowledgeUncertainLocalTurn:true`；Apple接管intent没有该字段，并要求canAdopt。已有uncertain本地turn无法在Apple确认后接管，返回/显示LOCAL_TURN_UNCONFIRMED | 已在 A2 修复：仅用户明确点击「确认并继续」后发送该字段；普通接管省略，确认写入原 intent 供重放 |
| 任务适用范围 | Apple可给任何列出的会话查询根任务，但服务端/tasks只接受personal-remote；接管后shared-chat的任务详情/停止会404 NOT_FOUND。应按实际可用范围呈现，不能推定所有可发送会话都有任务控制 | 已在 A2 修复：结合账号桌面能力与实时会话可发送状态确认 personal-remote；shared-chat 隐藏任务详情/停止，不请求 /tasks；范围不明时隐藏 |
| 历史与时间线 | Apple从头全量读历史，未实现M0-3尾页/上滑更早；只转文字消息。共享HistoryData忽略endReasonKind及新工具/审批/成果data，即使未来服务端添加字段也不会自动渲染 | A1、M1-0d（待M0-3/M1-0a确认） |
| 附件 | Apple能解码原件元数据并计数，但没有上述四个附件PUT/GET；SharedCommandPayload无attachments、originalAttachments、attachmentMessageId，无法从该client上传/发送/下载附件或仅发附件 | 已在 A2 修复：四个 PUT/GET 与显示版、附件引用/仅附件发送、历史原件及旧图片下载接入；Mac/iPhone「+」、缩略图、侧栏/全屏 Quick Look、保存/分享；原件大小/hash 校验 |
| 任务输入 | Apple message mode固定queue，无steer；无supplements/resume；Task读取未呈现executionSteps/background job全部字段。不能把现有session.cancel当可取消排队卡片 | M1-0b/M1-0d/M1-4 |
| 账号/设备 | 无auth/state/setup/profile/change-password、设备PATCH/DELETE；登录/注册/列设备已有能力 | Apple账号设置接入（setup仍是宿主专属流程） |
| 模型 | 有GET models与create选择modelProfileId；无verify、模型代理chat/completions、account/models九项管理/转移接口。未声明密钥转移，符合当前权限范围 | Apple模型设置/手机独立对话后续包 |
| 项目/浏览器 | 无projects/workspaces/browser六项独立请求；已有会话可列/读/发送，但无法在此client登记项目、撤销或创建对应会话 | Apple工作区接入 |
| 日常同步/本地turn | GET sync/events与共享接管已有；日常POST sync/events只有验收SPI，local-turns创建/查/续租/finish四项未接入 | M3离线对话与跨端合并 |
| 分发更新 | 无认证app/native/downloads六项请求；Apple公开更新另有PublicUpdates，不能宣称缺所有更新能力 | 当前保持已有公开分发；本契约只记录认证入口 |
| 五端共同待实现 | 「总是允许此类」、步骤原始详情与十种时间线投影已正式；排队取消、消息chunk流待实现；运行中插话/排队默认行为已按 D9 确定，调度另包实现 | Windows M1-0a/b、Mac审阅与M1-0d |

本包未覆盖：内部 `/weftmate/api/v1` 网关、Electron IPC/Android全部bridge、公开官网分发、DSH原始完整事件schema、真实Windows宿主及Apple真机端到端场景。上述接口清单和使用标记来自本地源码对照，独立部署可能落后于此基线；M0-3/M1-0a已更新此文档与STATE契约栏。

## 6. 健康摘要（H2 正式接口）

> **H2 已实现服务端接收、读取、删除与 observed 待写队列。** 遵循 `COMPANION.md` 第 4、5、11 节；原始样本只在设备内计算，不上传原始流。当前 MemoWeft RPC 缺少 observed 写入契约，健康证据尚未进入 World；接口返回 queued 明确说明此状态。补充能力与模型限制见 6.4 及 `src/personal-health/README.md`。

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

基线为当前日期**之前 14 个本地日历日**内有数据日期的均值，排除当日及缺数据日，`baselineDays` 表示实际天数（首次回填的较早日期可能不足 14 天）。偏离为 `(value / baselineMean - 1) * 100`；无基线或均值为 0 时省略 `baselineMean/deviationPercent` 中无法计算的字段。没有医疗诊断或分数。`sourceDevices` 是去重的 HealthKit 来源应用/设备描述，统计来源未提供硬件名时使用来源应用名；不是原始样本 ID、设备序列号或样本时间线。

`cloudModelAllowed` 必传，默认 false；首次请求健康授权前询问，设置可随时改。true 只允许云端使用摘要，不扩大原始数据权限；false 要从云端召回、提示词与后续云端模型请求中排除这些摘要，仍可供本地模型使用。已上传的摘要在使用选择改变时重新上传替换；服务端应把最新明确选择用于账号已有健康证据，并确保旧索引/衍生记忆不绕过该选择。用户离线改为 false 后，本地即采用新选择，服务器只能在联网提交成功后生效。`selfAssessmentFrequency` 为 `off / low / moderate`，省略时为 low；服务端按账号最新汇总时间将选择与频率应用到全部摘要/待写证据（相同时间 false 优先），旧回填和幂等重试不能覆盖更新的选择。本包只保存频率，不上传自评答案、不实现询问界面。

`readStates` 为 `disabled / notRequested / dataAvailable / noDataOrReadDenied / unavailable / failed`。Apple 不公开读取授权是否被拒绝/撤销，空结果不能据此断言拒绝；`dataAvailable` 只代表此次读到数据。应用内逐类关闭会停止该类查询、移除本地与排队摘要的指标并重新上传替换。系统撤权后再次读取为空，会更新近期摘要，既有摘要不会因此自动等同用户要求全部删除；删除需明确操作。查询失败保留此前已读取数值并标注 failed。

POST 固定返回 200：`{"summary":{…当前持久化版本…},"duplicate":false,"memory":{"state":"queued","pendingObservedCount":1,"reasonCode":"MEMORY_OBSERVED_UNSUPPORTED"}}`。200 表示摘要与 observed 队列已原子持久化，尚未表示 World 写入完成。请求只接受上述字段；各指标要求对应 readState 为 dataAvailable/failed、单位匹配、非负有限数值与 0–14 baselineDays；拒绝原始样本和任意追加文本。`metrics.workouts`（如提供）单位 min，`metrics.respiratoryRate` 单位 breaths/min。账号由凭据确定，来源设备必须是本账号签发过的 ID，已撤销设备仍可标记其历史离线摘要。较新汇总完整覆盖同来源/日期记录。

### 6.2 撤权与删除

| 方法与路径 | 请求 / 返回 | 客户端行为 |
|---|---|---|
| DELETE `/personal/v1/health/daily-summaries/{date}` | `{}`；删除账号该日期的所有来源摘要及其 observed 待写证据；200 `{"deleted":true,"date":"2026-10-06"}` （另含 deletedCount） | 幂等，无记录也成功；Core 有按日期调用方法，H1 设置页只提供全部删除 |
| DELETE `/personal/v1/health/daily-summaries` | `{}`；删除账号全部健康摘要及 observed 待写证据；200 `{"deleted":true,"scope":"all"}` （另含 deletedCount） | 设置中明确点击后删除本地摘要、清空上传队列并关闭所有读取类别；先持久化删除待办，成功前保留重试；用户重新开启读取时先完成删除，再上传新摘要 |

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

H1 在进入前台、打开健康设置、手动更新及前台每 15 分钟重读最近 15 天，处理迟到 Watch 同步；不承诺后台定时唤醒。每次先落本地摘要，再尝试队列；404/501 结束本轮，无忙循环。不使用真实宿主进行本包验证。H2 使用隔离账号与合成 RPC 验证；真实宿主/跨设备及 MemoWeft observed 写入、权限变更、衍生项删除仍需在 Core 能力补齐后集成验收。


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

示例摘要为简化投影；真实 summaries 返回完整已存摘要。memory.pendingObservedCount 是本账号全部待写数量，与查询日期窗口无关；没有摘要时 memory.state=empty、pendingObservedCount=0。健康文件在宿主 `<personal-access-root>/accounts/<ownerId>/health/daily-summaries.json`，沿用私有目录/文件保护与原子写入。

每条日摘要生成 source_kind=observed 的中文事实，稳定来源为账号/设备/日期，含设备描述、时区与汇总时间；不会构造 user 对话 boundary。当前已有 `personal-memory` 桥接缺少 observed 写入能力，故先保存可回放的待写证据，覆盖和删除同步替换/移除队列内容。MemoWeft 需补 observed upsert、来源权限更新/真实撤回（含衍生项/索引）、按目标模型过滤的召回契约与回执，然后经现有桥接回放；不得直接另写数据库或把 observed 伪装为发言。

H2 当前未将健康 observed 证据写入 World，故不依据“存在摘要”限制个人记忆召回：`cloudModelAllowed=false` 的账号在云端模型下仍照常召回非健康 World/interactions。待写健康事实不会被发给召回 RPC，本地模型也尚不能通过 World 召回这些事实；GET 可供客户端与后续精灵使用。**MW-2 将 observed 写入 World 时，须按来源排除云端无权限的健康证据及其衍生项，保留其余记忆召回**，并让选择更新/DELETE 覆盖索引与衍生项；过滤仅适用于确有已写入的健康证据。模型位置按 3.10 的实际地址与用户 `modelTier` 覆盖判断，RPC initialize 使用最终 local/cloud。已有用户/助手历史仍按原契约管理。
