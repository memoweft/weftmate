# A14 · iPhone / Mac 电脑离线聊天

所有账户、记忆、对话与模型响应均为合成数据。实现沿用 CLIENT_API 3.19；不新增云正文存储或电脑任务队列。

## 实现与删除边界

- 共享 Swift `OfflineVault` / `OfflineReplica` 使用 RSA 2048 / OAEP SHA-256（含 MGF1）解开宿主包，AES-256-GCM 使用原始 AAD，认证标签取密文末尾 16 字节。核对账户、宿主、当前会话设备与公钥指纹。Node 测试向量直接调用 Windows / Android 共用的生产 `sealReplica`，私钥只在运行时生成，不提交固定私钥。
- 私钥和本地 AES 内容钥匙使用 ThisDeviceOnly Keychain；归属按稳定宿主 + 账户保存，Cookie 设备编号只用于当前包认证。普通文件仅存密文，排除备份，每次持久保存替换内容钥匙。删除先销毁旧钥匙与文件，再应用新副本；异步响应以代次票据拒绝复活，并取消正在进行的模型请求。Keychain 保存当前副本归属，跨进程切换账户 / 宿主及尚未加载副本时退出也会清除旧钥匙与密文。
- 增量合并 `items/remove/hashes`，完整副本保持 500 项 / 2 MiB 上限；reset、移除与代次变化清除离线历史及待补交。近期云对话可作为有界续聊上下文，其无法追溯的依赖标记为不完整。
- 每轮模型请求前后用原生云 DPoP 核对宿主、账户、代次和授权；控制面不可达时暂停使用。模型只收到最多 8 项 / 6,000 字相关记忆及最近 20 条当前对话消息，无工具。模型密钥停留在原生网络与安全存储层。
- 离线用户消息在请求前加密持久化；稳定轮次 ID、毫秒时间、用户 / 助手消息、引用和完整性补交到原宿主接口。请求采用稳定字段排序，回执丢失重试不改正文。只显示「已同步」，不声称已经形成正式记忆。
- iPhone / Mac 顶部和输入区显示「电脑离线：只能聊天和用记忆，不能操作电脑」。手表收到电脑离线投影时仅显示「电脑离线」，清空可执行审批；手机拒绝离线审批动作。

完全断网时设备无法即时收到远程遗忘；恢复网络后先核对再使用。字节扫描验证应用存储未写入明文，不能证明闪存物理擦除、系统管理员导出或第三方备份的删除。

## 本轮通过项

- Swift 定向 12 项（含参数化撤权分支）：生产 Node 封装互通、篡改 / 错身份 / 旧钥匙拒绝、本机加密与轮换、增量删除与 reset、跨进程换账户清理、云账户 / 代次核对、云不可达不发模型请求、撤权或退出时丢弃迟到回复、稳定轮次与回执丢失重试、相关召回 / 继承依赖、有界 Unicode 回复；原生云状态另验证 DPoP 与恢复账户。
- 宿主 M3-A 离线 7/7、真实云撤权 1/1、Apple 设计令牌 / 中文文案 8/8、单个 AppleContractStateChecks 状态程序通过。未在本地重复全量单测。
- iPhone XCUITest 1/1、0 跳过；Mac 浅 / 深色各通过。10 张原始截图分别覆盖记忆回答、偏好、已同步和遗忘空白状态。
- Mac / iPhone / Watch Debug 编译通过；所有 xcodebuild 串行 `-jobs 2`。末轮覆盖实际宿主关闭、中继返回 503 的情形，云控制面独立保持可达；此前断流路径也通过。
- 应用字节扫描结果见各平台 `storage-scan.json`：测试正文和本轮随机模型密钥均 0 命中。完整仓库 CI 由 PR 检查提供。

## 复现

```sh
swift test --package-path apps/apple/Packages/WeftMateCore --jobs 2 --filter 'OfflineTests|offlineStatusUsesNativeDPoPAndRestoredAccount'
TMPDIR=/private/tmp node --test tests/personal-offline.test.ts
node --test services/cloud/test/offline-control.test.mjs
python3 apps/apple/Scripts/run_state_checks.py --check AppleContractStateChecks --artifacts /private/tmp/a14-state
python3 apps/apple/Scripts/generate_project.py
```

用 `xcodebuild -jobs 2 -parallel-testing-enabled NO` 串行构建 `WeftMateMac` 和 `WeftMatePhone`（后者包含 Watch）。`Tests/run_a14.py` 使用独立夹具启动真实个人宿主 HTTP 和真实云授权，读取现有批准设备会话；双重 Debug 开关和字面回环地址限定测试注入。批准会话和云状态回调与 M3-A 验收方法一致。正常应用仍通过 `CloudAccountClient.offlineStatus` 生成 DPoP，该路径有独立 Swift 测试。

```sh
swiftc -parse-as-library apps/apple/Tests/A5MacCapture.swift -o /private/tmp/a14-capture
python3 apps/apple/Tests/run_a14.py --platform mac --theme light --capture /private/tmp/a14-capture --app <Debug应用可执行文件>
python3 apps/apple/Tests/run_a14.py --platform mac --theme dark --capture /private/tmp/a14-capture --app <Debug应用可执行文件>
python3 apps/apple/Tests/run_a14.py --platform iphone --xctestrun <本次构建的xctestrun> --simulator <独立模拟器ID> --result <新xcresult路径>
```

iPhone XCUITest 走在线加密同步 → 真正关闭宿主 → 依赖副本回答喝茶偏好 → 新增背包偏好 → 关闭并重开 App 恢复加密历史 → 重启原宿主 → 回执显示已同步 → 遗忘推进代次 → 副本和历史消失。Mac 浅 / 深色运行同样的网络和存储链路，并捕获自身原生窗口，不截取其他程序。

## 证据与未覆盖项

各平台子目录的 `validation.json`、`host-report.json`、`storage-scan.json` 与原始 PNG 为本轮结果。iPhone 扫描整个独立模拟器 App 数据容器；Mac 在删除测试命名空间前扫描本次 App 本机状态文件，覆盖 UTF-8 / UTF-16LE / UTF-16BE 的测试正文与实际随机模型钥匙。

Mac 没有 Windows Machine 环境变量，本轮模型为确定性 HTTP 替身，未调用真实 MiMo、未产生供应商用量。Core 查询与摄取边界为合成实现；本包证明原生补交及宿主回执，不把它当成真实 Core 正式形成或遗忘级联验收（M3-A 原证据另见 `tests/evidence/m3-a/`）。未验证真机、真实 Windows 宿主、公网中继、生产部署、后台推送或手表真机联通。没有新增权限、触碰日用数据或自动合并。
