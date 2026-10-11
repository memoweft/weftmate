# BL-28a 验证证据

`inlineCompletionEnabled` 默认 `false`，仅控制输入时灰色补全；`nextSuggestionsEnabled` 默认 `true`，仅控制回复后的建议胶囊。存量账户缺少新字段时也返回 `false`，不继承旧开关值，升级后所有尚未主动打开新开关的账户都关闭灰色补全。

只使用合成账户、合成宿主、合成建议响应、随机回环端口和临时目录。真实模型请求为 0。没有连接日用程序、日用数据、保管库、8081、18186 或 16384，没有使用安卓模拟器。

## 请求计数与开关独立性

[ui-checks.json](ui-checks.json) 保存实际界面发出的请求计数。Electron（桌面程序框架）、远程手机网页 360 / 390、共享手机界面 360 / 390 共五个入口，默认打字各为 **0 个补全请求**；主动开启后每次触发为 **1 个补全请求**，Tab（制表键）接受。每个入口都实际点击设置开关验证下面四种组合。

| 下一步建议 | 输入时补全 | 一次回复建议请求 | 一次补全请求 | Tab 接受补全 |
|---|---|---:|---:|---|
| 开 | 关 | 1 | 0 | 否 |
| 开 | 开 | 1 | 1 | 是 |
| 关 | 关 | 0 | 0 | 否 |
| 关 | 开 | 0 | 1 | 是 |

服务端替身同时断言：新字段缺失／关闭时补全空返回，模型调用与用量租约均为 0；关闭对应开关取消对应种类的进行中请求，另一种继续；关闭的补全请求不会打断已开启的回复建议。个性化测试覆盖存量默认值、非法值拒绝、账户隔离和重启持久化。

快捷键面板沿用完整绑定表，补全关闭时仍显示「接受灰色补全」。实际按键仅在新开关打开且灰字可见时接受；设置搜索覆盖「输入时补全」「灰色补全」「Tab」「下一步建议」。

## 截图

桌面使用生产桌面窗口和共享设置组件，由 Playwright（界面自动化工具）驱动隔离 Electron。下列手机图均为 Chromium（浏览器引擎）的网页内容截图：没有系统状态栏、浏览器工具栏、原生底部导航栏，不作为原生壳系统栏／安全区验收证据。

| 来源与视口 | 浅色 | 深色 |
|---|---|---|
| 桌面程序 1200×800 | [设置](electron-1200-light-assistant-settings.png) | [设置](electron-1200-dark-assistant-settings.png) |
| 桌面程序 480×800 | [设置](electron-480-light-assistant-settings.png) | [设置](electron-480-dark-assistant-settings.png) |
| 远程手机网页 360×780 | [设置](mobile-web-360-light-assistant-settings.png) | [设置](mobile-web-360-dark-assistant-settings.png) |
| 远程手机网页 390×844 | [设置](mobile-web-390-light-assistant-settings.png) | [设置](mobile-web-390-dark-assistant-settings.png) |
| 共享手机界面网页 360×780，合成桥接 | [设置](mobile-ui-web-360-light-assistant-settings.png) | [设置](mobile-ui-web-360-dark-assistant-settings.png) |
| 共享手机界面网页 390×844，合成桥接 | [设置](mobile-ui-web-390-light-assistant-settings.png) | [设置](mobile-ui-web-390-dark-assistant-settings.png) |
| 桌面补全关闭时的快捷键面板 | [面板](electron-1200-light-shortcuts-off.png) | [面板](electron-1200-dark-shortcuts-off.png) |
| 远程手机网页 360 的快捷键面板 | [面板](mobile-web-360-light-shortcuts-off.png) | [面板](mobile-web-360-dark-shortcuts-off.png) |
| 远程手机网页 390 的快捷键面板 | [面板](mobile-web-390-light-shortcuts-off.png) | [面板](mobile-web-390-dark-shortcuts-off.png) |

## 前端自查

- [x] 两行使用同页共用自定义开关与行组件，没有新增浏览器原生控件残留。修复共用开关关闭态滑块在手机端缺少颜色回退的问题。
- [x] 控件沿用同页悬停、按下、键盘聚焦、禁用状态；截图保留新开关的聚焦状态。
- [x] 入口只放在既有「设置 → 助手」，没有给输入区增加入口。
- [x] 12 张设置图逐张检查；新增两行没有裁切、重叠或横向溢出。实际控件宽高与同页网页搜索开关相同，间距／字号来自既有设计令牌。
- [x] 开／关状态可见；读取／保存期间禁用、错误保留重试与回滚沿用原组件；保存使用既有轻提示，截图等其自然收起。
- [x] 浅／深、480、360×780、390×844 均验证。说明文字对比度最低 4.89:1，桌面浅／深分别 7.27:1／7.90:1。
- [x] 与同页现有开关、已提交的 ST-1 助手页和 UI_SPEC 6c 约定对照，保持既有层级与密度。当前工作树没有 `ref-products/`，未新增外部产品参照图的直接比对。
- [x] 设置与快捷键面板均有浅／深打开状态截图；没有新增弹层，使用原有统一组件。
- [x] 集中检查后仅修复手机关闭态滑块并重拍确认，没有扩展为全局界面改版。
- [x] 手机证据明确为网页内容，不声称原生系统栏、系统版本或手势条已验收。

## 验证命令与结果

| 检查 | 结果 | 记录 |
|---|---|---|
| `node .github/scripts/ci-unit-tests.mjs required` | 1441 通过／0 失败／14 个既有条件跳过 | [摘要](required.json)、[完整记录](required.txt) |
| `node .github/scripts/ci-unit-tests.mjs vendor` | 204 通过／0 失败／0 跳过 | [摘要](vendor.json)、[完整记录](vendor.txt) |
| 手机交互固定五文件 | 109 通过／0 失败 | [记录](mobile-interactions.txt) |
| 定向六文件，包含新增边界用例 | 45 通过／0 失败 | [记录](related.txt) |
| 控件修复后：手机固定五文件＋生成资产检查 | 114 通过／0 失败 | [记录](mobile-final.txt) |
| `node apps/mobile-ui/src/build-ui-core.mjs` | 51 个共享资产生成并校验一致 | 生成资产检查包含在上述回归中 |
| `npm run typecheck` | 通过 | [记录](typecheck.txt) |
| `node .github/scripts/public-hygiene.mjs` | 0 本机身份命中 | [记录](public-hygiene.txt) |
| 界面机械检查 | 0 命中 | [记录](design-detector.json) |
| 真实界面请求／布局检查 | 25 组检查，12 张设置图，0 页面错误 | [数据](ui-checks.json)、[运行记录](ui-run.txt) |

## 原生端与遗留

苹果端代码未改。接线清单：个性化模型新增 `inlineCompletionEnabled` 并在字段缺失时默认关闭；助手设置拆为独立两行；Mac（苹果电脑）补全请求／Tab 接受与 iPhone（苹果手机）现有接受方式只看新开关，回复胶囊只看旧开关；同一现有设置路径读写并同步，Watch（苹果手表）跟随手机。无新路由。

安卓原生代码未改。既有 `/personal/v1/settings/personalization` 和建议路由已在原生白名单中，字段透传即可；**不需要新路由、不需要新壳版本**，原生／界面默认版本号都未改。

算法、超时、模型选择与灰字生成速度改进留以后的小模型工作包；没有进行真实云端模型速度测试或原生壳系统栏验收。`ref-products/` 未随工作树提供，直接外部图对照未新增。其余本包要求已完成，合主线后的复验与 CI（持续集成）状态写在编排交付报告。

已清理进程：5（本包三次启动的 Electron 主进程和两次 Chromium 主进程均正常关闭；测试运行器回收其子进程，强制终止 0，交付前匹配扫描残留 0）。临时宿主和界面配置目录已删除。

## 合主线后复验

合入 `origin/main` 的 `4627736d`（DIAG-1 与日志备份调整）；STATE 以主线整页为底，仅新增本包状态行与契约行。重新生成手机资产；定向六文件与手机固定五文件共 **154 通过／0 失败／0 跳过**，见 [记录](post-merge.txt)。[类型检查](typecheck-post-merge.txt)通过，[公开身份扫描](hygiene-post-merge.txt)零命中。没有重复运行完整单测，完整跨平台结果由本 PR 的 CI（持续集成）补齐。
