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
