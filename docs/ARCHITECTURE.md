# 架构与正式契约索引（当前有效）

接口字段、调用和事件只以下列实现/协议为依据；本文件不复制 schema（数据结构），不从前端效果、旧 TypeScript 或历史图谱猜测字段。

| 范围 | 正式依据 |
| --- | --- |
| 个人宿主有窗口/无窗口模式（隔离候选） | [main.mjs](../src/main.mjs)、[host-mode.mjs](../src/host-mode.mjs)；同一宿主的生命周期、隔离目录验证、启动/停止状态与会话引用扫描降级 |
| 个人宿主隔离启动与按账户记忆配置 | [run-personal-host.mjs](../scripts/run-personal-host.mjs)、[personal-memory/config.mjs](../src/personal-memory/config.mjs)；仅显式的`--personal-memory-config`启用按账户记忆，旧`--memoweft-config`在个人宿主仍被拒绝 |
| 账户与设备身份、受控接入及持久请求 | [personal-access/index.mjs](../src/personal-access/index.mjs)；v3按账户保存设备/会话/命令，鉴权后携带不可变owner上下文、账户内请求去重及容量/存储故障边界；正式运行状态见CURRENT_STATE |
| 账户云模型配置、不可变修订与两端副本 | [模型账本与投影](../src/personal-account-models/index.mjs)、[账户接口/操作](../src/personal-access/index.mjs)、[正式路线管理](../src/main.mjs)、[宿主回调](../src/personal-access-backend.mjs)、[原生发布/另存](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/AccountModels.kt)、[原生密钥库](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/SecureSettings.kt)；稳定账户模型身份、独立运行时修订、操作去重/未知核对、当前目录与旧绑定分别核归属；普通目录无密钥，账户本人显式取回由实际App原生保存，本机同地址凭据冲突需明确选择；接口/原生兼容与可信进程边界见任务13 |
| 个人宿主会话选模与模型维护空闲检查 | [唯一ApiProxy薄服务](../src/plugins/weftmate-personal-api-proxy.mjs)、[只读收件队列插件](../src/plugins/weftmate-personal-model-idle.mjs)、[受管组合/IPC](../src/dsh-web-runtime.ts)、[宿主模型事务](../src/main.mjs)、[空默认规范化](../src/stage2-config.ts)；个人组合复用公开工厂且不写全局默认，维护同时核原生队列/活动回合/待派发，查询不明先等待；当前固定依赖不改，正式实例与两层默认验证见任务13 |
| 个人项目登记、共享会话绑定与来源快照 | [personal-access/index.mjs](../src/personal-access/index.mjs)；原电脑账户网页登录登记只读目录，手机列/选已登记项目；项目及登记修订绑定新共享会话，根任务与补充冻结同一绑定，模型只给不透明文件身份；来源按账户/项目/根任务/回合/确切消息回执关联 |
| Windows 项目资料读取 | [personal-projects/index.mjs](../src/personal-projects/index.mjs)、[reader.ps1](../src/personal-projects/reader.ps1)；固定读取器使用Windows（视窗系统）文件句柄核根身份、路径与文件版本，保持只读并拒绝链接或变化；UTF-8（统一字符编码）Markdown/纯文本分行有界读取，不修改用户目录权限 |
| 项目摘要来源证明与安卓入口 | [个人工具](../src/plugins/weftmate-personal-desktop.mjs)、[父子桥](../src/dsh-web-runtime.ts)、[宿主回调](../src/personal-access-backend.mjs)、[安卓有限桥](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/HybridActivity.kt)；成功读取须在物理持久DSH历史中早于同回合保存调用，宿主生成来源清单；手机项目列表、按原请求创建会话及完整有界来源正文分别有有限动作 |
| 公共网页阅读、已观察链接与来源摘要 | [浏览器读取器](../src/personal-browser/index.mjs)、[网络连接](../src/personal-browser/network.mjs)、[账户任务与快照](../src/personal-access/index.mjs)、[个人工具](../src/plugins/weftmate-personal-desktop.mjs)；独立临时浏览会话取得渲染后的可见正文，初始网址由用户目标冻结，继续导航使用同任务确切回执的已观察链接身份；网页快照与原生持久工具证明关联，摘要附实际地址/时间/正文哈希，双端沿既有任务来源与成果接口呈现 |
| 冻结网页捕获、按需段与引用覆盖 | [读取器及UTF-8分段](../src/personal-browser/index.mjs)、[私有捕获与来源账本](../src/personal-access/index.mjs)、[实际工具证明](../src/plugins/weftmate-personal-desktop.mjs)、[当前子进程桥](../src/dsh-web-runtime.ts)；捕获最多256KiB、段最多8KiB/32段，两块隐藏成果存储绑定同账户/任务/回合/回执；后段从原版本取回且需实际持久工具结果，只有已读段能引用；旧来源保持无版本兼容，容量和实际验证边界见任务14 |
| 任务回复证据与保存后提示 | [原生记录投影](../src/personal-reply-evidence/index.mjs)、[只读插件及下一步提示](../src/plugins/weftmate-personal-reply-evidence.mjs)、[父子通信](../src/dsh-web-runtime.ts)、[账户任务投影](../src/personal-access/index.mjs)；只认确切回执落在开始/唯一匹配结束之间，迟到/冲突或重启缺活跃证据保持未知；文件核验独立，物理保存后只追加一次插件来源提示；不把网页渲染、保存文件或首个流式片段当作模型正常结束 |
| 隔离模型请求观测与低档试验 | [启用范围](../src/personal-model-observation/policy.mjs)、[白名单记录](../src/personal-model-observation/record.mjs)、[不透明代理](../src/personal-model-observation/proxy.mjs)、[语义观察](../src/personal-model-observation/semantic.mjs)、[公开SDK插件](../src/plugins/weftmate-personal-model-observer.mjs)、[宿主接线](../src/main.mjs)；显式测试开关及隔离profile才启用，网络与确切步骤之间不猜关联，不记录正文/头值/密钥；低档独立route经官方能力声明及实际header/wire验证，不修改旧共享route，正式采用尚未成立，见任务14第二轮 |
| 账户密码、注册、资料、设备登录与存储迁移 | [personal-access/index.mjs](../src/personal-access/index.mjs)、[password.mjs](../src/personal-access/password.mjs)；异步 scrypt（密码派生算法）、限速、会话撤销、改密保留当前设备并拒绝旧待派发命令；来源/CSRF（跨站请求伪造防护）与可信代理检查；v2→v3须保留已知原账户，公开注册建立独立新账户 |
| 电脑网页对话、事情、账户与记忆页面 | [personal-access-ui/index.mjs](../src/personal-access-ui/index.mjs)、[app.js](../src/personal-access-ui/app.js)；固定静态路径、同源表单、按requestId恢复、非终态动作锁、历史游标/视图代数；记忆详情、来源、纠正、停用与删除回执按当前登录账户呈现；资料按版本保存，头像解码与资料响应按账户/设备/视图代次核对 |
| 手机来源事件与账户内同步 | [personal-sync/index.mjs](../src/personal-sync/index.mjs)、[接入与鉴权](../src/personal-access/index.mjs)；持久事件身份、账户/设备来源、同内容重试去重、不同内容冲突、有界分页、写入前重新鉴权；只同步记录，不重新派发动作 |
| 原手机对话采用与电脑历史接续 | [账户绑定/占用与接口](../src/personal-access/index.mjs)、[历史上下文](../src/personal-conversations/context.mjs)、[模型扩展点](../src/plugins/weftmate-personal-conversation-context.mjs)、[父子桥](../src/dsh-web-runtime.ts)、[原生交接](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/ConversationHandoff.kt)、[缓存](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/LocalStore.kt)；原产品对话身份一对一关联电脑会话，已确认同步段与真实DSH后段按身份合并；原生11能力协商、联网手机回合占用、采用与发送仲裁、确切回执上下文及有界离线历史缓存；原请求恢复和模型/设备实际状态见任务12 |
| 跨端原模型身份与预选 | [手机终态事件](../src/personal-sync/index.mjs)、[账户模型/原对话投影](../src/personal-access/index.mjs)、[电脑实际路线指纹](../src/model-route-fingerprint.mjs)、[原生实际路线指纹](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/ModelRouteFingerprint.kt)；新终态可选非秘密模型身份，同设备按其事件序号、多设备一致性及采用截点判断；仅确切唯一现有配置可预选，旧记录/缺配置/冲突保持未知，不传密钥或原地址；私有配置同步待后续接通 |
| 手机图片跨端引用与读取 | [二进制存储](../src/personal-sync/attachments.mjs)、[事件契约](../src/personal-sync/index.mjs)、[个人接入路由](../src/personal-access/index.mjs)、[安卓本机账本](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/LocalStore.kt)、[附件副本](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/AttachmentStore.kt)；原图按账户/会话/消息独立上传，事件只保存引用；电脑与安卓按账户和消息关联读取，新旧历史边界及验收见任务07 |
| 电脑DSH会话图片与双端预览 | [共享暂存](../src/personal-access/shared-attachments.mjs)、[命令/读取路由](../src/personal-access/index.mjs)、[宿主回调](../src/personal-access-backend.mjs)、[Gateway](../src/runtime/gateway/routes/v1.mjs)、[DSH适配器](../src/runtime/dsh-adapter/sessions.mjs)、[安卓共享出站](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/SharedChat.kt)；草稿UUID与DSH持久`sha256:`身份分开，按同一requestId受理/核对，正式会话历史投影图片引用与受控原图读取；模型是否实际回答另验 |
| 安卓本机记录、模型与设备动作 | [LocalStore.kt](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/LocalStore.kt)、[ModelClient.kt](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/ModelClient.kt)、[DeviceTools.kt](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/DeviceTools.kt)；本机先落库、明确关联账户、可取消模型循环、工具派发与观察结果分别记录 |
| 安卓凭据、连接与后台同步 | [SecureSettings.kt](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/SecureSettings.kt)、[Network.kt](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/Network.kt)、[SyncJobService.kt](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/SyncJobService.kt)、[SyncJobLease.kt](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/SyncJobLease.kt)；系统密钥库、正常HTTPS证书检查、账户来源隔离和记录补传；后台Job（系统任务）的调度代次与账户/设备/凭据共同守卫，停止时断开网络，旧回执不取消新任务；调试回环例外不扩展到任意明文地址 |
| 安卓原生Weave界面与可用能力 | [MainActivity.kt](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/MainActivity.kt)、[WeaveViews.kt](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/WeaveViews.kt)；会话/只读历史分离、异步视图代次、账户与模型设置；功能状态来自实际配置，完整产品路线见PROJECT_DIRECTION |
| 安卓可更新界面与原生连接层 | [HybridActivity.kt](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/HybridActivity.kt)、[app.js](../apps/mobile-ui/www/app.js)、[styles.css](../apps/mobile-ui/www/styles.css)；原生账户/记录/模型能力与共用页面分工、按账户交付异步结果；现行发布版本与真机待验层次见CURRENT_STATE及任务07 |
| 界面版本、资产、更新事件与回退 | [mobile-ui-release.mjs](../src/personal-access/mobile-ui-release.mjs)、[build-mobile-ui.mjs](../scripts/build-mobile-ui.mjs)、[MobileUiBundles.kt](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/MobileUiBundles.kt)；既有账户鉴权、固定资产哈希与兼容声明、完整下载后切换、草稿/生成中暂缓、上一版本/内置页恢复；新增原生能力仍需APK |
| 安卓账户通知 | [MobileNotifications.kt](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/MobileNotifications.kt)、[HybridActivity.kt](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/HybridActivity.kt)；当前账户收件箱、系统通知和回到原会话的归属；退出/切换时撤掉旧账户可见通知 |
| 受保护的安卓候选下载 | [personal-access/index.mjs](../src/personal-access/index.mjs)、[宿主启动器](../scripts/run-personal-host.mjs)；仅显式配置的固定APK文件、既有账户鉴权、固定下载路由和禁止缓存；文件不存在时不宣传为可下载 |
| 受限远端预设与模型桌面工具 | [personal-desktop插件](../src/plugins/weftmate-personal-desktop.mjs)、[专用预设限制](../src/plugins/weftmate-personal-desktop-preset.mjs)、[DSH宿主接线](../src/dsh-web-runtime.ts)；正式工具范围限制、确切子进程IPC、turn/call/原消息来源与设备授权校验 |
| 记事本动作与窗口核验 | [personal-desktop-task.mjs](../src/personal-desktop-task.mjs)、[命令账本](../src/personal-access/index.mjs)；固定应用路径、持久受理/去重、可见窗口证据与结果不明不重放 |
| 受控文档成果与跨端任务详情 | [personal-artifacts/index.mjs](../src/personal-artifacts/index.mjs)、[个人接入路由](../src/personal-access/index.mjs)、[电脑工具](../src/plugins/weftmate-personal-desktop.mjs)、[安卓网络层](../apps/android/app/src/main/java/com/memoweft/weftmate/mobile/Network.kt)；仅原owner受限会话的可信工具来源写入账户/任务隔离的`.md/.txt`成果，写后读回并核哈希，详情/预览/下载重新鉴权；现行候选与任务控制边界见[任务08](tasks/UNIFIED_ASSISTANT_08.md) |
| 同一任务的补充、准确停止、恢复与执行步骤 | [个人任务账本/路由](../src/personal-access/index.mjs)、[同进程停止插件](../src/plugins/weftmate-personal-task-control.mjs)、[宿主IPC](../src/dsh-web-runtime.ts)、[历史身份投影](../src/runtime/dsh-adapter/sessions.mjs)、[手机界面](../apps/mobile-ui/www/app.js)、[电脑界面](../src/personal-access-ui/app.js)；冻结根任务命令/receiptId，同进程核source.rpcId和当前回合后取消，精确队列删除及持久终态分别证明；恢复须已核对前态/副作用并明确下一步，旧/混合身份保留未知，验证见[任务09](tasks/UNIFIED_ASSISTANT_09.md) |
| 个人宿主独立监督入口 | [run-personal-host-task.ps1](../scripts/run-personal-host-task.ps1)、[原启动器](../scripts/run-personal-host.mjs)；当前Windows登录用户的计划任务以前台进程监督宿主，异常退出按退避重启，隔离故障恢复已验；停计划任务后子进程清理仍需按profile核实，正式运行状态见CURRENT_STATE |
| 本机模型目录与正式DSH路由 | [local-model-config.mjs](../src/local-model-config.mjs)、[main.mjs](../src/main.mjs)、[dsh-settings-migration.ts](../src/dsh-settings-migration.ts)；只从本机正式Config取模型限制，仅查目录的配置、系统加密凭据、官方user layer及持久归属标记、版本校验的窄修复；已核实的Occamy路由通过官方设置修订接口幂等补图片输入，不按显示名扩给其他模型 |
| 个人接入的宿主模型归属与管理接线 | [personal-access-backend.mjs](../src/personal-access-backend.mjs)、[main.mjs](../src/main.mjs)、[启动器](../scripts/run-personal-host.mjs)；网络命令复用宿主归属判断，本机管理仅走父子进程 IPC（进程间通信） |
| 按账户记忆的身份、目的地与服务接口 | [personal-memory/index.mjs](../src/personal-memory/index.mjs)、[boundary.mjs](../src/personal-memory/boundary.mjs)、[policy.mjs](../src/personal-memory/policy.mjs)、[http.mjs](../src/personal-memory/http.mjs)、[journal.mjs](../src/personal-memory/journal.mjs)、[main.mjs](../src/main.mjs)；已鉴权的ownerId决定独立数据根、Core进程及写入/查询上下文；会话归属与正式本地模型目的地分别核对；网页接口提供列表、详情、来源、纠正、停用、真删除、回执与显式清理重试 |
| DSH 按账户记忆注入与回合来源 | [weftmate-personal-memory.mjs](../src/plugins/weftmate-personal-memory.mjs)、[dsh-web-runtime.ts](../src/dsh-web-runtime.ts)；首步从已领取的用户消息读取请求，经宿主 IPC 取得账户召回，失败清除旧快照；完成回合的原生来源交给该账户Core，云端或归属不明的目的地不注入 |
| 持久历史投影与续接 | [sessions.mjs](../src/runtime/dsh-adapter/sessions.mjs)、[内部历史路由](../src/runtime/gateway/routes/v1.mjs)；原生 beforeSeq 回溯、扫描水位、受限投影与显式截断；图片只投影持久引用，二进制需按原会话鉴权读取 |
| Windows 私有数据与令牌文件 | [private-host-storage.mjs](../src/private-host-storage.mjs)；先保护目录，核实实际 ACL（访问控制列表），拒绝链接逃逸，权限设置失败拒绝继续 |
| Mod 项目/SDK 参数、同源路由、能力状态 | [weftmate-mod-projects.mjs](../src/plugins/weftmate-mod-projects.mjs)；当前检查参数为明确数组及类型联合，具体字段以该正式定义为准 |
| 项目清单/来源校验、生命周期、持久项目 | [validate.mjs](../src/runtime/mod-projects/validate.mjs)、[index.mjs](../src/runtime/mod-projects/index.mjs)、[store.mjs](../src/runtime/mod-projects/store.mjs) |
| 开发预设与工具约束 | [weftmate-mod-development.mjs](../src/plugins/weftmate-mod-development.mjs) |
| Mod 独立窗口与最小安全桥（候选，待真实运行验证） | [mod-window-manager.mjs](../src/mod-window-manager.mjs)、[mod-window-preload.cjs](../src/mod-window-preload.cjs)、[托管页资源](../src/plugins/weftmate-client/mod-window/assets.mjs)；九态单一派生源 [mod-state.mjs](../src/plugins/weftmate-client/mod-state.mjs) |
| 官方对话载体探针（未选为生产载体） | [dsh-view-carrier.mjs](../src/dsh-view-carrier.mjs)、[dsh-carrier-preload.cjs](../src/dsh-carrier-preload.cjs)；只用固定 DSH 正式 sessions/theme 服务，未复制聊天运行基础 |
| MemoWeft 旧全局宿主协议/路由 | [weftmate-memory.mjs](../src/plugins/weftmate-memory.mjs)；个人宿主不启用此无账户通道 |
| MemoWeft Core RPC v2 | [protocol_v2.py](D:/AIProjects/MemoWeft/Core/py/src/memoweft/integrations/dsh_bridge/protocol_v2.py)、[query_service.py](D:/AIProjects/MemoWeft/Core/py/src/memoweft/integrations/trust/query_service.py)、[command_service.py](D:/AIProjects/MemoWeft/Core/py/src/memoweft/integrations/trust/command_service.py) |
| MemoWeft 真删除与来源失效 | [true_delete.py](D:/AIProjects/MemoWeft/Core/py/src/memoweft/integrations/trust/true_delete.py)、[command_service.py](D:/AIProjects/MemoWeft/Core/py/src/memoweft/integrations/trust/command_service.py)；删除当前证据/理解正文及相关索引、派生内容，保留无正文来源标记防旧来源重放；共享或来源不明时原子拒绝，底层清理未完成有显式重试回执 |
| MemoWeft 模型记忆与历史查看边界 | [正式理解召回匹配](D:/AIProjects/MemoWeft/Core/py/src/memoweft/integrations/hermes/recall.py)、[依赖校验](D:/AIProjects/MemoWeft/Core/py/src/memoweft/model_context_dependencies.py)、[交互投影](D:/AIProjects/MemoWeft/Core/py/src/memoweft/integrations/dsh_bridge/interactions.py)、[来源查询与权限](D:/AIProjects/MemoWeft/Core/py/src/memoweft/integrations/trust/query_service.py)、[精确依赖补链](D:/AIProjects/MemoWeft/Core/py/src/memoweft/store/interaction_context.py) |
| MemoWeft 备份的规范化、校验与恢复 | [portable/model.py](D:/AIProjects/MemoWeft/Core/py/src/memoweft/portable/model.py)、[portable/validate.py](D:/AIProjects/MemoWeft/Core/py/src/memoweft/portable/validate.py)、[portable/importer.py](D:/AIProjects/MemoWeft/Core/py/src/memoweft/portable/importer.py) |

2026-09-26：第二段的独立 `/personal/v1` 接入已在本机隔离验证，公网配置未应用。发送回调经过宿主模型归属判断；内部 [Gateway 消息路径](../src/runtime/gateway/routes/v1.mjs) 仍只供本机使用。请求记录先持久写入，DSH 受理与最终结果分别记录，回执不明不自动重放。历史补读使用原生分页和持久序号，不能以尾页冒充全部历史。详情和未验证边界见 [UNIFIED_ASSISTANT_02](tasks/UNIFIED_ASSISTANT_02.md)。第一段无窗口/降级启动结果保留在 [UNIFIED_ASSISTANT_01](tasks/UNIFIED_ASSISTANT_01.md)。

2026-09-23：记忆交互与来源查询已按 model/history projection（模型输入与历史查看投影）划分；该语义用于当前性、依赖失效和权限控制，不是旧星球图谱或向量相似度接口。模型消费者必须显式选择模型投影，历史管理界面保留原话及来源状态。云模型读取仍须另行定义目的地权限，不能直接复用当前本地模型通道。

Mod SDK 的 settings/contributes 与 `ui.shared` 仍不是已交付能力；图谱、embedding（向量嵌入）和 similarity（相似度）也不能凭本轮投影命名视为已实现。实际验证状态详见 `CURRENT_STATE`。更新接口须先读正式文件和 `collab/BACKEND.md`，由既有负责人在唯一协作通道协调。

2026-09-26 账户补充：`/personal/v1/ui` 与 `/personal/v1/auth/*` 的账户验证见 [UNIFIED_ASSISTANT_03](tasks/UNIFIED_ASSISTANT_03.md)。现main/启动器支持显式公开HTTPS来源与可信回环代理；用户处理系统拦截后，正式Caddy已将`/personal/v1/*`转发至回环18186，本机正式HTTPS检查通过，真实手机登录与按钮任务已核实，手机对话反馈与来源核对边界见 [UNIFIED_ASSISTANT_04](tasks/UNIFIED_ASSISTANT_04.md)。修改密码保留当前设备ID，轮换其会话并拒绝旧待派发命令；已开始派发的状态如实保留。

2026-09-26 任务补充：命令列表、按requestId找回、受限`personal-remote`会话、实际MiniPlus工具调用和Notepad窗口已完成本机真实验证，准确范围见 [UNIFIED_ASSISTANT_04](tasks/UNIFIED_ASSISTANT_04.md)。旧本机接管会话保持历史可读，远端发送须核实际受限预设；只读模型查询不依赖Gateway重启后丢失的内存记录。正式消息历史兼容固定rc.5的直接消息结构，不以旧嵌套测试形态代替。

2026-09-26 安卓与同步补充：原生客户端位于主仓`apps/android`，正式契约定位如上；电脑页面以明确的手机来源展示同步历史，目前为只读，不等同于跨端继续同一个DSH会话。个人受限预设已在正式回合生命周期增加重复工具收敛；历史投影跳过页面未使用的逐字增量但保留原生序号水位，追尾后显示持久终态。构建、真实MuMu运行、公网下载与未验层次分别见 [UNIFIED_ASSISTANT_05](tasks/UNIFIED_ASSISTANT_05.md) 和当前状态。

## 现用补充定位

2026-09-27 多账户与记忆边界：公开注册建立独立owner（账户归属标识），已配置v2原账户无损迁移；未知归属的旧资料不能由公开首注册认领。宿主模型只允许明确登记且当前配置仍一致的本机目录共享，新账户不继承宿主文件/桌面执行权或私人云模型配置。当前个人宿主已通过`--personal-memory-config`启用账户化MemoWeft：每个owner有独立数据目录、Core进程、作业与来源账本；认证、会话归属及本地模型目的地共同守卫召回和写入。云端模型目的地目前不注入这条本地记忆链路。`forget_evidence`仍是软删除；账户页面的删除走另立的真删除命令。当前Core数据库、索引和作业结果在成功真删后去正文，原始WeftMate聊天、Core交互归档及既存独立备份不在该操作的清理范围。合成双账户、HTTP（超文本传输协议）、真实Core和DSH模型的验证范围与用户待验边界见[任务06](tasks/UNIFIED_ASSISTANT_06.md)。

方向见 [PROJECT_DIRECTION.md](PROJECT_DIRECTION.md)，当前验证状态见 [CURRENT_STATE.md](CURRENT_STATE.md)。本文件保留既有源码注释与契约测试引用路径；旧章节编号和旧阶段描述已退役。

| 现有路径 | 定位 |
| --- | --- |
| src/main.mjs | Electron（桌面应用框架）主入口 |
| src/dsh-web-runtime.ts | DSH 网页运行集成 |
| src/plugins/weftmate-client/client.js | 现有客户端扩展 |
| src/plugins/weftmate-memory.mjs | 记忆宿主接入 |
| src/plugins/weftmate-aigame-host.mjs | 手机任务宿主接入 |
| src/runtime/ai-game/ | 手机接入组件 |
| scripts/vendor-dsh.mjs | 固定 DSH 生成依赖的构建入口 |
| tests/contract/dsh-pin.json | 固定依赖身份声明 |

WeftMod 与 MemoWeft 各在独立仓库；不将它们整包嵌入主仓库。权限、来源、凭据及任务状态边界按当前代码核实，不从旧文档推定已实现。本文只是定位资料，未证明功能闭环或设备可用。
