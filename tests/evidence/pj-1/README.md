# PJ-1 项目 / 文件夹（D37）验证

项目登记和会话分组使用独立实体。旧资料目录保留原 ID、目录身份、修订与来源，迁移为只读项目；文件夹路径只留在电脑。项目设置更新成员修订；移除保存内部墓碑、解绑对话，不删除项目文件。普通对话移入项目后，新的原生工具执行参数和 DSH（助手运行时）沙箱策略使用项目目录，历史头和旧文件不改写。

本包只使用随机端口、临时目录、合成账号与合成项目。没有操作日用宿主、18186、日用数据或真实文件夹；没有请求本地模型。Apple（苹果）原生客户端留后续包。

| 场景 | 结果与证据 |
|---|---|
| 项目创建、设置、修订冲突、运行中禁止改设置、会话绑定 | `personal-project-folders.test.ts`，真实本地 HTTP（网络接口）及临时磁盘 |
| 旧登记迁移、重启幂等、移除不删文件、手机对象不含目录路径 | 同上；保留旧 ID、只读权限与空说明；旧来源回归通过 |
| 项目工作目录与说明 | `pj-1-projects.mjs`：真实 Electron（桌面程序框架）、固定 DSH、MiMo；读取 brief.md、写 summary.md、用 pwsh（PowerShell 工具）运行 Get-Location 和 Get-Content 核对；总结含固定说明要求的「竹叶」 |
| 系统文件夹选择接线 | 真实 Electron 主窗口经 preload（预加载桥）调用系统选择框 API（程序接口）；测试替换系统返回值为合成文件夹，验证 openDirectory 参数、默认名称与真实登记，不需人工操作系统对话框 |
| 越界与只读写入 | 真实 MiMo 原生 write 调用被拒；outside.txt 与 forbidden.txt 未生成。路径中已有 junction（目录连接）也拒绝，单元测试覆盖；只读不能升级沙箱，子任务继承项目目录 / 说明 / 权限 |
| 本人明确批准后的一次越界升级 | `pj-1-project-escalation.mjs`：合成模型、真实 Electron / DSH，即使对话为全部允许，越界文件在批准前不存在；原生 `allowed-once`（允许一次）后才写出。项目内新文件也走实际审批，公开审批对象隐藏项目绝对路径并保留文件名；见 escalation-verification.json |
| 手机已接续的对话移入项目 | `personal-conversation-adoption.test.ts` 保留原 conversationId 与 sessionId，并在后续消息同时使用项目上下文；侧栏仅保留项目中的那条对话入口，打开时保持电脑执行来源 |
| 已有普通对话移入项目 | 同一真实程序中创建普通对话，绑定项目后读取 brief.md、写 moved.md、运行目录核对；移除后 brief.md、summary.md 与 moved.md 保留 |
| 桌面外观与交互 | 浅 / 深主窗口、项目设置、创建项目、移至项目菜单、800×600 窄窗口；既有完整桌面交互脚本通过 |
| 手机远程网页 | 同一真实宿主与项目，390×844；项目列表和真实完成任务的对话截图 |
| Android（安卓）界面包 | 390×844加载真实 www 资源，以与原生相同的方法名转发到真实隔离宿主；项目列表、新建对话、移动菜单通过。图标尺寸修正后另用真实授权接口 + 合成 DSH 后端进行快速几何回归；最新 mobile-bundle 截图属于该合成回归。未安装模拟器应用 |

主要复现命令（在 Windows、已安装仓库依赖的环境）：

```powershell
node --test tests/personal-project-folders.test.ts tests/personal-project-service.test.ts tests/personal-native-files.test.ts tests/mobile-android-bridge.test.ts tests/ui-core.test.ts
node --test tests/personal-tool-approvals.test.ts tests/session-experience.test.ts tests/session-menu.test.ts
node --test tests/personal-project-reader.test.ts tests/dsh-web-profile.test.ts tests/personal-desktop-ipc.test.ts tests/mobile-ui-core-assets.test.ts
node --test tests/personal-desktop-ui.test.ts
node tests/integration/pj-1-projects.mjs
node tests/integration/pj-1-mobile-bundle.mjs
node tests/integration/pj-1-project-escalation.mjs
node apps/mobile-ui/src/build-ui-core.mjs
node apps/mobile-ui/src/check.mjs
npm run typecheck
```

MiMo 脚本从 Machine（系统级）环境变量读取 MIMO_API_KEY，使用现有仅内存保管库的基线启动器；密钥不落盘或进入证据。`verification.json` 记录成功场景；`usage.json` 保留四轮开发验收的已知用量与失败原因：共30条原生助手回复，未缓存输入30528、输出2187、缓存读取91392 token（词元）。模型配置 / 连接探测未纳入这份原生回复计量。第一轮暴露旧成果存储校验问题；第二轮手机定位器错误；第三轮测试按原文匹配失败，因为接口正确隐去了本机路径；改用原生 receipt（回执）后，第四轮完整通过。

完整测试只在 GitHub CI（持续集成）运行。本包没有建立独立项目记忆世界，没有改变 MemoWeft 的形成与遗忘规则，也没有做 Apple 原生界面、安装包发布或长时浸泡测试。
