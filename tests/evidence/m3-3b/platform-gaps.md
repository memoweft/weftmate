# 第一段平台差异的本次更新

| 接缝 | 本次结果 | 仍未证明/后续 |
|---|---|---|
| 安装启动 | 最终x64 `.app`，真实打包主进程＋固定DSH；无开发路径/本机身份/凭据/测试资料；ad-hoc深层签名校验通过 | 真正Finder双击/Gatekeeper交互未自动点击；无quarantine的本机包经可执行入口实开；Developer ID/公证/对外DMG/arm64另包 |
| 首次引导/资料 | 模型表单、测试连接、流式聊天、正常重开通过；正式资料未创建 | 日用真实模型、本人首次打开另验 |
| Mac菜单/窗口 | 关于、设置Command+,、隐藏/服务、Command+Q；编辑undo/redo/cut/copy/paste/selectAll；默认原生标题栏让红绿灯在Web内容外；关窗隐藏不退出，Dock activate唤回；实际输入区Meta+X/Meta+Z通过 | 系统菜单外观/实际物理快捷键手势不另造截图；原Windows菜单/标题栏分支保持 |
| 项目选择/文件权限 | 仍是`dialog.showOpenDialog(openDirectory)`；Mac面板说明桌面/文稿/下载系统询问；注册/路径访问被拒时解释文件与文件夹设置入口；实际读写、两次可见审批和磁盘哈希通过 | OS面板选择结果仍注入，未自动操作真实系统选择面板/TCC询问/拒绝；没有修改系统设置 |
| 命令执行 | 真DSH bash执行 `printf "M3_3B_SHELL_OK\n"`，窗口实际审批，输出返回模型 | Bash/PTY交互终端、长后台job、自行脱离进程组仍未完整验证；不申请辅助功能/屏幕权限 |
| 退出 | 原生Command+Q菜单动作走既有before-quit规则；6个观察到的本实例/子进程全部消失；重开后对话、项目、凭据、正式记忆仍在；最终包无残留 | 异常掉电/长期任务浸泡另包；不改Windows退出规则 |
| 文件拖入 | Chromium原生文件拖拽IPC携带真实合成`brief.md`进入真实Electron输入区，可见附件并移除；不是伪造File文本 | **Finder实际鼠标拖放未验**；没有拿合成IPC当Finder手势证明 |
| 系统通知 | 生产Notification链未替换产品；实际审批/完成事件创建正确通知对象/内容；测试只拦截show，防止改本人通知权限 | 系统投递、弹窗授权、点击系统通知回窗口未验；Mac通知设置入口已补，未实际打开系统设置 |
| 自启 | 现有设置开关保持默认关；Mac包用Electron bundle登录项选项、不传Windowsargv；登录启动读取稳定配置并按wasOpenedAtLogin隐藏 | 不登记/开关真实登录项，实际登录启动未验；稳定签名相关限制见后续 |
| safeStorage/Keychain | 最终包真实safeStorage，无mock/basic_text；临时文件钥匙串实际创建、加密、同构建重开解密成功；临时签名变更旧条目不可读，启动返回缺失凭据；可用新钥匙下明确重填恢复 | 本人login钥匙串/交互授权未碰；跨Developer ID升级另验；临时签名不能保证跨构建静默读取 |
| 记忆 | 最终可见聊天→真实Core形成命名记忆→新DSH聊天收到真实召回→整App退出重开后记忆API仍返回小禾；没有手工写Core数据库 | 模型为合成HTTP，无MIMO_API_KEY/请求0；135MB语义模型/新版即时语义召回未启用 |
| 手机 | 真本地合成云/同账号登录→唯一synthetic-mac→合成模型目录→流式聊天→手机可见审批按钮批准→项目真实文件内容42；第一步空目录来自管理夹具未登记账户私有模型，实际首次引导保存无需产品权限修补 | 项目会话由既有shared core.selectSession动作在测试中选择；**窄屏侧栏点选未稳定验通**。手机设备/公网/中继未验。云/手机实现未改；手机截图为headless Chromium |
| Mac登记类型 | 只在原生`platform=darwin`环境发送deviceType=macos；Windows仍沿原fallback，remote browser不受影响 | 生产账号登记未验，合成绑定用现有云夹具；M3-2多电脑目录/寻址不在本包 |
| 主路截图 | 1200宽浅/深各9个状态，Electron自身capturePage；手机四张关键状态 | Electron图不含OS标题栏/系统面板；失败图保留且不当成功图 |

本次改动的公共生产/构建文件：`src/main.mjs`、`src/personal-desktop.mjs`、`src/desktop-config.mjs`、`src/mac-desktop.mjs`（新增）、`src/personal-access-ui/app.js`（仅native Darwin deviceType）、`scripts/stage-dsh-runtime.mjs`、`scripts/verify-windows-package.mjs`、`scripts/build-mac-trial.mjs`（新增）。Windows行为分别由明确darwin/macTrial分支、原Windows默认配置/注册表/标题栏/通知/退出代码与打包参数保持。stage仅跳过本来不复制的pnpm安装元数据；活跃运行文件的链接仍拒绝。验包器的资源目录参数默认仍是原Windows目录。没有改API、云端、apps/mobile-ui、apps/apple、Android或DSH pin/补丁。
