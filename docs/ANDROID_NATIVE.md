# 安卓逐页原生化

AND-4 使用 Jetpack Compose（安卓声明式界面）1.7.6、Material 3（原生组件底座）1.3.1 与 Activity Compose（界面生命周期）1.9.3。Kotlin（安卓语言）及 Compose Compiler（界面编译器）插件固定为 2.0.21；Gradle（构建工具）8.9、JDK（Java 开发环境）17、SDK（安卓开发工具）35 保持现有版本。布局、触控区、字号、圆角和颜色取生成的 `DesignTokens.kt`，图标取 `design/icons/` 的安卓产物，组件不使用系统默认蓝色。选型按[官方 Kotlin 2 配置](https://developer.android.com/jetpack/androidx/releases/compose-kotlin)接入，未引入第三方 Markdown（标记文本）或图片库。

新增直接依赖及界面测试依赖 `ui-test-junit4 / ui-test-manifest:1.7.6` 只通过现有 `google()`（Google Maven）与 `mavenCentral()`（Maven Central）解析，版本全部固定。首次联网执行 `gradle :app:assembleDebug :app:assembleDebugAndroidTest`，文件进入 `D:/AIProjects/AIGame/Repository/runtime/toolchains/gradle-user-home`，随后用同一进程激活脚本执行 `gradle --offline`。不复制或改写共享 DSH（助手运行时）vendor（依赖缓存）。云端沿原安卓构建步骤在线解析相同版本。调试包大小与启动／滚动实测见 `tests/evidence/and-4/README.md`；Compose 增加界面运行库，预计调试包增加约 6–10 MB（兆字节），发布压缩尚未启用，不用估计冒充测量。

`NativeActivity` 为默认入口，`NativeChatModel` 管展示状态与前台轮询，`NativeTimeline` 合并正式事件及累计正文快照；界面只发动作，不保存另一份业务数据库。`HybridActivity` 保留原网络调度与账号代次检查，原生和网页调用同一层 `PersonalApi / SharedChat / ModelClient / SseMessageCollector`。认证、TLS pin（证书公钥固定）、网络路由白名单、未确认发送账本与附件受理仍在原层；审批重试保留同一请求体／编号，登记与最终消费分开。`AttachmentStore / LocalStore / SecureSettings / OfflineVault` 与通知继续复用，未新增业务接口或权限。草稿按账号与对话保存，退出／切号清空展示；生成时前台按 250 ms（毫秒）读取现有事件／变更接口，暂态水位不替代历史游标。

| 包建议 | 原生范围 | 每一步怎样保持完整 |
|---|---|---|
| AND-4 | 主框架、五项图标导航、侧栏入口、聊天列表／输入区／审批与图片查看 | 登录、设置及动态／健康／目标／成果库复用既有网页；复杂消息操作仍可打开完整对话页。 |
| AND-5 | 动态及通知深链、未读／待处理列表 | 复用原通知动作和审批回执；其它三页继续嵌入。 |
| AND-6 | 目标、定时与长期目标的列表／编辑／详情 | 按原路由替换网页；保留执行记录与原对话定位。 |
| AND-7 | 成果库、图片／文件预览、保存／分享 | 沿原下载及系统文件能力；不造新的文件权限。 |
| AND-8 | 健康主页、趋势与各项说明／分析 | 沿正式健康接口；真机健康来源另包。 |
| AND-9 | 设置、模型／账户／设备页面与完整对话操作 | 逐类替换网页，复用同一登录与安全存储。 |
| AND-10 | 统一颜色／排版／动效、长列表及真实键盘回归 | 对齐 iPhone，检查剩余网页依赖，再决定删旧入口。 |

MOB-4 的手机独立模式通过同一原生业务入口接入，不另做本机模型库或对话存储；其合入前只保证电脑连接模式与已有本机账户模式。网页继续服务手机浏览器远程访问，也承载未迁完页面。设置 → 常规中的「使用原生聊天界面」可回到完整 `HybridActivity`，再次开启恢复原生；构建参数 `-PweftmateNativeUi=false` 设旧入口为默认。旧入口要等四页、设置、复杂消息操作、手机独立模式全部迁完且浅深／窄屏／真机回归通过后，单独一包删除。需要新壳版本，版本号留给合并时统一更新。
