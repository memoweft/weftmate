# 健康底座验收

全部健康数字来自固定种子的 [合成生成器](../../helpers/health-sequence.mjs)。使用独立账号、临时目录和随机端口；没有读取或复制本人健康截图中的数值，没有访问日用程序与数据，也没有向18186发请求。

最新完整真实 Electron（桌面程序框架）验收见 [verification.json](verification.json)：90天批量写入、全部指标序列、月历、统计版和MiMo（云端模型）今日解读、主对话原生 `health_query` 调用及依据数字回答、关闭开关后不再请求健康模型，均通过。本轮5次MiMo请求，其中今日健康解读1次；请求数按实际云端请求开始事件计数，密钥只在进程内使用。早期完整通过轮另为4次；调试轮计数保存在 `trial-*.json`，不把这些轮次说成完整通过。已落盘的两轮通过加七轮调试累计23次；最初两轮在修正计数落盘前退出：其中一轮已在过程里核对为2次，另一轮没有完整持久计数，因此不宣称所有调试的总请求数完整。

| 证据 | 内容 |
|---|---|
| [浅色主对话](electron-1200-light-assistant.png)、[深色主对话](electron-1200-dark-assistant.png) | 1200宽真实程序，提问“我最近睡得怎么样”，原生工具查询后回答 |
| [浅色设置](electron-1200-light-settings.png)、[深色设置](electron-1200-dark-settings.png) | 健康四项设置与回顾同页，沿用统一控件 |
| [480浅色](electron-480-light-settings.png)、[480深色](electron-480-dark-settings.png) | 窄程序窗口布局 |
| [浅色保留期菜单](electron-1200-light-retention-open.png)、[深色保留期菜单](electron-1200-dark-retention-open.png) | 已打开菜单，90／180／400天／一直 |
| [浅色清空确认](electron-1200-light-clear-open.png)、[深色清空确认](electron-1200-dark-clear-open.png) | 已打开统一确认框，测试未删除日用数据 |

安卓使用独立 `com.memoweft.weftmate.mobile.health2qa` 包、真实原生业务传输与合成账号。`BusinessRouteUnitTest` 17项、0失败／0跳过，调试包及测试包构建通过。原生实际读通概览、30天睡眠序列和月历，健康设置加载成功；证据见 [native-verification.json](native-verification.json)。测试包均已卸载，端口映射已删除，ADB（安卓调试桥）已断开。

**安卓完整系统栏实拍未通过**：当前MuMu（安卓模拟器）设备为Android（安卓）15，系统深色；读到 `qemu.hw.mainkeys=1`，底部导航区域高度为0。保留的 [原始浅色帧](android-light-settings.png) 能核对设置内容，但不能当作含底部导航栏的整屏通过证据；没有伪造导航栏或修改模拟器启动配置。[AOSP（安卓开源项目）的窗口策略](https://android.googlesource.com/platform/frameworks/base/%2B/1850ba18fa20/services/core/java/com/android/server/wm/DisplayPolicy.java)说明此属性会关闭系统导航栏。需要在具备系统导航栏的测试设备补拍浅／深设置、菜单和确认框。这是环境遗留，页面包与苹果采集不在本包。

确定性口径、缺项处理及医学边界见 [HEALTH.md](../../../docs/HEALTH.md)。完整必过、固定运行时、手机五文件、类型与公开卫生的最终计数由交付报告登记；首次完整组的令牌上限回归已修复，原有断言没有放宽。

最终完整必过：313文件、1762通过／0失败／14既有跳过，详见[正式计数](required-unit-tests.json)。采用CI（持续集成）同样的单文件顺序执行，原断言与既有排除清单未改；两轮本地双文件并发中的旧浏览器探针原生退出0xC0000409，单独与最终完整顺序轮均通过。固定运行时232／0，手机五文件113／0，相关38／0。
