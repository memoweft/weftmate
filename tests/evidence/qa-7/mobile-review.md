# QA-7 手机逐图审查

原图均未裁掉系统状态栏。安卓为 MuMu Android 15；底部**应用选项卡不是系统导航栏**。qemu.hw.mainkeys=1，所有图的系统导航栏高度均为 0，因此底部系统栏验收未通过。真实原生业务连接的失败另见 android/auth-diagnostic.json；本表使用 AND-1 合成投影夹具，只证明真实壳、页面布局、状态栏和键盘。

| 原图 | 系统／页面 | 系统版本 | 状态栏高 | 底部系统栏 | 状态栏 RGB | 页面顶栏 RGB | 色差 | IME（输入法）高 | 观察 |
|---|---|---|---:|---|---|---|---:|---:|---|
| [main-light.png](android-gallery/main-light.png) | light／light | 15 | 31 | 隐藏，未验收 | 255.00,255.00,255.00 | 255.00,255.00,255.00 | 0.000 | 0 | 图标深浅匹配；未见状态栏遮挡 |
| [drawer-status-dots-light.png](android-gallery/drawer-status-dots-light.png) | light／light | 15 | 31 | 隐藏，未验收 | 221.16,221.48,222.11 | 221.16,221.48,222.11 | 0.000 | 0 | 图标深浅匹配；未见状态栏遮挡；合成等待批准橙点可见 |
| [fullscreen-search-light.png](android-gallery/fullscreen-search-light.png) | light／light | 15 | 31 | 隐藏，未验收 | 255.00,255.00,255.00 | 255.00,255.00,255.00 | 0.000 | 0 | 搜索框顶边 51.39px，低于状态栏底边 31px |
| [top-more-menu-light.png](android-gallery/top-more-menu-light.png) | light／light | 15 | 31 | 隐藏，未验收 | 255.00,255.00,255.00 | 255.00,255.00,255.00 | 0.000 | 0 | 图标深浅匹配；未见状态栏遮挡 |
| [data-storage-light.png](android-gallery/data-storage-light.png) | light／light | 15 | 31 | 隐藏，未验收 | 254.72,254.72,254.72 | 253.00,253.00,253.00 | 1.724 | 0 | 图标深浅匹配；未见状态栏遮挡；浅色图通知轻提示暂时覆盖页标题 |
| [keyboard-light.png](android-gallery/keyboard-light.png) | light／light | 15 | 31 | 隐藏，未验收 | 254.72,254.72,254.72 | 253.00,253.00,253.00 | 1.724 | 324 | 输入区底边 957.00px；键盘顶边 956px；测试 IME 固定浅色 |
| [offline-light.png](android-gallery/offline-light.png) | light／light | 15 | 31 | 隐藏，未验收 | 255.00,255.00,255.00 | 255.00,255.00,255.00 | 0.000 | 0 | 合成连接失败后为“正在连接·草稿会保留”；未观察长时最终离线态 |
| [main-dark.png](android-gallery/main-dark.png) | dark／dark | 15 | 31 | 隐藏，未验收 | 38.00,39.00,35.00 | 38.00,39.00,35.00 | 0.000 | 0 | 图标深浅匹配；未见状态栏遮挡 |
| [drawer-status-dots-dark.png](android-gallery/drawer-status-dots-dark.png) | dark／dark | 15 | 31 | 隐藏，未验收 | 31.70,34.10,33.39 | 31.43,34.10,33.39 | 0.158 | 0 | 图标深浅匹配；未见状态栏遮挡；合成等待批准橙点可见 |
| [fullscreen-search-dark.png](android-gallery/fullscreen-search-dark.png) | dark／dark | 15 | 31 | 隐藏，未验收 | 47.00,49.00,43.00 | 47.00,49.00,43.00 | 0.000 | 324 | 搜索框顶边 51.39px，低于状态栏底边 31px |
| [top-more-menu-dark.png](android-gallery/top-more-menu-dark.png) | dark／dark | 15 | 31 | 隐藏，未验收 | 38.00,39.00,35.00 | 38.00,39.00,35.00 | 0.000 | 0 | 图标深浅匹配；未见状态栏遮挡 |
| [data-storage-dark.png](android-gallery/data-storage-dark.png) | dark／dark | 15 | 31 | 隐藏，未验收 | 38.00,39.00,35.00 | 38.00,39.00,35.00 | 0.000 | 0 | 图标深浅匹配；未见状态栏遮挡；浅色图通知轻提示暂时覆盖页标题 |
| [keyboard-dark.png](android-gallery/keyboard-dark.png) | dark／dark | 15 | 31 | 隐藏，未验收 | 38.00,39.00,35.00 | 38.00,39.00,35.00 | 0.000 | 324 | 输入区底边 957.00px；键盘顶边 956px；测试 IME 固定浅色 |
| [offline-dark.png](android-gallery/offline-dark.png) | dark／dark | 15 | 31 | 隐藏，未验收 | 38.00,39.00,35.00 | 38.00,39.00,35.00 | 0.000 | 0 | 合成连接失败后为“正在连接·草稿会保留”；未观察长时最终离线态 |

14/14 色差低于运行器阈值18，图标与页面主题一致。浅深搜索框顶边约51.39px，状态栏底边31px，余量20.39px。浅深真实 IME 高324px，输入区底边约957.00px，键盘顶边956px，差约1px。不可用这些夹具图宣称真实安装宿主的安卓业务链路已经通过。

## 手机网页

真实打包程序的本地直连，24 个场景；补测复用同一 NSIS（Windows 安装器）产出的 win-unpacked 可执行目录，产品源码512文件与固定基线一致。不是重新构建产品。网页图只有模拟视口，无浏览器或系统栏；键盘采用缩小可视视口模拟。建议条使用明确标注的布局夹具；真实 MiMo 建议展示另见 live/next-suggestions.png。

| 视口／主题 | 主对话发送底边 | 旁聊／项目／建议／离线发送底边 | 模拟键盘视口／发送底边 | 页面高 |
|---|---:|---:|---|---:|
| 390×844 浅／深 | 823 | 783 | 390×544／483 | 844 |
| 360×780 浅／深 | 759 | 719 | 360×480／419 | 780 |

全24项发送按钮在视口内，页面总高等于视口高，没有纵向溢出；逐项值及截图在 [geometry.json](phone/geometry.json)。空旁聊、项目胶囊、合成建议条、真实网络断开提示与缩小视口都保留原图。

小毛病：浅色数据页的系统通知说明轻提示横跨顶栏；360×480恢复连接轻提示也遮住标题。均为短暂覆盖，未挡住发送或审批，不作为迁移否决项。
