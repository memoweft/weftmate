# A17 · Apple 前端与 CRASH-1

本包修复原生对话菜单、附件菜单、D49 消息操作、D50 侧栏，以及无模型 / 空 / 加载 / 错误状态。Mac 对话菜单直接使用 AppKit `NSMenu`；所有动作仍调用原模型层。iPhone 使用系统菜单和操作表。没有增加宿主接口或系统权限。

三张私人 Codex 参照图只在本机查看，未复制进仓库。所有截图来自本 App 自有窗口或专用模拟器，内容与账号均为合成。原始 PNG 未编辑；本机审查用缩略联系表不属于交付证据。

- `before-after.md`：前后对照。
- `walkthrough.md`：逐页、逐状态、清单 1–9 与页面家族检查。
- `callback-audit.md`：后台回调与原生 UI 协议审查。CI 保守静态门与允许清单位于 `Scripts/check_callback_isolation.mjs`、`Scripts/callback-isolation-allowlist.json`。
- `main-final/`：主对话、临时对话、原生菜单、来源、发送附件、审批与滚动。
- `sidebar-verified/`：闲置 / 项目悬停 / 对话悬停卡、账户菜单、深入思考、归档撤销与创建重试。
- `settings-final/`、`menus/`、`projects/`、`consistency/`、`gallery/`：设置、归档 / 遗忘、项目、审批 / 提问 / 用量菜单及登录 / 记忆。
- `states/`、`large-text/`、`panels/`、`offline/`：各状态、小屏大字号、照片 / 文件选择器与电脑离线。
- `watch/`：配对 Watch 冒烟；`mac-launches.json`：最终 Mac 二进制 30 次隔离冷启动。
- `attempts/`：已修正的失败 / 旧截图，不计通过。最终通过以 `validation.json` 和各组回执为准。

Mac XCUITest 的 automation mode 限制没有重试授权或修改系统设置。Mac 使用既有 App 内原生 AX 与自有窗口事件运行器；iPhone / Watch 使用 XCUITest。Xcode 构建与测试串行 `-jobs 2`，一次一个模拟器，Watch 阶段仅已有配对组合。

动态 / 目标 / 成果库原生页面及底部选项卡是下一包。当前 Apple 设置是 Mac 13 类、iPhone 11 类，独立的个性化 / 助手 / 通知分类尚未实现。未新增本地通知权限或声称发出通知。真实模型、真实 Core、真机相机与生产中继不由合成验收替代；系统文件服务的捕获 / 落盘边界单独记载。

A17b 继续 `bc14a0fa`，保留已完成实现与验证。完整 Swift 单测合并 main 前后均为 406/406（隔离云 / TLS 夹具启用、0 跳过），Node 文案 / 令牌 / 回调测试 17/17，敏感回调 49 处。最终完成标志由 `node apps/apple/Tests/verify_a17_evidence.mjs --finalize` 在全部报告、原图、隐私、30 次启动二进制哈希及零新增诊断均通过后写入。最后设置复验修正分类定位与 AX 点击夹具；iPhone 本对话用量移至原生菜单首组，以免落在原生菜单裁剪区外，补浅深打开截图。分类、改名、返回位置、账本原保护点保留。

最后临时菜单复验将 iPhone 自动删除改为明确的带勾选原生底部选择表（Mac 分支保留原实现），使用原设置接口；期限 / 召回断言锁定本轮实际新增对话 ID，保留原默认值、7 天、关闭召回与过期清理保护点。

最终核对发现交接的 30 次启动记录（01:44）早于最后 Debug 重建（01:53）；保留 mac-launches-before-final-build.json 与对应旧基线，对最终构建补验 30 次启动并校验哈希，不改写旧证据。
