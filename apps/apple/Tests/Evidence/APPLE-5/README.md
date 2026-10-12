# APPLE-5 iPhone 功能证据

原包完成：输入框收起／展开，正式健康接口，动态／目标／成果库，以及后台模型回退说明。沿用 APPLE-4 样式，未做健康颜色和全局视觉升级。

## 验证

- 完整包：XCTest 13／13；Swift Testing 477 项通过，2 项真实云／原生证书环境测试跳过。
- 真实合成电脑端：主仓认证、HTTP 路由、健康存储／算法、活动与成果投影；DSH 和模型适配为合成数据，不连接云和个人电脑，不读取 HealthKit。覆盖 v3 90 天上传／profile／三项、历史截止日、独立 weekly、分析开关／缓存／409 数据更新冲突／429 40 次额度、无会话提醒及重放；动态标读、安排暂停／恢复／删除、目标完成／移出、成果筛选／搜索／来源与预览。
- v2／v3／资料能力协商、64 KiB／100 天边界、缺字段、焦点／草稿／附件／键盘／减少动态效果、列表状态映射及危险操作条件由包测试覆盖。
- AppleSettingsSummaryChecks、ToolProgressChecks 通过；设计令牌 5／5；回调隔离 67 处 0 失败；文案检查通过；iPhone 后台编译通过。
- 第 4 批原生 XCTest 1／1：浅／深色各走输入框、健康今日、动态、目标、成果库列表和详情。系统分享／文件 App 保存、真实 HealthKit／后台续传、真设备和真模型未在本包验收。

## 模拟器记录

iPhone SE、后台无窗口、单实例，原包共启动 4 次。第 1 批启动后负载升高，执行测试前主动停止；第 2 批暴露输入字段重建导致焦点丢失，已修复；第 3 批验证输入行为后被已有日期弹层超出 SE 屏幕阻断，保留失败并改用成果面板结束输入；第 4 批完整通过。每批结束关闭全部模拟器并冷却至少 3 分钟；没有 GPU 重置、整机重启或新增 WeftMate 崩溃。

`boot-2/` 和 `boot-3/` 是修正前／不完整批次；根目录 PNG 是第 4 批的最终原包截图。已有 SE 日期弹层过高留给后续处理。

## 最终原包截图

- [apple5-dark-activity-detail.png](apple5-dark-activity-detail.png)
- [apple5-dark-activity-list.png](apple5-dark-activity-list.png)
- [apple5-dark-composer-collapsed.png](apple5-dark-composer-collapsed.png)
- [apple5-dark-composer-focused.png](apple5-dark-composer-focused.png)
- [apple5-dark-composer-multiline-above-keyboard.png](apple5-dark-composer-multiline-above-keyboard.png)
- [apple5-dark-goals-detail.png](apple5-dark-goals-detail.png)
- [apple5-dark-goals-list.png](apple5-dark-goals-list.png)
- [apple5-dark-health-today-lower.png](apple5-dark-health-today-lower.png)
- [apple5-dark-health-today-upper.png](apple5-dark-health-today-upper.png)
- [apple5-dark-library-list.png](apple5-dark-library-list.png)
- [apple5-dark-library-preview.png](apple5-dark-library-preview.png)
- [apple5-light-activity-detail.png](apple5-light-activity-detail.png)
- [apple5-light-activity-list.png](apple5-light-activity-list.png)
- [apple5-light-composer-collapsed.png](apple5-light-composer-collapsed.png)
- [apple5-light-composer-focused.png](apple5-light-composer-focused.png)
- [apple5-light-composer-multiline-above-keyboard.png](apple5-light-composer-multiline-above-keyboard.png)
- [apple5-light-goals-detail.png](apple5-light-goals-detail.png)
- [apple5-light-goals-list.png](apple5-light-goals-list.png)
- [apple5-light-health-today-lower.png](apple5-light-health-today-lower.png)
- [apple5-light-health-today-upper.png](apple5-light-health-today-upper.png)
- [apple5-light-library-list.png](apple5-light-library-list.png)
- [apple5-light-library-preview.png](apple5-light-library-preview.png)

## 追加：导航、决定卡片与附件

导航只留图标，保留中文读屏名称、等距布局与选中胶囊。审批／询问在对话流里呈现，三项选择需要选定后确认；已登记的决定收成一行，并明确等待电脑确认。草稿与已发送消息使用同一附件块；有草稿／附件时键盘关闭仍展开，空输入主按钮复用听写，运行中无新内容时停止。消息附件与成果库共用全屏文件查看页：关闭、文件名、右上菜单、内容，没有输入框；分享／保存使用已有系统能力，没有虚构收藏或版本历史。

追加模拟器只启动 **2 次**，无窗口、单实例；每批结束关闭并冷却三分钟。第 1 批因隐藏系统标签栏与悬浮导航读屏名称重复，测试改为在实际导航容器按中文名称定位。第 2 批两个测试均失败，18 条断言失败：16 条是四个未选中图标在浅深两轮的 AX 宽／高仍为 24 点；2 条是审批登记后的摘要未出现。失败和截图保留，不宣称追加界面全绿。

最后已修复：未选中按钮使用与导航相同的实色背景，使声明的 44 点区域成为完整控件；摘要使用已有已验证登记状态，显示「已拒绝／已允许 · 等待电脑确认」，不把登记说成执行完成。注册／不确定／终态映射定向测试与 TaskInteraction 状态检查通过；完整包 XCTest 13／13、Swift Testing 480 通过（2 外部环境跳过），令牌 5／5、回调 67 处零失败、文案及最终后台编译通过。预算用尽后没有再启动模拟器，**上述两项最终修正需要本人真机看**。

下面 28 张是最后修正之前的追加截图，包含浅深的正常／320 点／大字体／横屏导航，双附件与键盘，PDF 全屏与菜单，两按钮审批／三项选择／询问／大字体上下。文件名含 `approval-receipt` 的图对应失败步骤，不能作为成功回执证据。已发送附件块、图片全屏与实际系统分享／文件保存未取得独立验收图，需要本人真机看。审批展示用合成契约服务，导航／附件页面的账号连接用真实合成宿主；未使用真实云、真实健康数据或个人电脑。

- [apple5add-dark-approval-choices.png](apple5add-dark-approval-choices.png)
- [apple5add-dark-approval-large-bottom.png](apple5add-dark-approval-large-bottom.png)
- [apple5add-dark-approval-large-top.png](apple5add-dark-approval-large-top.png)
- [apple5add-dark-approval-receipt.png](apple5add-dark-approval-receipt.png)
- [apple5add-dark-approval-two-actions.png](apple5add-dark-approval-two-actions.png)
- [apple5add-dark-attachments-keyboard-hidden.png](apple5add-dark-attachments-keyboard-hidden.png)
- [apple5add-dark-attachments-keyboard.png](apple5add-dark-attachments-keyboard.png)
- [apple5add-dark-navigation-320.png](apple5add-dark-navigation-320.png)
- [apple5add-dark-navigation-landscape.png](apple5add-dark-navigation-landscape.png)
- [apple5add-dark-navigation-large.png](apple5add-dark-navigation-large.png)
- [apple5add-dark-navigation.png](apple5add-dark-navigation.png)
- [apple5add-dark-pdf-fullscreen.png](apple5add-dark-pdf-fullscreen.png)
- [apple5add-dark-pdf-menu.png](apple5add-dark-pdf-menu.png)
- [apple5add-dark-question-choices.png](apple5add-dark-question-choices.png)
- [apple5add-light-approval-choices.png](apple5add-light-approval-choices.png)
- [apple5add-light-approval-large-bottom.png](apple5add-light-approval-large-bottom.png)
- [apple5add-light-approval-large-top.png](apple5add-light-approval-large-top.png)
- [apple5add-light-approval-receipt.png](apple5add-light-approval-receipt.png)
- [apple5add-light-approval-two-actions.png](apple5add-light-approval-two-actions.png)
- [apple5add-light-attachments-keyboard-hidden.png](apple5add-light-attachments-keyboard-hidden.png)
- [apple5add-light-attachments-keyboard.png](apple5add-light-attachments-keyboard.png)
- [apple5add-light-navigation-320.png](apple5add-light-navigation-320.png)
- [apple5add-light-navigation-landscape.png](apple5add-light-navigation-landscape.png)
- [apple5add-light-navigation-large.png](apple5add-light-navigation-large.png)
- [apple5add-light-navigation.png](apple5add-light-navigation.png)
- [apple5add-light-pdf-fullscreen.png](apple5add-light-pdf-fullscreen.png)
- [apple5add-light-pdf-menu.png](apple5add-light-pdf-menu.png)
- [apple5add-light-question-choices.png](apple5add-light-question-choices.png)
