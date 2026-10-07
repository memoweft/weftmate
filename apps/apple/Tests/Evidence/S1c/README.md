# S1c-Apple 合成界面证据

2026-10-07，iOS 26.3 隔离模拟器，`S1cCloudUITests` 2/2 通过。全部账号、设备名、对话与邮件均为测试数据；没有 Cookie、令牌、QR 挑战、密钥或个人信息。

| 场景 | 截图 |
|---|---|
| 新设备等待，无宿主内容 | [pending.png](pending.png) |
| 另一原生本地会话允许/拒绝入口 | [approve-native.png](approve-native.png) |
| Keychain/refresh 恢复后访问原会话 | [conversation.png](conversation.png) |
| 合成 QR PNG 解码、一次性 redeem 后的对话列表 | [paired.png](paired.png) |

运行的是实际 cloud main + SQLite/file 邮件与真实隔离宿主。浏览器账号交互由测试驱动提交已有 JSON 接口；QR 测试是 Debug 直连回环宿主，不经过生产中继。对话模型未配置，验证读取原会话，不触发模型或工具。系统认证浏览器的生产公钥 bootstrap、注册/找回页面、账号宿主枚举与可信 pin 转交仍未齐；不能把这些截图解释为生产首次登录全流程已可用。复现见 [S1c 验收说明](../../S1c-README.md)。
