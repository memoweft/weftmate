# ST-4 数据与存储验收

全部内容来自合成账号与系统临时目录；宿主、模型替身、调试转发使用随机端口。没有操作日用程序、日用数据、8081、18186 或真实系统保存对话框。程序保存框由测试替身返回合成路径。

## 行为证据

- `native-checks.json`：真实 Electron（桌面程序框架）、DSH（助手运行时）、MemoWeft Core（记忆核心）与两个合成账号。真实原生对话 → 占用 → 保存位置替身 → 带哈希清单的导出 → 删除后对话／成果／用量为空 → 重启仍为空 → 本机注销，B 账号文件哈希与身份保持。聊天模型为随机端口的合成服务，不称为真实模型质量验证。
- `core-checks.json`：Core 正式 Portable v4（可携带记忆格式）导出、正式导入规划校验；正式删除命令及存储清理完成后清账号副本。证据、四类正式对象、召回为空，重启不复活，B 固定导出时间后逐字不变。另验证删除设置／凭据后 Core 能以只读方式打开真实空库。
- `statistics-benchmark.json`：2 GB（吉字节）、50,000 个非稀疏合成文件，统计 6.416 秒；宿主事件循环 p99（第99百分位）20 毫秒，后台统计期间主线程定时器继续工作。该数据目录已经移除。
- `ui-checks.json`：真实桌面窗口、390×844 手机网页、安卓界面包，同一设置组件。统计、账户名要求、取消、每一步确认、浅深色及横向溢出检查。
- `android-native-checks.json`：独立包 `com.memoweft.weftmate.mobile.st4qa`，真实安卓网络层／白名单／宿主认证读取新路由。`android-native-*` 为 ADB（安卓调试桥）整屏截图，包含系统栏；合成登录通过既有原生登录接口完成，云登录页面不在此脚本范围。测试包的通知权限保持拒绝，避免系统权限提示覆盖截图；测试结束卸载独立包并移除本轮转发。
- 首轮失败的 `ui-failure.png`、`native-failure.png`、`android-native-failure.png` 只保留为合成夹具问题原件，不计为最终通过证据。`contact-sheet.png` 是早期浏览预览，不计入最终截图。

## 第8条前端清单

- [x] 使用现有图标、输入、确认框与设计令牌；没有原生下拉或缩放把手。
- [x] 按钮有可见轮廓、悬停／按下／键盘聚焦／禁用态；手机操作恢复48px（像素）触控高度。
- [x] 新入口只在设置 → 数据与存储；用量之后、已归档之前。
- [x] 行内图标／说明／大小／清理对齐；使用设计令牌间距。480px 程序窗口从顶部验收。
- [x] 后台统计、空值、错误／重试及待电脑确认可见；结果用轻提示。
- [x] 桌面浅深、480px、390×844 手机网页及安卓界面包均捕获。
- [x] 保留既有设置页面家族与密度；独立 impeccable（界面设计与验收技能）审查指出的6项缺口均已解决。
- [x] 清理、删除清单／账户名、注销清单／账户名、最后确认、远程等待电脑确认均有打开态浅深截图。
- [x] 已查看最终截图；首轮安卓白底弹窗、裸危险按钮、短弹窗高度与原生居中回归已修正。
- [x] `android-native-*` 使用带系统栏整屏捕获；浅深主题与内容在安全区域内。手机网页截图为浏览器页面，不将其称为手机原生壳截图。

独立审查的最后 `ship`（可交付）评分只覆盖6项修复及其定位回归，未扩大为五端完整批准。Apple（苹果端）原生代码未改，接线及系统栏／读屏清单见 CLIENT_API 第13节。

## 导出与删除边界

导出复用 BK-1 的筛选、版本清单、逐文件 SHA-256（安全哈希）与原子发布思路，保存为文件夹；不另造压缩格式。目录为 `conversations`、`memory`、`files`、`settings`、`usage`，含 `README.md`、`manifest.json`、`manifest.sha256`。临时对话、已遗忘序号、推理与工具参数、凭据、其他账户、旧备份排除；原生图片及上传原件保留。取消移除暂存目录；发布前再次核对内容／记忆版本，防止遗忘后发布旧内容。包未加密。

当前存储已有账号目录、旧所有者同步目录、账号散列工作目录、账号成果目录及DSH正式日志分区。按认证账号解析这些专属分区，每个递归删除都预检真实路径与链接；共享账号／用量／迁移文件按账号重写，保留其他账号。不会删除项目原位置文件。程序、其他账号、整机备份和已经导出的外部文件保留；旧备份与外部导出需在原位置自行处理，不能承诺关机设备即时擦除。

删除过程阻止本账号新增内容，等待已受理的配置／发送操作结束，停止原生任务并删除正式会话；记忆走Core正式命令和完成回执，后清账号副本。失败保留删除标记以阻止复活，并可再次确认重试。退出其他设备与离线清理代次在下次连接／授权核对时生效。

注销另清本机账号、设备及本账户本机云绑定。已登录云账号时收当次密码，沿现有云注销接口继续；应急本地登录没有云授权时会明确说明邮箱与云身份仍在，须重新登录云账号完成注销，不称为云端全部删除。

## 复验

```powershell
npm ci
node --test tests/personal-data-controls.test.ts tests/fx-16-erasure.test.ts
node tests/integration/st-4-core.mjs
node tests/integration/st-4-native.mjs
node tests/integration/st-4-statistics.mjs
node tests/integration/st-4-ui.mjs
node tests/integration/st-4-android.mjs
node .github/scripts/ci-unit-tests.mjs required
node --test tests/personal-cloud-web.test.ts apps/mobile-ui/tests/cloud-login.test.mjs apps/mobile-ui/tests/chat-interactions.test.mjs
npm run typecheck
```

安卓原生脚本要求先按Android README激活既有工具链，并用 `-PweftmateApplicationId=com.memoweft.weftmate.mobile.st4qa` 构建主／测试APK（安卓安装包）；运行前拒绝占用中的AND-1包。版本号和默认界面包最低壳版本没有在本包递增，由Claude合并时统一；新增精确业务路由与Windows私有桥需要相应新程序本体。
