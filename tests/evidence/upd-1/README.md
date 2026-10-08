# UPD-1 签名更新验收

真实 Windows（视窗系统）Electron（桌面程序框架）通过 `_electron.launch` 启动 `src/main.mjs`，隔离临时 `userData`（用户数据目录）、测试账号、随机回环端口、临时 Ed25519（签名算法）密钥。运行中的任务通过真实 DSH（助手运行时）与合成 SSE（服务器推送事件）模型执行；合成模型请求保持流打开，完成信号由测试发出，没有真实模型费用。

- v1 是程序内置界面；v2 只改 `layout.js` 的可见“新对话”按钮文字，增加 `UPD v2`。后台下载后，在任务运行时重新打开窗口仍为 v1，模型连接未关闭；任务正常完成后重新打开显示 v2。
- v2 全包 **1,357,291 字节**，下载 **4,914 字节**，复用 **1,352,377 字节**，仅请求一个变化文件。完整传输明细见 [desktop-report.json](desktop-report.json)。
- v3 只改 `app.js`，在同步挂载前故意抛出异常。程序自动回到 v2，写入失败身份；再次完整启动主程序仍显示 v2，同一坏版不再激活。
- 手机 Chromium（浏览器引擎）使用 **390×844**；实际 `/personal/v1/app/manifest` 认证下载与同一签名消费者校验，只有 `components/cloud-auth.js` 改变，切换后显示 `UPD mobile v2`。这是浏览器中的版本消费者验收，安卓原生流程另外验证。
- MuMu（安卓模拟器）通过独立 `com.memoweft.weftmate.mobile.upd1qa` 包运行真实 `HybridActivity`（原生界面活动）、`MobileUiBundles`（界面包下载器）和 Bouncy Castle（密码库）验签；在 APK（安卓安装包）构建资产中注入临时**公钥**。实际下载 v2 → 激活 → 页面显示新文字 → 恢复内置版本，截图包含系统栏。发布说明额外含中文、斜线、换行、U+2028 与 emoji（表情字符），核对 Node（脚本运行环境）与安卓签名编码一致。测试结束卸载本包和测试包，未覆盖本人应用。

截图 `01-v1.png`、`02-v1-running.png`、`03-v2-ready-task-running.png`、`04-v2-active.png`、`05-v3-rollback-v2.png` 来自真实桌面页面；`mobile-chromium-*.png` 来自手机视口；`upd-1-native-*.png` 来自 MuMu 系统截图。下载字节数来自回环服务器实际返回的数据，不包含小型清单响应。报告没有私钥、认证凭据或真实运行路径。

复现：`node tests/integration/upd-1-electron.mjs`；`node tests/integration/upd-1-mobile.mjs --mumu`。相关单测覆盖签名正确 / 篡改 / 错密钥 / 过期与兼容范围、逐文件差异、启动中断恢复、损坏下载、白名单、发布脚本及旧手机字段；类型检查见 PR（拉取请求）。完整测试交 CI（持续集成）。

本包不配置正式更新源，不发布真实安装包，不提供正式私钥或证书。程序本体只验证差分配置 / 接缝和已下载文件哈希；真实 NSIS（Windows 安装包格式）安装、blockmap（分块映射）服务器与代码签名验证留 UPD-3。UI-4 尚未合入时只提供共享动作 / 数据，不另建“关于”呈现。
