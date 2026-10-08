# UI-3m 手机排队、插话与审批摘要

手机呈现复用 UI-3 的 ui-core（共享功能层）意图、任务队列、取消状态机、审批 / 来源摘要与输出去重；没有改领域文件或客户端业务接口。排队区在输入框上方，可折叠为「N 个排队中」，每张卡可取消、编辑后重新排；运行中默认插话，支持切换新任务与 Ctrl/Cmd+Enter（组合键）临时排队。停止保留其他目标。审批与工具来源先显示人话摘要，原始参数折叠到「详情」；同名输出只显示最新版，可展开已经读取的旧版，包括旧格式离线缓存。

## 可重复验证

```powershell
npm run build --prefix apps/mobile-ui
npm run check --prefix apps/mobile-ui
npm run test --prefix apps/mobile-ui
node --test tests/ui-core.test.ts tests/mobile-android-bridge.test.ts tests/mobile-ui-core-assets.test.ts tests/mobile-memory-page.test.ts tests/design-tokens.test.ts
node --test tests/personal-mobile-ui-release.test.ts tests/mobile-offline-ui-core.test.ts
npm run typecheck
node tests/integration/ui-3m-mobile-queue.mjs
# 配置已安装的 Java / Android 工具链环境后：
Push-Location apps/android
gradle --offline -I ../../tests/evidence/ui-3m/isolate.gradle :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest --console=plain
Pop-Location
node tests/integration/ui-3m-mobile-queue.mjs --device
```

交互测试按可见名称、角色和语义区域定位。`queue-interactions.test.mjs` 验证默认插话、切换新任务、编辑回填、409 竞争提示和停止入口、最新版与旧版、工具摘要 / 折叠详情、旧格式离线缓存去重。实际执行验收通过 Playwright（界面自动化工具）启动真实 WeftMate 主程序、个人宿主及固定 DSH（助手运行时），电脑窗口仅用于创建隔离账号 / 模型和初始任务、读取服务回执；其余手机动作在 Chromium（浏览器引擎）390×844 与 MuMu（安卓模拟器）真实 `HybridActivity` 完成。

MuMu 使用独立 `com.memoweft.weftmate.mobile.ui3mqa` / `.test`。装包前核对 WeftMate 包清单与运行进程，结束卸载本次两包并移除本次随机端口的 ADB（安卓调试桥）正向 / 反向映射。`Ui3mWebViewProbeTest` 只在显式 `ui3mProbe=1` 与这一独立包下打开 CDP（浏览器调试协议），结束关闭调试。实屏点击使用名称 / 角色定位所得坐标与 `adb shell input tap`；字段输入与选择通过实际字段事件填写。没有替换原生桥、网络响应、Cookie（会话凭据）、CSRF（跨站请求伪造防护）或回执流程。原生发送回执尚未确认时，通过产品「检查状态」核对原请求，确认 requestId（请求编号）未变。

## 结果与截图

| 验证 | 结果 |
| --- | --- |
| 手机 build / check / test | 102/102，生成副本逐字节核对通过 |
| 共享功能、手机桥 / 资产 / 记忆、设计令牌定向根测试 | 69/69 |
| 手机离线与不可变界面发布回归 | 4/4 |
| Android JVM（Java 虚拟机） | 27/27；独立 debug APK（调试安装包）与设备测试包构建通过 |
| 类型检查 | `npm run typecheck` 通过 |
| Chromium 与 MuMu 实际执行 | 见 `chromium-verification.json`、`mumu-verification.json` |
| MuMu 清理 | 见 `mumu-cleanup.json` |

每端均核对实际服务事件：插话的 `rootTaskId` 为原任务；两条排队的 `task.started` 顺序为原任务、第一条、第二条；取消任务、编辑前旧任务及再次取消的编辑任务没有 `user.message` 且不执行；停止原根任务后排队继续。每次询问模式下真实 PowerShell（命令环境）删除系统临时目录中的合成文件，允许后文件消失，拒绝后文件保留；允许 / 拒绝回执均读取并核对。

`chromium-*.png` 为390×844截图；`mumu-*.png` 为 `adb exec-out screencap -p` 获取的完整720×1280实屏，保留系统状态栏。每端均有浅 / 深色的 `queue`、`steer`、`completed`、`approval-allow`、`approval-deny`、`source` 六组截图。排队区滚动只作用于卡片，数量摘要始终可见。

原生最小接线包含：发送 `intent`（发送意图）；活动投影保留 `receiptId` / `taskLabel`，供共享插话标签与任务关联使用；错误保留 HTTP（网络协议）状态供409竞争文案使用。Android code20 / 0.8.7 与发布器最低原生版本同步，防止旧壳忽略意图却装入这套界面。

界面机械检查的两项告警来自既有隐藏图片预览和已被后续规则覆盖的引用边框；新增样式全部使用现有设计令牌。截图检查确认排队摘要、审批操作与全屏来源没有横向溢出。

所有宿主、模型与账号使用随机端口、系统临时目录和合成数据。合成模型控制流只用于验证执行机制，不代表 MiMo / Qwen 的模型能力；没有真实模型密钥、日用宿主数据、本人手机、生产发布或新增权限。实体手机、离线跨设备目标队列、长期稳定性不在本包验收内。完整测试交本包 PR（拉取请求）的 CI（持续集成）。
