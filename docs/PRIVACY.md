# WeftMate 隐私说明 · Privacy

> 活文档 · 随功能更新。一句话:**WeftMate 是本地优先的桌面伴侣;你的记忆和密钥默认留在你自己机器上,只有你主动发起的动作才会把数据发给你自己配置的模型。**
> One line: WeftMate is local-first. Your memory and keys stay on your machine by default; data leaves only for actions you initiate, and only to the model provider you configured.

## 数据都存在哪 · Where data lives

- **记忆 / 画像**:存在本机的 SQLite 库(`<userData>/weftmate.db`),不上传任何服务器。可在「记忆与画像」里**导出备份**(记忆包 JSON),也可**一键清空全部**(恢复出厂·不可逆)。
- **模型密钥 / MCP 密钥**:用系统的 Electron `safeStorage` **加密后**落盘,**明文绝不落盘、绝不写日志**。(Linux 无 keyring/libsecret 时无法安全保存,会提示你先装密钥环。)
- **对话历史**:本机文件(`sessions/*.jsonl`)。归档=软删(留盘可恢复),不硬删。
- **崩溃日志**:本机 `<userData>/weftmate-crash.log`,只含堆栈。**不自动上传**——要不要发给我们由你决定(见「反馈」)。

## 什么时候数据会离开你的机器 · When data leaves your machine

- **聊天 / 帮你干活**:你发的消息、以及干活模式下**工作区文件内容 / 命令输出 / 你附上的参考文件**,会随请求发给**你自己配置的模型端点**(可能是云端)。这是"AI 帮你干活"绕不开的——**由你主动发起任务即视为同意**,界面会写明。想全本地就配一个本地模型端点。
- **感知(observed)**:感知采集到的"你在用什么"数据,**默认不上云**(红线)。只有你在设置里显式打开"允许上云"(需二次确认),之后新采的才会带上云授权。
- **MCP 一键装**:装的 MCP 服务是**第三方代码**,经 `npx` 拉取运行。调用第三方工具会把参数(可能含你的内容)发给该第三方。**“每次确认”档下所有外部调用都会先等你点头**;你可以信任具体工具，但信任只会在“完全访问”档免批。装之前请确认来源、考虑锁定版本。

## 你的控制权 · Your controls

- **感知开关 + 上云开关**:默认都关,随时可关。
- **导出 / 删除记忆**:随时导出备份、随时一键清空全部。
- **agent 三档自主度 + 需审批步骤逐次确认 + 一键撤回**:干活时你全程可见、可拦、可回滚(命令的副作用撤不回,会如实标注)。
- **模型**:BYOK,想用哪个端点你定;配本地端点即全程不出机器。

## 反馈 · Feedback

发现问题欢迎提 issue(仓库 Issues 页有模板)。崩溃日志在 `<userData>/weftmate-crash.log`,**要不要附上由你决定**;粘贴前请自行删掉任何敏感信息。

---

*我们守 [MemoWeft `docs/naming.md`](https://github.com/memoweft/memoweft) 的口径:不吹"真正理解你";记忆分**事实**与**推测**,不把猜的当真的。*
