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
