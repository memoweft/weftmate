# ST-7a 验收证据

这一包接入命令式与远程地址的通用连接器，并提供无外部服务的「本机时间」内置示例。外部工具使用固定 DSH 的 MCP（模型上下文协议）客户端；审批、第二模型复核与执行记录沿用现有功能。

`report.json` 是真实 Electron（桌面程序）和 MiMo 的完整闭环结果：合成账号、隔离程序目录、随机端口；只读工具直接使用，发送先审批，批准后写入合成文件，单工具禁止后不再发送，停用和移除清掉工具与规则。最终闭环 11 次模型请求，来自账号用量账本；`runtime.log` 已去掉本机身份与临时目录。真实模型密钥从 `MIMO_API_KEY` 机器环境变量读取，只在进程内使用；合成连接器凭据使用程序原有的加密凭证库。

`visual-report.json` / `visual-runtime.log` 是独立的合成界面补拍，不发模型请求。截图覆盖空列表、添加表单与连接方式下拉、成功／失败的连接测试、连接器列表、工具规则与打开的菜单、只读结果、审批条与复核、禁止结果、停用、更多菜单、凭据更新表单与移除确认：电脑浅／深色、1200／480；手机网页浅／深色、360／390。手机图为浏览器视口，不声称验证安卓或苹果原生系统栏。

模型计数范围：11 次是最终成功闭环的账本计数；另有已记录的失败调试 10 次。早期失败未留存完整计数，整个任务至少 21 次，不能把 11 次当成全任务总数。界面补拍为 0 次。

固定测试在 `tests/personal-connectors.test.ts` 和 `tests/personal-connectors-native.test.ts`：分类与规则、加密保管／轮换／删除／账号隔离、短凭据不回显全文、备份排除凭证库、原生进程通信的目录与结果投影、实际原生账号范围、命令与地址故障、凭据拒绝、启动与调用超时、原生重启上限、崩溃恢复不重放旧调用、空闲回收与退出无残留、HTTP（网页传输协议）真实工具调用和只写本地的合成发送。原始服务器错误与标准错误不写入运行日志；工具元数据与返回值去掉已知凭据，并加外部资料标记。诊断导出与既有凭证库字节保护另由相关回归用例验证。

`parent.mjs` 是强制退出夹具：让原生连接器仍在处理慢工具时结束合成管理进程，检查服务进程全部消失，覆盖程序来不及执行正常退出钩子的情况。

最终清单见 `checks.json`：完整必过 323 文件 1837／0失败／14既有跳过；固定运行时 34 文件 239／0；手机五文件 114／0；首次合主线后相关 16 文件 230／0，最后合主线与修正后相关 5 文件 81／0。完整必过按既有 CI（持续集成）三分片工作流检查无重复和缺失文件，重试恢复 0；最终相关检查覆盖新主线和最后的说明分类／页面播报修正。64 张截图均为合成环境。类型、61 个手机共享资源生成和公开卫生通过。

复现：

```powershell
npm ci
npm run vendor:dsh
node --test tests/personal-connectors.test.ts tests/personal-connectors-native.test.ts
node tests/integration/st-7a-electron.mjs
node .github/scripts/ci-unit-tests.mjs required
node .github/scripts/ci-unit-tests.mjs vendor
node --test tests/personal-cloud-web.test.ts apps/mobile-ui/tests/cloud-login.test.mjs apps/mobile-ui/tests/chat-interactions.test.mjs apps/mobile-ui/tests/visual-interactions.test.mjs apps/mobile-ui/tests/approval-interactions.test.mjs
node apps/mobile-ui/src/build-ui-core.mjs
npm run typecheck
node .github/scripts/public-hygiene.mjs
```

重活按并行约定占名额；只用合成账号与临时目录，不连接日用端口，不读日用凭证库。邮件、日历、网页授权、连接器目录、跨电脑同步与原生手机页面不在这一包。
