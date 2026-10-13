# S7 · 电脑离线时交代任务

所有账号、电脑、对话、文件与云服务均为合成数据，使用随机端口与受管临时目录；没有请求生产云、18186、本人安装程序或日用目录。模型仅使用进程内读取的机器环境变量 `MIMO_API_KEY`，不写凭据或密钥到证据。

`verification.json` 是真实 Electron（桌面程序框架）／固定 DSH（助手运行时）／本地云／手机网页的结果。手机真实云登录和设备批准后同步加密材料，电脑关闭；提交两件事、取消一件再补交、关闭页面；电脑重启领取后删除云密文，先读再写，写入在手机批准前不存在，批准后写入并读回。额外移除合成账号模型，验证正常派发失败和通用通知点击进入原对话。最终复验通过：9次模型推理请求、17次模型目录请求、36张截图、网页错误0。模型转发只在随机回环端口的进程内持有真实密钥，宿主配置只用合成值；转发计数与宿主账本一同记录。

| 手机场景 | 浅色 360／390 | 深色 360／390 |
|---|---|---|
| 离线发送菜单打开 | `mobile-360-light-offline-entry.png`／`mobile-390-light-offline-entry.png` | `mobile-360-dark-offline-entry.png`／`mobile-390-dark-offline-entry.png` |
| 已记下状态 | `mobile-360-light-waiting-message.png`／`mobile-390-light-waiting-message.png` | `mobile-360-dark-waiting-message.png`／`mobile-390-dark-waiting-message.png` |
| 目标页等待分组 | `mobile-360-light-waiting-goals.png`／`mobile-390-light-waiting-goals.png` | `mobile-360-dark-waiting-goals.png`／`mobile-390-dark-waiting-goals.png` |
| 取消确认打开 | `mobile-360-light-cancel-confirm.png`／`mobile-390-light-cancel-confirm.png` | `mobile-360-dark-cancel-confirm.png`／`mobile-390-dark-cancel-confirm.png` |
| 电脑已开始 | `mobile-360-light-computer-started.png`／`mobile-390-light-computer-started.png` | `mobile-360-dark-computer-started.png`／`mobile-390-dark-computer-started.png` |
| 原生工具审批 | `mobile-360-light-approval.png`／`mobile-390-light-approval.png` | `mobile-360-dark-approval.png`／`mobile-390-dark-approval.png` |
| 做完了 | `mobile-360-light-completed.png`／`mobile-390-light-completed.png` | `mobile-360-dark-completed.png`／`mobile-390-dark-completed.png` |
| 没做成 | `mobile-360-light-failed.png`／`mobile-390-light-failed.png` | `mobile-360-dark-failed.png`／`mobile-390-dark-failed.png` |

桌面来源标记与成果：`desktop-1200-light-source.png`、`desktop-1200-dark-source.png`、`desktop-480-light-source.png`、`desktop-480-dark-source.png`，全部来自生产 Electron 窗口；尺寸为逻辑内容尺寸，截图保留系统缩放后的实际像素。

前端清单：

- [x] 复用原菜单、对话框、图标和下拉；输入无缩放把手，原始下拉由统一控件接管。
- [x] 点击项有按钮／菜单外观、聚焦／按下／禁用状态；上传有「正在记下来」，未确认可重试。
- [x] 新入口只在「+」菜单；目标行内容可点，取消只在行菜单并二次确认。
- [x] 复用间距令牌；离线页隐藏普通输入区，防止双输入区；360／390未出现横向溢出。
- [x] 状态行、加载／失败／过期和取消可见；目标页沿原有加载、空和错误设计。
- [x] 浅／深与手机360×780／390×844、真实电脑1200／480均截图。
- [x] 列表与弹层沿 `tb-2/polish` 家族，未改字体、颜色令牌或输入区结构。
- [x] 新菜单和取消确认有打开态截图。
- [ ] 第8.10条的系统栏整屏未通过：本机 Android（安卓）15 模拟器没有底部系统导航栏。已构建并尝试原有独立调试浏览器；临时启用导航属性、重建框架后仍只取得顶部48像素的状态栏，没有底部导航区域，因此没有提交这批截图作为验收图，也没有编造色差。调试身份与导航属性已恢复、测试包已卸载，分辨率与主题保留原有值，见 `native-cleanup.json`。本页的360／390证据明确是浏览器内容视口；原生加密、路由与 iPhone（苹果手机）界面按清单另接，需在有真实底部系统栏的环境补齐整屏、主题及色差验收。

通知证据是原账户动态与通用通知载荷、来源点击；当前 S3a（通知通道）的提供方仍未配置，不能将前台读到动态称为 FCM（谷歌云消息）／APNs（苹果推送服务）或系统实际送达。Android 后台补发与 Apple（苹果端）本地通知消费接口未改，原生跟进清单见 `docs/CLIENT_API.md` 3.20。

完整必过结果见 `required.log`；固定运行时见 `vendor.log`；手机五文件交互结果见 `mobile.log`；云、类型与卫生的最终计数见交付报告。诊断夹具的中途失败与最终结果会明确区分，不删除断言、跳过用例或放宽时限。

## 新客户端 + 旧云端

本地运行结构8旧云代码（固定基线 `9a9f53f0593d4333843a296cdbe2533757b4aa57`）和结构9新云代码，使用真实合成账号、设备签名、电脑身份与手机共用的离线组件。`cloud-compat.json` 记录全部云请求路径计数：旧云没有能力标记，手机任务请求0、电脑与手机合计任务请求0，菜单不含任务入口；新云带 `capabilities.offlineTasks:1`，入口出现，手机读取1次、电脑领取1次。两边网页错误0，等待目标投影为空，没有失败提示。固定测试另外验证缓存中已有公钥仍不启用、正常离线聊天继续可用，以及后续状态刷新启用／关闭功能。

- [旧云结构8：「+」菜单只有继续聊聊](mobile-cloud8-plus.png)
- [新云结构9：「+」菜单出现交给电脑](mobile-cloud9-plus.png)

两图是390×844浅色浏览器内容视口，使用生产菜单组件和样式，不作为系统栏整屏或原生客户端验收；没有修改模拟器设置。本次模型请求0。补充复验：相关固定测试51通过／0失败，云95项中91通过／0失败／4既有条件跳过，手机五文件114通过／0失败，共享手机资源生成、类型与公开卫生通过。未重跑完整必过组。日志为 `cloudcompat-related.log`、`cloudcompat-cloud.log`、`cloudcompat-mobile.log`、`cloudcompat-typecheck.log`、`cloudcompat-hygiene.log`。

## 安卓白名单

四条手机任务接口（submit/list/cancel/clear）归 `cloud-account`（云账号原生通道），使用原生设备签名与固定云来源，只允许精确POST，由 `CloudAppCrypto.kt` 校验；不加入 `Network.kt` 电脑业务白名单。电脑安装签名的 claim/ack/result 保留 `specialized-or-desktop`（专用或桌面通道）分类，不能经手机云通道调用。共享客户端改为四条明确调用，文档方法／路径明确填写；未放宽清单或白名单。

原清单会把拼接任务路径误识别成GET sample-one；第一轮补齐四条路径后，JVM单测另发现能力文档短路径被误识别成不存在的POST /personal/v1/hosts/offline/status。文档改为完整云路径后，最终路由301项与真实Kotlin校验通过。没有新增跳过、放宽断言或允许虚构路径。

最终 `:app:testDebugUnitTest` 78通过／0失败／0跳过；Node（JavaScript运行环境）路由与离线定向27通过／0失败；手机交互五文件114通过／0失败；类型与公开卫生通过，共享手机资源生成58项。Android（安卓）固定测试直接使用产品nativeVault与离线组件，云端支持且缓存有接收公钥时仍因没有seal而隐藏任务入口；菜单只保留继续聊聊、目标任务投影为空，离线聊天经原native complete可用，无缺失接口调用或失败提示。未运行模拟器，不将固定测试称为原生整屏验收。本次模型请求0。

保管库offline.seal／targets／clearAccount等原生能力仍待后续，安卓暂不显示此功能。需要新壳版本（精确云路由新增），版本号与界面默认值未改，由编排统一升号。验证计数与七条路径分类见 `android-verification.json`；日志 `android-jvm.log`、`android-related.log`、`android-mobile.log`、`android-typecheck.log`、`android-hygiene.log`。本轮按指示不重跑完整必过组。
