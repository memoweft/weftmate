# M3-3b 本机Mac试用版

交付 `~/Desktop/WeftMate/trial/WeftMate.app` 与 `先读我.txt`。正式资料留空，App结束时未运行。详情见[包内容与本机配置](package-contents.md)、[平台差异更新](platform-gaps.md)、[钥匙串实测](keychain.md)、[定向验证与执行偏差](unit-tests.md)。

`desktop.json`是**最终包**的真实Electron/DSH整批通过结果；`electron-1200-{light,dark}-*.png`均由其自身窗口capturePage取得。各9状态：首次引导、主聊天、真实文件拖入IPC、读审批、写审批、项目输出、shell审批、新聊记忆、退出重开。`phone-{devices,chat,file-approval,file-completed}.png`是无窗口网页；新会话选择用现有shared core action，不将它称为完整窄屏导航点选验收。真实Finder手势、OS选择面板、TCC/通知/登录项权限、真机与公网明确未验。

`keychain.json`给真实临时OS钥匙串加密、同构建重开、改变签名后的拒绝、丢失钥匙保留密文及明确重填。`package.json`给完整asar/松散资源扫描；`verification.json`给资料未触碰、0残留、26次启动和偏差。`trial-01`至`trial-07`是失败尝试：Dock函数拼写、菜单角色测试调用方式、合成模型历史误判、两次窄屏会话选择、主对话旧发送契约、标题生成误覆盖召回断言；它们保留但不算成功。最早constructor和keychain-eval失败另在说明及`keychain-trial-01.json`记录。

本机没有MIMO_API_KEY，模型全部随机端口合成HTTP，真实模型请求0。真实Core `ddd919d8`与现有Python3.11.17只读引用，完整可见聊天形成/新对话召回/整App重开后记忆API闭环通过；没手工写记忆数据库、没下载135MB模型、没改外仓/分支。账号/云/模型密钥为隔离随机合成值，无生产云、Windows电脑或真实账号。

复验先按第一步重建vendor，再打app、编译测试隔离库；正式配置保留：

```sh
export PATH=$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH
CSC_IDENTITY_AUTO_DISCOVERY=false node scripts/build-mac-trial.mjs
clang -dynamiclib -Wno-deprecated-declarations -framework Security -framework CoreFoundation \
  tests/helpers/m3-3b/isolated-keychain.c -o .local/m3-3b/isolated-keychain.dylib
# 串行，退出一批后再启动下一批。
node tests/integration/m3-3b-mac-trial.mjs
node tests/integration/m3-3b-keychain.mjs
```

构建不覆盖现有试用版。已有纯UI回归的GPU/并发偏差见unit-tests，重放本包入口不运行那一组。本人首次打开和真实模型/真实系统权限验收由本人进行；交付没有启动正式资料目录。
