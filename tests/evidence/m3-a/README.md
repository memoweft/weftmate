# M3-A · 离线模式验收

全部为隔离合成账户。真实 Windows（视窗系统）桌面入口、DSH（助手运行时）、MemoWeft Core（记忆核心）和 MiMo；云账号目录在本机 WSL（Windows 的 Linux 子系统），安卓使用 MuMu（安卓模拟器）独立包 `com.memoweft.weftmate.mobile.m3a`。未请求 8081、未接触 18186、本人数据或生产云。

## 已通过的网页闭环

`verification-web.json` 和 `web-offline-memory.png`：电脑上的真人回合形成「咖啡加肉桂粉」正式条目；批准设备同步加密副本；真实关闭桌面宿主后，手机直接请求 MiMo，按相关记忆答对；手机说出「徒步用墨绿色双肩背包」；重启原宿主后补交到 Core 并形成正式条目；新桌面对话采用该偏好。遗忘后扫描 Chromium（浏览器引擎）整个隔离配置目录的 UTF-8 / UTF-16（文本编码）文件字节，测试正文和实际模型密钥零命中。

`web-synced-after-forget.png` 与 `android-synced-after-forget.png` 为清理后的同步状态。`synthetic-web-offline.png` 使用同一组件与加密代码、合成模型响应，验证输入与回显；不计入真实模型证据。

## 验证命令与范围

- `node --test tests/personal-offline.test.ts`：封装加解密、篡改／错身份拒绝、权限和来源摘要过滤、增量移除、相关记忆选择、撤权清空、旧代次拒绝、补交幂等、同宿主跨云账户授权拒绝、Core 时间戳及 Cookie（会话凭据）续期保持物理设备身份。
- `m3-a-core-forget.mjs`：在上述隔离世界的副本中，真实 Core 接收带记忆依赖的离线助手回复；遗忘后历史和磁盘均不含衍生回复标记，见 `core-forget.json`。无付费模型；`WEFTMATE_M3A_SOURCE_PROFILE` 指向本包隔离验收目录，禁止日用目录。
- `node tests/integration/m3-a-offline.mjs`：真实桌面与网页闭环；`--android` 使用原生加密层、网络层、界面包和通过 ADB（安卓调试桥）映射的本地 TCP（传输控制协议）中继夹具。
- 云 `offline-control.test.mjs`：真实 DPoP（设备密钥持有证明）、成员／设备隔离、代次单调性、电脑离线时设备撤销；在现有 WSL Node 环境运行，避免 Windows 目录同步落盘的既有夹具限制。
- Android（安卓）`M3aOfflineVaultTest` 验证 Keystore（系统密钥库）包裹设备私钥、模型凭据不出原生层、磁盘无明文及销毁旧钥匙后无法解密旧包。`verification-android.json` 已通过相同真实 MiMo 全链路，原生屏幕见 `android-native-offline-memory.png`，4,501,504 字节存储扫描零命中。

账户批准由真实云和宿主 API（应用接口）完成；自动化为界面提供已批准的测试会话与真实云授权检查回调，未操作真实邮箱。中继是本机合成 TCP 转发，不把它称为生产 frp 或公网部署验收。模型供应商收到测试问题与相关记忆；云目录不持有正文。iPhone 原生、S7 电脑任务、后台推送和生产部署不在本包。

安卓硬件 RSA（非对称算法）路径在 MuMu 的 OAEP（最优非对称加密填充）掩码参数上失败，最终使用不可导出的 Keystore AES（对称算法）钥匙包裹 RSA 私钥，保留标准 SHA-256（摘要算法）封装，适用于现有最低安卓版本。网页保留不可导出的 WebCrypto（浏览器密码接口）密钥。

离线模型用量与宿主账户用量记录在结果 JSON；费用采用宿主既有价格配置。完全断网的手机无法即时收到远程删除，恢复网络后先核对并清理；应用字节扫描不声称能够控制闪存磨损均衡或用户自行导出的备份。

完整记录边界见 `usage.json`：开发及验收宿主25次请求（1次无供应商用量），已知54,949 token（词元）；最终网页／安卓直连4次共1,101 token。另记早期直连1次166 token，前期3次直连调试未保留供应商用量，不将已记录金额称为完整账单。
