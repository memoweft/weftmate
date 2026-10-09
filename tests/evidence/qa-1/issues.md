# QA-1 问题清单

结论：**不建议本人开始试用**。以下是本次实际观察到的问题；“待定位验收阻断”与“已复现产品行为”分开。没有修改产品代码，也没有代替 Claude 合并修复。

## 阻断 · QA1-01 · 新云账号成为受限聊天账号，不能让电脑办事

- **端**：Windows 宿主 + Android 原生客户端；其他客户端依赖同一宿主路径，但本次未直接验证其失败。
- **步骤**：全新临时宿主启动真实 `main.mjs`；在 MuMu 独立包注册合成云账号；电脑登录同一账号、自动绑定；电脑批准手机，手机接收可信交付并连接；配置 MiMo；创建该账号的电脑会话；手机要求在 `C:/Temp/qa1-phone-<UUID>.txt` 写入 `QA1_PHONE_EXECUTED`。
- **实际**：两个独立合成账号均未创建文件，审批出现次数均为 0。MiMo 表明只有提醒工具，缺少 `pwsh` / 文件写入工具；第一次实际尝试过 11 个工具步骤。设置会话审批模式返回 404。两次收集窗口为 193.172 / 193.564 秒。
- **期望**：该电脑上的首次云账号完成绑定后，可以作为本人执行账号使用完整通用工具；已批准手机可以发任务，由电脑执行并在手机审批。不能要求普通用户自行“启用 weftmod”。旧本地账号绑定必须继续保留原归属，不以修复新账号为由迁移别人的数据。
- **证据**：[第二次完整结果](android-task-recheck/phone-task.json)、[真实安卓截图](android-task-recheck/android-task-timeout-light.png)、[HTTP 请求状态](android-task-recheck/android-visual-verification.json)。第一次原始结果在 `android-task/`，含本机用户目录的原截图留在私有临时证据目录，公开使用 `C:/Temp` 的再次复现。
- **初步定位**：`src/personal-cloud/index.mjs` 的 `/auth/cloud-desktop` 为新身份调用 `registerAccount` 分配独立 owner；`src/main.mjs` 将 `legacyOwnerId()` 传给后端；`src/personal-access-backend.mjs` 的 `presetForOwner` 仅给 legacy owner `personal-remote`，其他 owner 进入 `personal-shared-chat`。现有“不认领他人旧数据”的隔离规则合理，但空白新宿主执行归属没有在这条新用户流程接通。此为源码支持的定位，未修改实现。

## 严重 · QA1-02 · 手机已有完整回复，仍提示发送未确认且保留可重试草稿

- **端**：Android。
- **步骤**：沿 QA1-01 的真实已批准云设备流程，在电脑会话发送一条任务，等到助手回复完整出现。
- **实际**：回复正文已经显示，同时仍出现“执行进展暂时无法读取”“发送结果待核对”“发送未确认，草稿已保留”，输入处和对话里保留原请求及重试操作。`/personal/v1/tasks/<commandId>` 返回 404；历史事件接口返回 200。两次均复现。
- **期望**：已接受并有实际回复的消息应有一致的发送确认；若这类会话没有任务能力，应明确说明，不能无期限要求本人核对一个不可读取的任务。重试风险应由修复包检查；本次没有点击重试，因此不声称已经产生重复副作用。
- **证据**：同 [安卓结果](android-task-recheck/phone-task.json) 和 [截图](android-task-recheck/android-task-timeout-light.png)。
- **初步定位**：QA1-01 的会话预设 / 任务能力错配，加上 `apps/mobile-ui/www/components/chat.js`、`src/ui-core/adapters/mobile.js`、`apps/mobile-ui/www/components/sessions.js` / 原生命令回执路径的任务查询和未确认状态投影。具体状态转换仍需定向定位。

## 严重，归因待复核 · QA1-03 · 连续新建 / 发送后，停止控件多次超过 12 秒才可用

- **端**：Windows 真实 Electron + DSH。
- **步骤**：隔离旧本地账号、合成单槽流式模型，连续 30 分钟执行新建对话→发送→每三轮停止→切换。单条合成输出持续约 17.5 秒。
- **实际**：54 轮中 18 轮等待“停止回复”超过 12 秒；后半段集中发生。失败图有“正在回复…”却尚无可操作停止按钮、或“这轮对话尚无结束记录”的中间状态；有的截图拍下时停止按钮才出现。成功轮首条显示中位数 2.05 毫秒。主进程没有崩溃，事件循环 p99 为 31.212 毫秒。
- **期望**：任务一旦已受理运行，停止状态应及时可见可用；不应让本人等到流式过程将结束才有控制入口。
- **证据**：[逐轮结果](desktop/results.json)、[第36轮](desktop/failure-39.png)、[第38轮](desktop/failure-41.png)、[稳定性数字](stability-summary.json)。
- **初步定位 / 限制**：`src/ui-core/composer.js` 的运行状态依赖会话投影，`src/personal-access-ui/components/shell.js` 将它映射为发送 / 停止按钮；需核对会话创建回执、轮询刷新与任务状态。合成模型虽返回 `/props.total_slots=1`，没有实现 `/switch/status`，后台日志有 `MODEL_QUEUE_UNAVAILABLE`；同期其他 QA 进程在运行。因此这是**已复现的验收失败，不是已经证明的生产模型根因**。修复包先用完整本地状态夹具复核，不凭本报告增加限次或防御层。

## 一般 · QA1-04 · MiMo 整理文件额外要求审批，原办事场景失败

- **端**：Windows / MiMo。
- **步骤**：运行原 `action-01-organize`：仅整理合成收件箱，按扩展名移动文件，保留“不要动”目录。
- **实际**：30.242 秒出现原场景没有声明的审批，运行器保留失败并取消；同题 LAN 78.854 秒通过。没有为了通过率自动批准或改原题。
- **期望**：已明确授权的合成整理任务应按原验收约定完成；如具体命令确需审批，应检查模型选用命令及风险解释是否过宽。
- **证据**：[MiMo 原题与事件](m1-mimo/results.json)，第一个结果 `approval.requested`；[LAN 对照](m1-lan/results.json)。`mimo-action-01-organize.png` 为当时主窗口概览，未选中该 API 驱动会话，**不是审批卡特写**。
- **初步定位**：DSH 原生审批判定与模型选用命令；本次证据不足以认定宿主代码错误，先作为模型行为 / 审批可用性问题派查。

## 体验 · QA1-05 · 网页搜集并成文虽然完成，但等待约九分半

- **端**：Windows / MiMo。
- **步骤**：原 `action-02-web-document`，搜网页、总结并保存文件。
- **实际 / 期望**：结果检查通过，但总耗时 565.791 秒；本人应能理解当前进展和耗时来源，普通成文任务需进一步检查工具 / 网络等待。没有人为缩短原题或把未完成当成果。
- **证据**：[逐回合和工具事件](m1-mimo/results.json)、[请求时间](m1-mimo/requests.jsonl)。
- **初步定位**：优先按实际工具事件 / 模型请求拆分耗时，不将全部时间归因于前端或 MiMo。

## 待定位验收阻断，不能视为已确认产品缺陷

1. **Mac 登录后场景未验通**。本机隔离云 / 宿主，`run_a9_mac.py` 和 `run_a5_mac.py` 只得到登录页；设置捕获器抛 `NSCocoaErrorDomain Code=256`。重编捕获器、重建 Mac 程序后相同。原生辅助功能备用入口明确返回“Existing host Accessibility permission is unavailable; no grant was requested.”，没有请求新增权限。见 [诊断](apple/acceptance.json)、`apple/mac/`、`apple/mac-retry/`。初步检查 `AppleAppModel.start/authenticate`、测试命名空间 / Keychain（钥匙串）与捕获器；尚未证明是正式用户登录缺陷。所有登录后的 Mac 清单项保持阻断。
2. **iPhone 设置遍历在“关于”失败**。原生测试 155.234 秒报缺少 `settingsPage.about`，当时界面仍在设置分类列表；可访问性树显示“关于”位于屏幕底部附近，可能是旧测试的滚动 / 点击定位问题。见 [汇总](apple/iphone-settings-summary.json)、[实际帧](apple/iphone-settings-about-failure.png) 和 `apple/iphone-failure/`。先核对 `A6SettingsUITests.reveal` / `tap` 与真实可点区域，不能直接断言“关于页不存在”。
3. **实时手表审批及完整中继未完成**。只按规定最后单独开一台 Watch，合成审批可见、手机不可达时按钮禁用；没有伪造手机可达或审批成功。云测试使用本地身份服务和直接回环 / ADB 反向映射，没有接完整本地 frp 数据链路。原生跨端任务又被 QA1-01 阻断。完整链路须在修复包后补验，不能引用 UP-2 历史结果替代本次通过。

## 已补测，不再列为当前失败 · QA1-06 · 默认即时记忆

MF-1 未合并时，原三题 1/3，纠正后的周五被回答成周六，刚说明的阿岚 / 海报 / 展览背景在新对话没采用。原件完整保留在 `immediate-mimo/`。

结束前确认主干已包含 MF-1，同步 `c3d07f8`、使用固定 Core `cb10a16`，默认零等待、原三题重新运行：**实际回复 / 语义 3/3**；旧综合检查 **2/3**，第一题的 `memory_used` 要求正式对象，近期原话不计正式对象，故保留失败。纠正与人物题综合检查均通过，见 [补测](immediate-after-mf1/results.json) 及截图。不替 MF-1 重写旧判据，也不将旧正式对象失败描述成当前仍未记住偏好。

## 出口、用量与交接数字

- M1：MiMo 5/6；LAN 按要求抽测 3/3。缺完整本地六题与 Android / iOS 跨端审批，因此完整 M1 出口未通过。
- M2：王小明 8/8；MF-1 后即时三题行为 3/3、旧正式对象检查 2/3。没有重新跑完整本地记忆四题与经验加速，完整 M2 出口未重验通过。
- 稳定性：1,809.401 秒；p99 31.212 ms、最大 215.089 ms；RSS 增长 62.566 MiB；54 轮 36 通过 / 18 等待超时；后段 520.167 秒 147 次实际 store 原子替换，16.956 次/分钟。全程 880 次文件系统通知不等于写盘次数。日志正文 / 密钥扫描无命中。
- MiMo：182 请求，178 完整用量、4 缺用量；已知输入 3,498,767 / 缓存 386,368 / 输出 48,610 token（词元）；按[官方价格](https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash)估算下界 ¥3.21734636。含额外 action-07 的取消运行，不是账户账单。
- 清理：已清理进程：7 个（初期运行器树按 PID 确认强制结束）；其余本包宿主、模型夹具、Electron 由运行器正常退出，未将未计数的子进程编成总数。安卓测试包和模拟器已关闭；Mac 模拟器全部 shutdown，未动开工前既有 CoreSimulator 服务。逐项记录见 `cleanup.json`；没有访问日用 18186 / 8081、没有改产品代码或生产配置。
