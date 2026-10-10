# UX-4 · 消息操作

本包在独立工作树实现，所有宿主为临时目录、合成账号和随机端口。未请求 8081，未读取或修改日用程序的数据；参考图片仅查看，没有复制到公开仓库。

## 验证结果

| 场景 | 结果与证据 |
|---|---|
| Windows（视窗系统）真实程序 | Playwright（自动化测试工具）`_electron.launch` 启动生产 `createPersonalDesktop`；复制、键盘菜单、反馈、引用、编辑、新版 / 原版切换、换模型重生成、导出预览均通过；浅 / 深色与 480×700 见 `desktop-*.png` |
| 手机网页 | 390×844，真实 Chromium（浏览器引擎）；同一组操作均通过，Markdown（标记文本）下载内容与 PNG（图片文件）文件头核对通过；见 `mobile-web-*.png` |
| 安卓界面包 | 390×844，真实界面包 + 合成原生桥；同一组操作均通过，保存文件请求通过；见 `android-ui-*.png`。手机本机记录的反馈 / 脱敏导出及「需由电脑接续」状态通过，见 `phone-local-*.png`。原生 Kotlin（安卓开发语言）编译、定向 JVM（Java 虚拟机）路由单测与 `com.memoweft.weftmate.mobile.ux4qa` 隔离 APK（安装包）code26 / 0.8.13 构建通过，未安装本人应用或启动模拟器 |
| 编辑与重新生成 | 真实 Electron（桌面程序框架）+ 固定 DSH（助手运行时）+ MiMo（小米模型服务）各一次；原生用户输入每个新版本只有一条、旧回复不进入新版本、原会话事件完全保留、回复版本左右切换通过；见 `mimo-light.png`、`mimo-dark.png`、`mimo.json` |
| 导出文件落盘 | 真实 Windows 程序调用生产“另存为”桥，测试仅将系统文件选择结果指向临时目录；Markdown 内容脱敏与 PNG 实际字节核对通过。手机网页同样核对两种文件。预览 / 文件都不含合成密钥与测试路径；工具步骤默认关闭、勾选后出现 |
| 相关单测 | `message-actions.test.ts` 13 项：锚点与回合边界、历史引导消息、创建顺序与已归档切换、运行 / 不确定状态 / 账号隔离、附件暂存释放后的复制与失败清理、构造种子队列、原文回执 / 哈希、完整长回复且不含隐藏推理、重启端口变化后的反馈持久化、主对话跨段来源、脱敏与本机反馈。连同会话菜单、经验、共用功能层和移动资产回归共 101 / 101 通过 |
| 类型与机械检查 | `npm run typecheck` 通过；impeccable（界面设计技能）机械检查返回 `[]`，未新增依赖或设计令牌 |

交互断言使用可见名称与角色，结果在 [interaction-checks.json](interaction-checks.json)。完整既有测试与审稿页工作流交本包 PR（拉取请求）的 CI（持续集成）。

## MiMo 用量

主干合并前成功验收 4 次请求：输入 6,477 token（模型文本单元）、缓存 1,792、输出 16，宿主记录费用 0.00475284 元。合并 IA-3 后开启真实主对话能力再验收 3 次请求：输入 6,322、缓存 4,800、输出 12，费用 0.001642 元；最新结果见 `mimo.json`。两次成功验收合计 **7 请求、12,799 输入 / 6,592 缓存 / 28 输出，0.00639484 元**。首次调试另有 3 次真实请求，只保留数量，未在临时目录清理前保存 token / 费用；不把已计量费用当作全部费用。已观测总请求数为 10。脚本现已在成功或失败退出前保存完整用量，记录见 [mimo-attempts.json](mimo-attempts.json)。凭据只通过进程环境引用，保管库仅存合成占位值，截图、日志与仓库均没有真实密钥。

## 主对话 / IA-3 接线

已合并 IA-3 与最新主干。真实程序验证主对话引用、编辑开旁聊重发、主对话回复开旁聊重新生成、主对话历史完全保留，见 `main-chat-checks.json` 和 `main-*.png`。

主对话不做完整历史分叉。自己的消息使用「从这里开旁聊并重发」；回复重新生成也创建带来源引用的旁聊。通过既有 `session.side.create` 创建后，再用原命令契约发送输入；跨段只读取锚点附近和找到前一条用户输入所需的前页。主对话原文保留，旁聊使用来源引用，不把整条长期对话复制过去。

消息操作的共用功能在 `src/ui-core/message-actions.js`，呈现在 `src/personal-access-ui/message-actions.js`。IA-3 的 `paintHistoryMessages(events, targetList)` 可继续调用 `ui.messageActions.bind(row,event,event.sourceRef?.sessionId || sessionId)`；原生 `sourceRef.seq` 用于操作身份，逻辑 `eventId` 用于开旁聊来源。引用按钮从当前真实消息节点定位，兼容 IA-3 把临时消息内容移入虚拟时间线节点。合并时保留 IA-3 的 `targetList` 参数、日期 / 搜索 / 旁聊菜单，以及 UX-4 的操作条与原生保存桥。

## Apple（苹果端）改动清单

1. CLIENT_API（客户端接口契约）3.3 新增 `POST /sessions/{id}/message-branches` 和 `GET` 同路由。编辑传用户消息 `seq`，重生成传助手消息 `seq`；可选 `modelProfileId` 只改变新分支。创建本身不启动模型。原有 D34 `/fork` 不变。
2. 长回复的复制 / 导出通过既有 `/sessions/{id}/events/{seq}/detail` 读取完整正文；新响应带 `type` 区分用户 / 助手文字，工具详情保持旧结构。原历史 4,000 字符展示上限不影响文件内容。使用返回的 `sendRequestId` 发 `session.message`，带回 `attachments / originalAttachments / attachmentMessageId`；不确定时先查原请求，再重放相同体。版本关系按 `groups[].versions` 开原生会话；原版用 `anchorSeq`，新版本用 `afterSeq` 后第一条同角色消息定位。`task.queued.data.inherited=true` 属于构造种子，不显示为新版本待执行目标。
3. 主对话走原有 `session.side.create` 和 `originChatId / originEventId`，父级主对话，先完成创建再发送；提示原主对话保留、引用上下文。主对话不放版本左右切换；跨执行段使用逻辑历史查找前一条用户输入。
4. 复制分别输出原始 Markdown 与纯文本。有用 / 没用使用设备端、账号隔离的记录：`version:1,sessionId,seq,rating:helpful|unhelpful,reason,note,at`；手机本机记录用 `source:phone,conversationId,messageId` 代替宿主锚点；原因和备注可空，不上传，留 R0-4 使用。
5. 导出读取完整公开历史；主对话读取全部逻辑历史页。工具步骤默认不含；先隐藏凭据 / Windows、UNC（网络共享路径）和 POSIX（可移植操作系统接口）绝对路径，再预览并保存 Markdown 或浅 / 深 PNG。附件只列名称，不嵌入原件；隐藏推理与内部注入不在公开历史内。
6. 文本选择后的引用块加入普通输入草稿；运行中禁用编辑 / 重生成，保留复制、反馈与分享。按钮读屏名称、反馈选中状态、对话框焦点恢复、浅 / 深色与窄窗口保持一致。新增四个图标母版 `thumb-up / thumb-down / share / quote`，Apple 图标资产已由生成器补齐；本包未改 Swift（苹果开发语言）功能代码。

尚未验证 Apple 原生页面、安卓真机系统文件选择 / 保存，以及超长图达到平台画布极限后的多图输出。后者当前提示导出完整 Markdown 文件，不截断文字冒充完整导出。主对话附件沿 IA 的来源引用带入，不自动复制整条主对话的原件。

手机本机消息的复制、反馈、引用、导出也已接入；编辑 / 重生成须由电脑接续后用宿主 DSH 原生分支，不在离线手机重造分支执行器。
