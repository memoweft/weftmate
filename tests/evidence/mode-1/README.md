# MODE-1 · 对话与工作

设计先行提交 `a5bbc20e`，随后接入 FIX-33（手机新对话路由）与主线。产品定义和默认选择见 [WORK_AND_CHAT](../../../docs/WORK_AND_CHAT.md)，接口见 [CLIENT_API](../../../docs/CLIENT_API.md) 的 MODE-1 小节。

## 行为证据

- [electron-report.json](electron-report.json)：真实 Electron（桌面程序框架）、固定 DSH（助手运行时）和两个独立合成电脑。桌面与手机网页分别完成聊天、真实工具暂停卡片、同会话转换、普通审批、真实文件落盘、拒绝与新建工作；新工作选第二台电脑后只有第二台落盘。主对话转换保留原逻辑聊天及原生会话标识和历史，新“小纬”为空入口。
- [mimo-report.json](mimo-report.json)：云端 `mimo-v2.6-flash` 实际调用 `write`，被原生模式边界暂停成卡片；文件没有执行，执行记录为零。密钥只从机器进程环境读取，不打印或落盘。调试验收脚本的任务读取形状时共运行四轮小请求，各轮均停在卡片；报告是最终有效轮。
- 多电脑目录与内容通道凭据交换使用本机合成替身；每台电脑内容认证、命令、DSH 与文件操作是真实实现。没有连接正式云目录或上线服务器，不能把此证据写成真实线上双电脑验收。
- 无在线电脑图使用同账号的合成目录在线状态；证明说明、灰显和禁用转换，未伪造服务失联或加密离线材料。S7（离线任务）的加密、明确提交、重试和原电脑归属由相关测试验证，这组图不声称拍摄了 S7 材料已就绪分支。

## 截图

60 张图：桌面内容宽 1200 / 480，手机网页 390×844 / 360×780，浅色与深色。电脑图片直接捕获本包真实程序原生窗口，手机图片为浏览器内容视口。`systemBarsVerified:false`：没有真实手机系统栏、键盘或手势区验收，未修改或安装原生手机应用。

| 场景 | 桌面代表图 | 手机网页代表图 |
|---|---|---|
| 两个区、小纬固定入口 | [1200 浅](desktop-1200-light-sidebar.png) / [480 深](desktop-480-dark-sidebar.png) | [390 浅](phone-390-light-sidebar.png) / [360 深](phone-360-dark-sidebar.png) |
| 工具调用转换卡片 | [1200 浅](desktop-1200-light-switch-card.png) / [480 深](desktop-480-dark-switch-card.png) | [390 浅](phone-390-light-switch-card.png) / [360 深](phone-360-dark-switch-card.png) |
| 转换后的工作 | [1200 浅](desktop-1200-light-working.png) / [480 深](desktop-480-dark-working.png) | [390 浅](phone-390-light-working.png) / [360 深](phone-360-dark-working.png) |
| 新建工作、电脑菜单打开 | [1200 浅](desktop-1200-light-computer-menu.png) / [480 深](desktop-480-dark-computer-menu.png) | [390 浅](phone-390-light-computer-menu.png) / [360 深](phone-360-dark-computer-menu.png) |
| 新建工作、项目菜单打开 | [1200 浅](desktop-1200-light-new-work.png) / [480 深](desktop-480-dark-new-work.png) | [390 浅](phone-390-light-new-work.png) / [360 深](phone-360-dark-new-work.png) |
| 第二台电脑的工作 | [1200 浅](desktop-1200-light-second-computer-work.png) / [480 深](desktop-480-dark-second-computer-work.png) | [390 浅](phone-390-light-second-computer-work.png) / [360 深](phone-360-dark-second-computer-work.png) |
| 没有在线电脑的卡片 | [1200 浅](desktop-1200-light-offline-card.png) / [480 深](desktop-480-dark-offline-card.png) | [390 浅](phone-390-light-offline-card.png) / [360 深](phone-360-dark-offline-card.png) |
| 原小纬移到工作，历史保留 | [1200 浅](desktop-1200-light-main-to-work.png) / [480 深](desktop-480-dark-main-to-work.png) | 同段多历史会话规则另由固定运行时测试验证 |

## 相关验证

| 命令或组 | 结果 |
|---|---|
| 模式规则、固定运行时、原生审批桥、HTTP（网页请求）工具审批、多电脑 | 49 / 0；之后模式规则补充无电脑、离线和首发前选择测试，见下一组 |
| 模式规则、桌面界面与交互 | 69 / 0 |
| 手机单独使用、模型服务与生成资源 | 19 / 0 |
| MEM-7（手机只读历史）与手机模型服务 | 20 / 0 |
| S7 加密离线任务与手机离线共用层 | 19 / 0 |
| 安卓 `BusinessRouteUnitTest` 专项 | 24 / 0，既有专用审批构造器与通用业务白名单分别核对 |
| 类型、共用资源一致性、公开卫生 | 通过，公开卫生 0 命中 |

这些组有交集，不相加为独立用例总数。本机没有运行完整单测；Linux（云端系统）全链 `relay-phone.test.mjs` 本机按原有平台条件跳过，交给 PR（合并请求）CI（持续集成）。云端最终结果登记在交付报告与 PR。

## 默认与边界

已有对话切到工作沿用回答它的电脑；另一台电脑灰显说明，新建工作可以选任意在线电脑。跨电脑搬运同段历史与记忆不在本包；只读“来自手机”历史先走既有继续入口。现有浏览器／网页工具需要工作，纯提醒可在对话中创建，执行型定时任务必须工作。新文件夹保持既有只读默认与审批规则。安卓原生与 iPhone 照做清单在 Orchestrator 的 `mode-1.result.md`。

验收程序关闭后，两台 DSH、Electron 与 Chromium（浏览器引擎）均按正常关闭路径退出，报告中的 `cleaned:0` 是随后追加归属查杀数量；不是遗留四个进程。最终日志保留一条启动查询的 `session-not-found`，主路检查和页面错误数组通过，不宣称日志完全没有错误文字。
