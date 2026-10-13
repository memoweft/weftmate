# APPLE-6 · iPhone 独立使用与 16 Pro 问题修正

PR：https://github.com/memoweft/weftmate/pull/273 。全部账号、邮件、电脑数据和模型回复为合成数据；未使用本人账号、电脑、线上云或真实模型密钥。

## 当前交付

没有电脑的新账号进入完整五项导航；聊天页原地配置手机模型。密钥存在 ThisDeviceOnly Keychain，对话 AES-GCM 加密并按云地址/subject 隔离。真实 SSE、停止、重新生成、复制和模型增改删已实现。手机健康页能授权读取本机日汇总；电脑分数、解读、动态、目标、成果和记忆说明连上电脑后可用。电脑设置说明如何添加电脑。

A14 已接 M3-A，本包补齐独立手机回合进入现有加密队列的桥接。冻结稳定回合编号及正文、幂等回执、授权/清理代次核对；旧代次清理已交给电脑的内容，未交出的独立新对话保留。电脑仍需具备可同步的云模型和既有 M3-A 接口。手机对话在设置可重开；回执只称已同步，不等于正式记忆形成。

输入行的模型/操作模式只显示图标；`slider.horizontal.3` 是默认 SF Symbol，候选放大图见 [mode-icon-candidates.png](mode-icon-candidates.png)。统一 44 点点击范围、图标尺度、圆底；图片/文件的关闭按钮共享同一半透明圆底。侧栏保留五项，未选中项透明，只给当前项/对话淡底，统一背景、分组标题、图钉/未读点和遮罩；底部导航与登录方法选择也只给当前项底色。

健康两列等宽、分数/年龄/心率/HRV 取整、单位小号，六卡按标题/状态/数字/条排列，电能曲线无坐标刻度，不足两点不画。健康状态文字使用令牌 healthRecovery，浅色与卡底对比度 5.61:1。睡眠以设备本地时区显示，缺少电脑使用数据时不显示“0 分钟”；顶栏不透明。PDF 打开前清除输入焦点，显示加载，按需逐页用 Core Graphics 绘制；原件完整保存/分享。

“昨晚睡了 466 分钟”由电脑端 `src/personal-health/insight.mjs:17` 生成，分数依据还涉及 `src/personal-health/analysis.mjs:62`。iPhone 没有替换整句字符串，交电脑端改为小时/分钟。

## 不需要模拟器的最终证据

- Swift Testing：490 项通过，3 个依赖外部环境的用例跳过；完整套件无失败。
- 17 组状态检查通过，见 [post-reboot-state-checks.json](post-reboot-state-checks.json)。其中 PhoneStandaloneModelChecks 编译/执行实际 iPhone 聊天模型源码，只替换账户上下文及凭据存储，使用本机 HTTP/SSE：23 条断言、HTTP 5、SSE 4、正文/密钥磁盘明文 0 命中；不使用云、系统 Keychain、GUI 或模拟器。
- 该状态程序覆盖配置测试/保存、第一片先于完成、完整流式、停止丢弃迟到片段、重新生成替换回答、重开恢复、换账号隔离、模型修改/删除、电脑未准备好不提前登记、本机回合进入队列、回执确认、删除代次清理。
- 69 处回调隔离零失败；9 项文案/回调测试通过；114 个浅深颜色解析通过；设计令牌与电脑提供方预设生成检查通过。
- iPhone/Watch 使用通用真实设备 SDK、Mac 使用本机 SDK，均 `xcodebuild build -jobs 4 -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO` 通过。没有启动 App 或模拟器。构建顺带修复共享代码的 watchOS arm64_32 整数溢出，64 位仍保留 JS 安全整数上限，JSON 超本机范围返回空值。
- 原生注册/邮箱码/PKCE/DPoP 使用真实本机合成云流程。旧无电脑入口重放只有“电脑没开或没联网”和重试，没有五项导航。完整 UI 流程未通过，不把状态程序当成像素/真机验收。

## 原图清单与分类

所有文件均保留原始字节、按 SHA-256 记录；[screenshots.json](screenshots.json) 是逐图检查、尺寸与分类清单。有效手机原图 9 张（有重复场景/两种取图来源），都是 1206×2622 并带状态栏；另外 21 张列入 failed/attempts/partial，图标候选单独为 960×320。

- [apple6-baseline-no-computer.png](apple6-baseline-no-computer.png)：旧入口重放，电脑不可用壳，没有五项导航。
- [simctl-boot-2/baseline-no-computer.png](simctl-boot-2/baseline-no-computer.png)：同一旧入口的独立取图。
- [apple6-dark-registered-no-computer.png](apple6-dark-registered-no-computer.png)：深色无电脑完整应用，模型设置与五项导航可见。
- [simctl-boot-2/dark-registered-no-computer.png](simctl-boot-2/dark-registered-no-computer.png)：上述深色画面的独立取图。
- [simctl-boot-2/light-connected-composer-expanded.png](simctl-boot-2/light-connected-composer-expanded.png)：模型/操作模式图标、软件键盘与展开输入区。
- [apple6-light-connected-attachments-keyboard.png](apple6-light-connected-attachments-keyboard.png)：图片/PDF 双附件，两个关闭圆底可辨，输入行和键盘。
- [apple6-light-attachments-before-query.png](apple6-light-attachments-before-query.png)：同一双附件布局，AX 查询前取图。
- [simctl-boot-5/light-connected-attachments-keyboard.png](simctl-boot-5/light-connected-attachments-keyboard.png)：双附件的独立取图。
- [simctl-boot-5/light-attachments-before-query.png](simctl-boot-5/light-attachments-before-query.png)：双附件 AX 前的独立取图。

这些是运行中已取得的历史原图；账号切换/焦点/健康/侧栏最终修正以后没有重拍。不能用它们声称完整最终 UI 已验收。失败与旧尝试逐项原因见 [rejected-frames.json](rejected-frames.json)：全黑无状态栏、1×1 占位、系统键盘提示、错屏、白色破块、仅输入行绘出、旧 activate 调试文案。

## 没能在模拟器里看到、要本人真机确认的

| 屏幕/状态 | 代码已做与依据 | 真机要确认 |
|---|---|---|
| 新账号登录后进入完整应用，浅/深 | Root/PhoneWorkspace 不按电脑门禁；真实合成注册完成；深色历史原图 | 浅深最终画面、无错误登录提示、五项可点 |
| 模型预设→密钥→测试→保存 | 与电脑文案自动生成；实际手机模型源码状态程序连接/保存通过 | 密钥输入、测试完成提示持续显示、菜单可用 |
| 第一条流式回答、停止、重新生成、复制 | 实际源码 HTTP/SSE 4 次、迟到响应隔离、完整回复/替换通过；复制赋值读取同一消息正文 | 屏幕确实逐片更新、停止按钮、复制到系统剪贴板 |
| 杀掉重开后对话/模型仍在 | 同一加密目录与凭据重建模型通过；Core 账户隔离/篡改检测通过 | 实际 iOS 强杀/恢复、系统 Keychain |
| 设置中模型改/删，设备说明、记忆说明 | 模型修改/删除/重开状态程序通过；设置路由代码走查 | 页面点击、删除后的模型菜单、设备列表 |
| 动态/目标/成果库空状态 | 无电脑直接用空状态，不发电脑请求；入口连到设备设置 | 文案、间距、底部导航/当前项 |
| 本机健康未授权/无数据/已有汇总 | DailyHealth 按手机账号隔离，直接读本机汇总；原有日汇总单测通过 | 真实 HealthKit 权限、缺数据说明、已有测量 |
| 健康两列卡片/取整/单位/六卡等高/曲线/顶栏 | Core 格式与时区回归、令牌解析、flexible 两列、统一结构与不透明顶栏 | 402 点右缘、长标签、大字体、滚动顶栏、最终浅深像素 |
| 睡眠当地时间与电脑使用缺失 | DateFormatter 显式 current；中美时区单测；电脑数据非正值不显示 | 本人时区与真实 HealthKit 睡眠段 |
| 设置首页零费用 | PhoneCurrencyText 零/两位小数单测；账户用量条改用同一格式 | 首页 ¥0、无六位小数 |
| 输入行收起/展开、模型菜单勾选、审批模式菜单 | 44 点统一控件、SF 图标、原生 Picker/勾选、读屏模型名；旧局部原图 | 最终菜单、深色附件圆底、大字体、语音/发送强调 |
| PDF 首帧加载/正文、键盘收起/关闭不恢复、保存分享 | 清除 FocusState 请求在打开前发送；按页加载/绘制；三个目标编译通过 | 最终首帧、所有页、焦点、系统分享/保存 |
| 侧栏、分组/置顶/未读、遮罩与左滑关闭 | 一种背景/行样式；当前项淡底；底部导航保留；后台内容禁点/隐藏 | 浅深不透控件、选择正确、搜索/新建与点击手势 |
| 以后连电脑同步、正式记忆形成 | 实际手机模型同步状态程序与 Core 加密队列/幂等测试通过 | 真实电脑首次连接、M3 准备、完整同步→Core 形成 |

## 深色全黑与系统中断的结论

证据支持取图/模拟器渲染链路问题，没有证据支持应用存在深色全黑遮罩：深色完整应用能正常取图；浅色 PDF 同样返回无状态栏的全黑帧；simctl 有时得到旧菜单/白色破块而 AX 已有文件页；第六批截图 RPC 超时，返回 1×1 占位。第五批 3 次 Intel GPU Hang，第六批再有 GPU/WindowServer 看门狗与 backboardd 报告，Mac 时间 19:31 整机重启一次。不能据此声称定位到了某一条 Apple 私有截图 API 的内部故障；最终真机仍须确认。

必须保留的报告名为 `Kernel-2026-10-12-193226.panic`（Claude 提供）与 `backboardd-2026-10-12-192640.ips`。台账见 [simulator-ledger.json](simulator-ledger.json)，报告摘要见 [post-reboot-system-reports.json](post-reboot-system-reports.json)，机器名已打码。未发现新增 WeftMate 产品崩溃报告；XCTest 自身有断言/截图失败记录，不能称 UI 全过。

共 6 次、只用后台 16 Pro，重启后没有第七次、没有 UI 测试或再取图。重启后先提交并推送已有证据，冷却 5 分钟再编译。20:00 构建期间还出现一份 gpuRestart，但没有再次整机重启或设备启动；最终模拟器全部关机。未修改系统/模拟器设置，未关闭崩溃对话框。
