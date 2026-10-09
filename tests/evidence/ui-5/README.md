# UI-5 对话菜单与设置已归档验收

证据仅使用随机合成账号和「蓝色纸鹤」「合成资料」等合成内容。本人参考截图只查看，未复制到仓库；没有读取日用宿主数据或保管库。

- 真实 Electron（桌面程序框架）主入口、隔离个人宿主、固定 DSH（助手运行时）和 MiMo（云模型）：悬停菜单、P/U/R/F/A/D 快捷键、重命名 Enter（保存）/ Esc（取消）、右键菜单、分组与折叠、分叉后立即打开并继续回复原暗号、设置已归档搜索 / 恢复 / 删除。
- 分叉复制 `经验.md` 和 `marker.txt` 到不同目录，修改子目录文件后原目录不变；新宿主记录没有原对话 `conversationId` 或 MemoWeft（记忆核心）来源绑定。使用 DSH 原生 `AgentFactory.create` 的事件种子、`parentSession` 和 `seedLength`，由原生验证器检查历史；为独立工作目录，复用原生种子分叉机制，没有使用固定继承原目录的公开 fork RPC（分叉远程调用）。长期记忆仍按账号共享，未复制来源。
- Chromium（浏览器引擎）390×844 手机网页：长按同一动作表单、未读切换、分组选择、设置归档恢复，使用真实宿主接口。
- MuMu（安卓模拟器）：独立 `com.memoweft.weftmate.mobile.ui5qa` 包、真实 WebView（原生网页视图）和 Kotlin（安卓实现语言）网络桥接；真实触摸长按和菜单操作、未读切换、分组选择、归档恢复通过，测完卸载。测试复用本地合成账号授权，在测试脚本中结束未配置云账号的登录画面；云登录流程不在本包验收范围。
- `session-menu.test.ts` / `session-experience.test.ts` / `settings-registry.test.ts` 共 15 项通过；FIX-5（弹窗定位修复）真实 Electron 和手机边缘定位回归 1 项通过。HTTP（网络接口）用例覆盖 CSRF（跨站请求伪造防护）、跨账号拒绝及重启持久保存；`npm run typecheck` 通过。Android（安卓）code23 / 0.8.10 编译通过，新界面包默认最低 code23。
- 删除确认框里的遗忘勾选保留原代码；没有修改 FG-1（遗忘确认包）的确认逻辑。长时浸泡、Apple（苹果）原生接线、正式发布未做。

浅 / 深截图：`desktop-menu-*`、`desktop-archived-*`、`mobile-web-long-press-menu-*`、`mobile-web-groups-*`、`mobile-web-archived-*`、`mumu-long-press-menu-*`、`mumu-groups-*`、`mumu-archived-*`。各端行为结果见对应 `*-verification.json`。费用见 `costs.json`，包括失败验收批次，缺失用量请求按下界报告。

可重跑脚本：`node tests/integration/ui-5-session-menu.mjs`、`node tests/integration/ui-5-session-menu.mjs --mobile`；只测 MuMu 用 `node tests/integration/ui-5-mumu.mjs`。先以独立包名编译 Android 调试与测试 APK（安卓安装包），确认模拟器没有其他 WeftMate 测试进程。密钥只从系统环境变量读入进程，未写入仓库。
