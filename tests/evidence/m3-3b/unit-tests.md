# macOS相关定向验证

没有重跑第一步的全量required；完整Windows/Linux/macOS CI按派工交Claude，不等待检查。

| 范围 | 结果 |
|---|---|
| 最终无Electron单测：mac-desktop、desktop-config、desktop-autostart、desktop-quit、credential-vault-document、auth-1-desktop、windows-package-policy | 28通过，0失败，0跳过，约1.9秒 |
| 上述相关范围＋personal-desktop-ui（含原有窗口回归） | 31通过，0失败，0跳过；最终配置后一次约39秒。此前初稿另一次约41秒也31通过，分别保留本地日志，不合并计数 |
| vendor-cache-safety，只选择staging refuses parent junctions/source overlap/interrupted-copy这一项；新增excluded .bin symlink与live-link反例 | 1通过、0失败。初版测试digest不接受自身排除链接，修正测试步骤后通过；没有允许运行文件链接/削弱缓存不变性断言 |
| typecheck | 通过；最后GPU/readonly块只增设置/注释，语法检查也通过 |
| vendor verify / Mac完整资源审计 / codesign deep strict | 均通过，固定pin+补丁与195实际安装闭包；最终审计零违规 |
| 最终打包主路 | desktop.json completed=true，2次串行启动；18张1200宽窗口图，手机4张；真实shell/read/write/审批/记忆/Command+Q/6个观察进程退出/重开记忆API通过 |
| Keychain | keychain.json completed=true；4次串行，真实临时OS钥匙串，无mock；跨临时签名不可读与重填恢复如实记录 |

执行偏差必须保留：已有`personal-desktop-ui`回归被两次执行，每次内部4次Electron，入口`app.disableHardwareAcceleration()`，但未带本包要求的显式`--disable-gpu`；两轮各与一次试用/Keychain走查短暂重叠。第二轮试图用负向name pattern排除它，但该现有suite仍执行。后续不再调用该文件；本包自写验收全部显式禁GPU并串行。未出现新增GPU/WindowServer报告或整机重启，不能据此称整个执行过程完全遵守单实例要求。所有iOS模拟器/Xcode UI全程未启用，没有改系统设置、关闭系统崩溃对话框或安装系统软件。

Electron根启动总26次：窗口前隔离库失败2，桌面失败夹具7，最终整批成功两轮共4，Keychain eval失败1＋成功4，已有UI回归8。Node形式的DSH子进程不另算一次桌面启动。最终资料/子进程已清理；磁盘开始约16GiB、最低观察约13GiB、结束约15GiB，未到8GiB停止线。
