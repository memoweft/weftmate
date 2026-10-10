# UX-9 · 选择工作文件夹

所有账号、目录与内容均为合成数据；宿主使用系统临时目录和随机端口。参照产品截图只在本机查看，没有复制进仓库。未请求 8081，未读取本人日用数据或凭据保管库。

## 行为与证据

| 场景 | 浅色 | 深色 | 结果 |
|---|---|---|---|
| 空白旁聊：执行电脑 / 文件夹 / 添加；首次轻提示 | [浅](electron-light-blank-first-hint.png) | [深](electron-dark-blank-first-hint.png) | 非强制，可直接聊天 |
| 执行位置菜单 | [浅](electron-light-execution-menu.png) | [深](electron-dark-execution-menu.png) | 仅当前电脑，更多电脑以后支持 |
| 最近文件夹菜单 | [浅](electron-light-folder-menu.png) | [深](electron-dark-folder-menu.png) | 最多5个、路径末两级、明确不使用 |
| 「+」菜单 | [浅](electron-light-plus-menu.png) | [深](electron-dark-plus-menu.png) | 添加文件下面选择文件夹 |
| 新目录小确认卡 | [浅](electron-light-confirm.png) | [深](electron-dark-confirm.png) | 名称、路径、默认只读、审批说明；确认中保留编辑、阻止提前发送 |
| 确认卡权限下拉打开 | [浅](electron-light-confirm-permissions.png) | [深](electron-dark-confirm-permissions.png) | 统一控件、可读写单选 |
| 已有对话的当前文件夹 | [浅](electron-light-current-folder.png) | [深](electron-dark-current-folder.png) | 胶囊在「+」右侧、审批模式前 |
| 当前文件夹菜单 | [浅](electron-light-current-menu.png) | [深](electron-dark-current-menu.png) | 显示目录、权限、换目录、移出 |
| 更改权限子菜单 | [浅](electron-light-permission-menu.png) | [深](electron-dark-permission-menu.png) | 保存后核对项目修订与权限 |
| 窄窗480px | [浅](electron-480-light-selected.png) | [深](electron-480-dark-selected.png) | 胶囊不换行、无页面水平溢出 |
| 窄窗菜单打开 | [浅](electron-480-light-menu.png) | [深](electron-480-dark-menu.png) | 统一贴边定位 |
| 系统目录警告 | [浅](electron-light-high-risk.png) | [深](electron-dark-high-risk.png) | 明确警告，默认只读；未登记系统目录 |
| 首次引导第一句话 | [浅](electron-light-onboarding-first.png)、[菜单](electron-light-onboarding-folders.png) | [深](electron-dark-onboarding-first.png)、[菜单](electron-dark-onboarding-folders.png) | 同一排胶囊、同一菜单 |
| 手机360×780 | [网页](phone-web-360-light-blank.png)、[菜单](phone-web-360-light-projects.png)、[安卓](android-bundle-360-light-blank.png) | [网页](phone-web-360-dark-blank.png)、[菜单](phone-web-360-dark-projects.png)、[安卓](android-bundle-360-dark-blank.png) | 三枚胶囊保持单行 |
| 主对话新开项目旁聊 | — | [草稿与附件](electron-dark-main-project-side.png) | 主对话不归项目，保留返回引用 |
| 真实路径拖放 | [文件夹](electron-drop-folder.png) | [普通文件](electron-drop-file.png) | 目录归项目；文件仍附件 |
| 手机网页390×844空白页 | [浅](phone-web-light-blank.png) | [深](phone-web-dark-blank.png) | 电脑名称 / 在线状态、三枚胶囊 |
| 手机网页「+」菜单 | [浅](phone-web-light-plus.png) | [深](phone-web-dark-plus.png) | 选择电脑上的文件夹 |
| 手机网页项目菜单 | [浅](phone-web-light-projects.png) | [深](phone-web-dark-projects.png) | 名称、路径末两级、权限、电脑添加说明 |
| 安卓界面包390×844空白页 | [浅](android-bundle-light-blank.png) | [深](android-bundle-dark-blank.png) | 与远程网页同一文件夹组件 |
| 安卓界面包「+」菜单 | [浅](android-bundle-light-plus.png) | [深](android-bundle-dark-plus.png) | 真实原生桥适配器连接合成宿主 |
| 安卓界面包项目菜单 | [浅](android-bundle-light-projects.png) | [深](android-bundle-dark-projects.png) | 可选择现有项目 |
| 安卓选择 / 离线 | [已选](android-bundle-selected.png) | [离线禁用](android-bundle-offline.png) | 离线不浏览电脑磁盘 |
| MuMu独立原生壳 | [空白](android-native-light-blank.png)、[菜单](android-native-light-plus.png)、[文件夹](android-native-light-folders.png) | [空白](android-native-dark-blank.png)、[菜单](android-native-dark-plus.png)、[文件夹](android-native-dark-folders.png) | 独立包 `com.memoweft.weftmate.mobile.ux9qa`，浅深真实实拍，0界面错误；[已选项目](android-native-selected.png) |
| MiMo真实读写与审批 | [审批1](mimo-approval-1.png)、[审批2](mimo-approval-2.png)、[审批3](mimo-approval-3.png)、[审批4](mimo-approval-4.png) | [结果](mimo-result.png) | 合成项目中生成README.md，磁盘与成果库均核对 |

行为断言见 [checks.json](checks.json)；原生壳检查见 [android-native.json](android-native.json)。截图中的密钥式字符串都是既有夹具的明确合成文本，不是实际凭据。

## 第8条自查

- [x] 1 无新增系统下拉、蓝色默认焦点框或textarea缩放把手；文件夹菜单、权限下拉复用统一组件。
- [x] 2 胶囊、图标按钮、菜单项均有悬停 / 按下 / 聚焦 / 禁用态；关闭轻提示是图标按钮。
- [x] 3 新入口位于指定的「+」、工作胶囊与已有审批工具位；确认卡就地出现。
- [x] 4 间距、圆角、字号引用现有令牌；480px与390px没有水平溢出、重叠或半截控件。
- [x] 5 当前项目 / 不使用 / 权限单选显示勾选；项目读取有加载、空、错误与重试。
- [x] 6 浅深、480px、390×844手机网页 / 安卓界面包、真实安卓壳已看。360×780手机网页 / 安卓界面包同样已验。
- [x] 7 对照本机Codex / Claude输入区胶囊与菜单密度；未复制参照资产。
- [x] 8 每种新增菜单 / 确认卡 / 权限下拉有浅深打开状态截图，复用统一样式与定位。
- [x] 9 首轮发现的胶囊顺序、关闭按钮文字与确认卡高度均已修正并复核。
- [x] 8a 本包不新增独立页面；已有页面顶栏 / 列表行操作结构保持，菜单自带三态。

## 验证与边界

- `node --test tests/folder-choice.test.ts`：10/10；包括三分支、账户隔离、发送锁、真实路径分类、高风险警告、浏览器任意路径拒绝、现有权限修订。
- 现有界面交互保护点全部保留。夹具补充标签 / id / 逗号选择器、父节点和插入能力；启动关闭竞态测试提前附着原有拒绝断言，避免未处理拒绝；凭据回复使用独立的不可变快照，防止 Windows 读取初始快照时迫使替身进程替换打开的目标并重启，仍断言只处理一次请求。手机菜单夹具补齐真实按钮父节点，避免新增动态菜单项落在树外。
- `npm run typecheck`通过；安卓界面包生成 / 一致性校验与独立APK（安卓安装包）、JVM（Java虚拟机）测试通过，版本号未改。
- 真实Electron选择框大多数场景用测试替身返回合成目录。真实Windows对话框已打开，并通过电脑操作工具填入合成临时路径；确认选择时工具收到物理Escape停止信号，停止了电脑操作，因此**真实原生选择完成的冒烟未通过**。没有把打开或填入路径记作成功。
- 完整必过单测最终通过数及PR检查结果见交付结果；只有0失败才写done。
- 无新增业务路由。Android不用新壳；Windows增加原生文件夹检查 / 拖放 / 显示 / 可信登记桥，需要程序本体更新。完整路径留在本机，远程仅路径末两级。项目偏好按账户 / 宿主保存在本设备。登记 / 迁移 / 权限保存中的发送锁按账户和草稿作用域隔离，迟到回应不会锁住其他账户或释放其新操作。

## MiMo用量

第一轮因验收脚本使用了错误审批字段，停在真实审批处：3次请求，输入5645、输出49 token（文本单位），费用0.005743元；见 [首次用量](mimo-attempt-1-usage.json)。成功轮为6次请求，输入16537（其中缓存9984）、输出224，费用0.00720068元；见 [成功用量](mimo-usage.json)。总计9次请求，输入22182、输出273，费用0.01294368元；首次配置 / 下拉定位失败轮没有模型请求。实际凭据只在进程内，从Machine环境变量读取，未落盘。

## Apple交接

1. Mac空白旁聊在输入框下方显示执行电脑、工作文件夹和添加文件夹胶囊；手机显示电脑名 / 在线状态，只选择已有项目。
2. Mac复用系统文件夹选择与安全书签 / 本机可信宿主身份；新目录用小确认卡，默认只读，高风险位置警告；不要提供网页任意路径输入。
3. 项目会话的输入工具位显示文件夹名，悬停完整路径 / 权限，统一菜单显示目录、改权限、换目录、移出项目。
4. 沿现有项目POST / PATCH与会话metadata移动；主对话选择文件夹创建项目旁聊，携带草稿 / 附件并保留主对话引用；临时对话隔离保持。
5. 读取现有`GET /status.hostName`、`GET /projects[].pathHint`；没有新路由。账户与宿主隔离记住上次选择（含明确不使用），项目中新建优先当前项目。
6. 深浅、窄窗、VoiceOver（读屏）、键盘打开 / Esc退出、迟到响应隔离、目录 / 文件拖放须做原生验收；Watch不新增文件夹选择入口。
