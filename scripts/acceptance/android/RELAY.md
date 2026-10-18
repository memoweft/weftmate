# 安卓连接电脑：证书签发前置与安装版跑法（A1 / #520）

使用 B2（#514）中的 `build.ps1`、`session.ps1` 和独立驱动构建全新 APK、创建模拟器。本目录的 `relay-session.mjs` 延用 B2 的回环控制协议，增加安装版入口与进程环境代理选项；不替换云、模型或身份响应。

## 先检查真正运行的程序能访问证书机构

```powershell
node scripts/acceptance/android/relay-network-check.mjs --desktop-executable <已安装候选程序.exe>
# 仅在本机已经提供 HTTPS_PROXY / HTTP_PROXY，且直连确实不可用时：
node scripts/acceptance/android/relay-network-check.mjs --desktop-executable <已安装候选程序.exe> --use-env-proxy
```

检查在所选程序自带的 Node 中执行真实 HTTPS GET，保留正常证书校验，输出仅含 Node 版本、HTTP 状态、耗时与错误代码。它不签发证书、不登录、不打印代理地址或凭据。失败返回非零退出码；不要只用浏览器或 curl 的成功代替这项检查。

#520 的本机原因是出站网络：环境已经提供代理，但原 B2 Electron 进程的 Node fetch 没有启用环境代理，访问 Let's Encrypt 生产目录报 `UND_ERR_CONNECT_TIMEOUT`，在发送 CSR 或发布 DNS 挑战前就失败。证书不存在后的 ENOENT 是后果。候选安装版也复现同样的直连失败；不是源码身份、随机监听端口或回调登记造成的签发失败。

当前候选的 Node 24.21.0 支持 `NODE_USE_ENV_PROXY=1`。`--use-env-proxy` 只把这个值传给本次测试子进程，使用已有代理环境，不写用户/机器配置，不修改系统信任，不关闭 TLS 校验。没有代理环境时不要凭空添加该选项；先解决实际出站网络。较旧程序须运行上述检查，不能假定其 Node 支持该变量。

## 启动安装版并登录

```powershell
node scripts/acceptance/android/relay-session.mjs <外部证据目录> <锁目录> --desktop-executable <已安装候选程序.exe> --use-env-proxy
```

候选程序须由真实安装包安装，使用独立安装身份；本次控制器另建隔离资料与工作目录、隐藏窗口、随机 HTTP 端口，26 分钟到期收尾。安装版必须传入本轮生成的 `--desktop-config`，由控制器写在证据目录；否则已安装程序原有配置会覆盖环境变量，可能仍把中继设为关闭。不会修改原安装配置。省略 `--desktop-executable` 才是源码运行，交付时必须区分。源码运行还需按 `src/personal-relay/README.md` 提供官方 frpc 与外层传输 CA；安装版使用随包资源。

继承进程内的模型配置。控制器沿用部署文档登记的桌面 client_id 和 redirect_uri；实际监听仍随机分配。登记回调是 OAuth 的精确匹配参数，证书签发使用 DNS-01，不依赖电脑的 HTTP 监听端口。不要为测试改云端回调表或开放端口。

按照 B2 控制协议，把本次所需邮箱、验证码分别通过 `email` / `code` 请求传入内存；`run` 执行真实页面与手机桥动作，`close` 关闭。只从本次发码请求之后、主题含 WeftMate 的对应邮件取码。遇到验证码冷却，等待服务器提示的期限，不连续请求，不把冷却算证书失败。

依次核对电脑实际登录、`/status.relay.state=online`、手机目录对应电脑 `online=true`、实际“连接这台电脑”动作成功。C8 必须在同一对话核对历史与追加回复；W4 必须从 APK 发起创建文件并在电脑读取真实文件，不能只凭模型说“完成”。首次签发失败的资料会保存每日重试时间；网络修好后使用程序的证书重试入口，或为下一轮申请全新隔离资料，不删除旧证据。

手机驱动仍从本轮 `session.json` 获取随机 ADB forward 端口。结束时发送 `close`、创建 `stop-session`，核对测试进程树、forward 和锁均回收，并卸载本轮独立 APK。证据留在仓库外。
