# M2-4 对话内经验、归档与删除

Windows-6，2026-10-08。真实 Electron（桌面程序框架）通过 `_electron.launch` 启动个人宿主与固定 DSH（助手运行时），使用随机端口、临时 userData（应用数据目录）、合成账号及 MiMo `mimo-v2.6-flash`。模型密钥从 Machine（系统环境变量）读入进程内，使用现有基线的临时保管库，不读取日用数据。

| 场景 | 结果 |
|---|---|
| A 默认目录创建 triangle.py，运行 n=8，保存经验.md | 通过；输出36，原生工具执行 |
| 新建 B，再回到 A 计算 n=12 | 通过；工具详情确认运行原 triangle.py，输出78；没有重写脚本 |
| 桌面归档、查看已归档、恢复 | 通过；归档发送409，恢复后可发送 |
| 删除默认不勾遗忘 | 通过；对话、目录与记录清除，已形成的蒸紫薯早餐偏好仍在 |
| 删除勾选遗忘 | 通过；真实 Core（核心）来源证据删除，肉桂咖啡偏好不再出现在记忆列表 |
| 手机网页与 MuMu（安卓模拟器） | 真实隔离宿主、固定 DSH 与合成模型；归档/恢复、确认框默认不勾、永久删除；长按和运行中删除均通过结构化断言 |
| 关闭程序后目录核对 | 通过；删除的 triangle.py / 经验.md 不会在原生实例释放或关机刷新后重建 |

桌面见 [verification.json](verification.json)，手机见 [chromium-verification.json](chromium-verification.json)、[mumu-verification.json](mumu-verification.json)。截图包括浅/深手机归档与删除、真实桌面删除确认和勾选遗忘。安卓使用独立 `com.memoweft.weftmate.mobile.m24qa` 与同名测试包，不覆盖已有应用；清理见 [mumu-cleanup.json](mumu-cleanup.json)。

验证命令：

```powershell
node tests/integration/m2-4-session-experience.mjs --mimo
node tests/integration/m2-4-mobile-sessions.mjs
node tests/integration/m2-4-mobile-sessions.mjs --device
node --test tests/session-experience.test.ts tests/ui-core.test.ts tests/mobile-android-bridge.test.ts
node --test tests/personal-access-ui-interaction.test.ts tests/personal-access-ui.test.ts
node --test tests/p1-03-dsh-adapter.test.ts tests/p1-04-dsh-adapter.test.ts tests/stage1-gateway.test.ts tests/personal-shared-attachments.test.ts tests/personal-sync-attachments.test.ts
node apps/mobile-ui/src/build-ui-core.mjs
npm run check --prefix apps/mobile-ui
npm run typecheck
```

对应核心与共享前端39/39、桌面61/61、DSH/附件31/31通过；另有纯生成副本与相关会话/账号回归。安卓独立 APK（安装包）及测试包构建通过。完整测试交 PR CI（持续集成）。现有压缩器已经保留方法、脚本路径、命令和踩坑摘要，本包衔接该摘要及工作目录，没有重复制造压缩机制。

全部开发/验收 MiMo 已结束请求 **74次**，输入536,541、缓存427,712、输出7,293 token（令牌），估算 **¥0.13196924**，含失败的测试尝试和 Core 形成请求。详见 [usage.json](usage.json)，按 [MiMo 官方定价](https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash) 缓存输入¥0.02、未缓存输入¥1、输出¥2 / 百万令牌；不是账户账单。失败尝试包括尚未注入原生依赖、测试投影事件名称错误、早期归档按钮绑定错误和同名对话选错测试对象；保留费用，不把失败覆盖成成功。

边界：本包提供宿主 `/sessions` 会话生命周期与 Android（安卓）远程会话动作。手机独立本地对话和 Apple（苹果）原生会话菜单未扩展；手机起步的交接来源记录目前沿用原同步协议。本包未升级 DSH、未改记忆插件、未发布手机 UI（网页界面）更新；新增安卓桥动作需要本包重建的原生壳。Core 不可用、来源共享导致删除冲突、后台执行未确认时保留对话并报告错误，不声称完成遗忘。
