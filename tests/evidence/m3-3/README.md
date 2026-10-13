# M3-3 第一段交付

`platform-gaps.md` 给出 Mac 源码启动方法、平台差异和后续安装包建议；`unit-tests.md` 与两个 unit JSON 给出完整 macOS 组及失败修复的分开记录。`verification.json` 汇总最终环境／检查／清理状态。

## 主路

`desktop.json`：真实主进程、固定 DSH，合成模型、随机端口、独立临时 profile。`electron-1200-{light,dark}-{first-open,main-chat,between-file-steps,project-output,restart}.png` 是五个状态的浅深两套 Electron 自身窗口内容截图。文件步骤图是两次审批之间的过渡帧，未捕获稳定的批准条；审批证明来自可见按钮等待／两次点击、批准前文件不存在及批准后的物理写入。共两次有效运行生命周期（启动、退出重开），两次实际审批；新文件完整 SHA-256 与磁盘字节已核对。

生产凭据实现仍是 Electron `safeStorage`。测试进程只替换 OS credential provider 为随机 AES-256-GCM，钥匙仅在父进程内存；密文与普通设置没有模型密钥，重启能恢复模型。没有读写登录钥匙串。系统文件选择器返回值也为替身，但选目录后的原生可信桥、项目 API、实际文件和 DSH 工具未替换。

`trial-01` 是等待本机账户入口的夹具时序错误；`trial-02` 是把自定义 combobox 当原生 select；`trial-03` 揭露了真实项目 store 的 Windows-only 校验，已修产品；`trial-04` 是首次模型保存与跳过引导并发的夹具竞争，已改成逐个可见引导步骤；`trial-05` 是项目 session 夹具错用普通 `/commands`，改回现有 `/projects/:id/sessions`。均保留原失败及窗口，不计通过。

## 记忆与手机

`memory.json` 属于真实 `createPersonalMemoryManager`／RPC v2／本机只读 Python Core。通过本机合成 HTTP 解释形成正式命名 cognition，Core 将它召回到另一 session，第二次合成模型请求根据真正的 recall context 答出名字，Core 进程重开还能召回。没有手工写 Core 数据库。这是宿主桥层闭环；主路 Electron 走查为隔离文件测试关闭了记忆，没有把它称为整个可见聊天界面的记忆验收。语义模型／新版即时 recall 和真实 MiMo 另列边界。

`phone.json` 记录单 Mac 的合成云／手机网页最终结果；`phone-trial-*.json` 是准备夹具、命名或寻址失败的历史尝试。手机浏览器为无窗口 Chromium，主进程为无窗口 Electron，均禁用 GPU；它们不是 iPhone／Android 真机或生产中继证据。云端与手机界面无改动。

## 可重放

先按平台差异表生成同身份 DSH，然后在根目录执行：

```sh
export PATH=$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH
node tests/integration/m3-3-mac-desktop.mjs
PYTHONDONTWRITEBYTECODE=1 node tests/integration/m3-3-memory.mjs
node tests/integration/m3-3-phone.mjs
```

Core 默认引用相邻 `memoweft/py/.venv/bin/python` 和 `memoweft/py/src`，也可用 `M3_3_MEMORY_PYTHON`／`M3_3_MEMORY_SOURCE` 显式指定已有只读安装；不会安装解释器或模型。每段创建并清理自己的临时资料；真实模型、账号、Windows 数据目录和 iOS 模拟器不参与。

最终手机检查：已登录同一合成账号、设备页看到唯一 `synthetic-mac`，截图为 `phone-web-devices.png`；原生夹具路线未出现在绑定账户的模型目录（`catalog:[]`），没有发送聊天命令。故 `phone.json` 为 connected=true／completed=false，需要下一包在同一有窗口 profile 的账户模型发布和云绑定后复核；本包没有改权限或云／手机代码来绕过。

资源：根 Electron 启动共26次（主路7含五次失败夹具、必过组捕获11次、手机检查无窗口8次）。全部按本机规则禁用 GPU；无新的 GPU／WindowServer 报告或整机重启。已清理本包约414 MiB运行时／源码缓存和中断夹具；峰值 scratch＋构建约1.6 GiB，最少剩19 GiB、结束约19 GiB。`npm ci` 恢复的约597 MiB依赖保留；这些不是 Mac 安装包。所有本包进程退出，临时资料和误被真实 Core 创建的合成空库已删除。
