# UX-P2 全界面走查

全部使用合成账号、临时目录和随机端口，模型请求为 0；未访问本人程序、日用数据或 8081。Windows 使用真实 Electron（桌面程序框架），手机网页为 360×780 / 390×844；安卓界面包使用相同两种尺寸的 Chromium（浏览器引擎），另外完成独立 APK（安卓安装包）的 MuMu（安卓模拟器）原生主对话、输入区、设置、搜索浅深实拍。

目标页来自本包合入的最新 main（主分支），FX-17 的纠正失败接线已保留。登录 / 引导 7 步、主对话与旁聊、临时对话、项目、动态、目标、成果来源、设置全部分类、各菜单、下拉和确认窗口均有打开态。加载 / 空 / 错误 / 电脑离线 / 未登录 / 无模型 / 长文本分别落在会出现这些状态的实际界面；“结构验收”仅表示确认框打开、布局与控件可达，不表示执行过删除等提交动作。

## 清单列

1 = 无原生控件残留；2 = 可点击控件及四态；3 = 入口位置；4 = 对齐 / 间距 / 溢出；5 = 加载 / 空 / 错误及选中状态；6 = 当前主题 / 尺寸；7 = 参照层级与密度；8 = 菜单 / 弹层打开态。第 9 条“任何不合格即未完成”按所有列均通过执行。

C1 / C4 包含逐图机械检查，其余结合打开态、共同组件和鼠标 / 键盘 / 触摸交互复核。参照图仅在本机查看，没有复制进仓库。设置所有分类的宽窄与手机布局均保留截图；没有把 Chromium 图片标为安卓原生实拍。


走查 **584 行**，覆盖 **107 个命名场景**。

| 页面 / 状态 | 平台 / 外观 | 截图 | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | 发现的问题 / 已修 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| D49-long-press · 最终确认 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-D49-long-press.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-long-press · 最终确认 | android-bundle-360 · light | [打开](after-android-bundle-360-light-D49-long-press.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-tap-time · 最终确认 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-D49-tap-time.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-tap-time · 最终确认 | android-bundle-360 · light | [打开](after-android-bundle-360-light-D49-tap-time.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| activity · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-activity.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| activity · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-activity.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| attachment-menu · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-attachment-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| attachment-menu · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-attachment-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| composer-long · 超长文本 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-composer-long.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-long · 超长文本 | android-bundle-360 · light | [打开](after-android-bundle-360-light-composer-long.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-menu · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-composer-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-menu · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-composer-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| computer-offline · 电脑离线 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-computer-offline.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| computer-offline · 电脑离线 | android-bundle-360 · light | [打开](after-android-bundle-360-light-computer-offline.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goals · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-goals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goals · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-goals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-history · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-main-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-history · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-main-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-search · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-main-search.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 箭头状态、加号语义 / 已统一为箭头与“更多” |
| main-search · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-main-search.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 箭头状态、加号语义 / 已统一为箭头与“更多” |
| memory-rejected · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-memory-rejected.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-memory-rejected.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-memory-rejected-expanded.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-memory-rejected-expanded.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| no-model-empty · 没配模型 / 空对话 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-no-model-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-empty · 没配模型 / 空对话 | android-bundle-360 · light | [打开](after-android-bundle-360-light-no-model-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-history · 没配模型 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-no-model-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-history · 没配模型 | android-bundle-360 · light | [打开](after-android-bundle-360-light-no-model-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| projects-list · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-projects-list.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| projects-list · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-projects-list.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-about · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-about.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-about · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-about.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-account · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-account.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-account · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-account.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-appearance · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-appearance · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-approvals · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-approvals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-approvals · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-approvals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-archived · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-archived.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-archived · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-archived.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-assistant · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-assistant.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-assistant · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-assistant.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-devices · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-devices.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-devices · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-devices.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-general · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-general.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-general · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-general.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-home · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-home.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-home · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-home.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-memory · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-memory.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| settings-memory · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-memory.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| settings-models · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-models.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-models · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-models.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-notifications · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-notifications.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-notifications · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-notifications.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-personalization · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-personalization.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-personalization · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-personalization.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-resources · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-resources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-resources · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-resources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-schedules · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-schedules.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-schedules · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-schedules.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-usage · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-settings-usage.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-usage · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-settings-usage.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| side-completed · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-side-completed.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| side-completed · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-side-completed.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| things · 正常 | android-bundle-360 · dark | [打开](after-android-bundle-360-dark-things.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| things · 正常 | android-bundle-360 · light | [打开](after-android-bundle-360-light-things.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| D49-long-press · 最终确认 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-D49-long-press.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-long-press · 最终确认 | android-bundle-390 · light | [打开](after-android-bundle-390-light-D49-long-press.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-tap-time · 最终确认 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-D49-tap-time.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-tap-time · 最终确认 | android-bundle-390 · light | [打开](after-android-bundle-390-light-D49-tap-time.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| activity · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-activity.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| activity · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-activity.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| attachment-menu · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-attachment-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| attachment-menu · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-attachment-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| composer-long · 超长文本 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-composer-long.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-long · 超长文本 | android-bundle-390 · light | [打开](after-android-bundle-390-light-composer-long.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-menu · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-composer-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-menu · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-composer-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| computer-offline · 电脑离线 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-computer-offline.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| computer-offline · 电脑离线 | android-bundle-390 · light | [打开](after-android-bundle-390-light-computer-offline.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goals · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-goals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goals · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-goals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-history · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-main-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-history · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-main-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-search · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-main-search.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 箭头状态、加号语义 / 已统一为箭头与“更多” |
| main-search · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-main-search.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 箭头状态、加号语义 / 已统一为箭头与“更多” |
| memory-rejected · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-memory-rejected.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-memory-rejected.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-memory-rejected-expanded.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-memory-rejected-expanded.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| no-model-empty · 没配模型 / 空对话 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-no-model-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-empty · 没配模型 / 空对话 | android-bundle-390 · light | [打开](after-android-bundle-390-light-no-model-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-history · 没配模型 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-no-model-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-history · 没配模型 | android-bundle-390 · light | [打开](after-android-bundle-390-light-no-model-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| projects-list · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-projects-list.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| projects-list · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-projects-list.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-about · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-about.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-about · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-about.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-account · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-account.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-account · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-account.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-appearance · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-appearance · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-approvals · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-approvals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-approvals · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-approvals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-archived · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-archived.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-archived · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-archived.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-assistant · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-assistant.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-assistant · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-assistant.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-devices · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-devices.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-devices · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-devices.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-general · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-general.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-general · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-general.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-home · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-home.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-home · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-home.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-memory · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-memory.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| settings-memory · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-memory.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| settings-models · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-models.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-models · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-models.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-notifications · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-notifications.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-notifications · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-notifications.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-personalization · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-personalization.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-personalization · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-personalization.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-resources · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-resources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-resources · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-resources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-schedules · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-schedules.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-schedules · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-schedules.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-usage · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-settings-usage.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-usage · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-settings-usage.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| side-completed · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-side-completed.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| side-completed · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-side-completed.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| things · 正常 | android-bundle-390 · dark | [打开](after-android-bundle-390-dark-things.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| things · 正常 | android-bundle-390 · light | [打开](after-android-bundle-390-light-things.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| 主对话 / 输入区 · 真实 MuMu / 独立包 | android-native · dark | [打开](after-1-android-native-dark.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| 主对话 / 输入区 · 真实 MuMu / 独立包 | android-native · light | [打开](after-1-android-native-light.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| 搜索 / 高亮 · 真实 MuMu / 独立包 | android-native · dark | [打开](after-14-android-native-dark.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| 搜索 / 高亮 · 真实 MuMu / 独立包 | android-native · light | [打开](after-14-android-native-light.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| 设置外观 · 真实 MuMu / 独立包 | android-native · dark | [打开](after-5-android-native-dark-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| 设置外观 · 真实 MuMu / 独立包 | android-native · light | [打开](after-5-android-native-light-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| 设置首页 · 真实 MuMu / 独立包 | android-native · dark | [打开](after-5-android-native-dark-settings.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| 设置首页 · 真实 MuMu / 独立包 | android-native · light | [打开](after-5-android-native-light-settings.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| D49-model-submenu · 最终确认 | electron-1200 · dark | [打开](after-electron-1200-dark-D49-model-submenu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-model-submenu · 最终确认 | electron-1200 · light | [打开](after-electron-1200-light-D49-model-submenu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-reply-menu · 最终确认 | electron-1200 · dark | [打开](after-electron-1200-dark-D49-reply-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-reply-menu · 最终确认 | electron-1200 · light | [打开](after-electron-1200-light-D49-reply-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-user-hover · 最终确认 | electron-1200 · dark | [打开](after-electron-1200-dark-D49-user-hover.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-user-hover · 最终确认 | electron-1200 · light | [打开](after-electron-1200-light-D49-user-hover.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-user-keyboard · 最终确认 | electron-1200 · dark | [打开](after-electron-1200-dark-D49-user-keyboard.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-user-keyboard · 最终确认 | electron-1200 · light | [打开](after-electron-1200-light-D49-user-keyboard.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| account-menu · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-account-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| account-menu · 正常 | electron-1200 · light | [打开](after-electron-1200-light-account-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| activity · 空列表 | electron-1200 · dark | [打开](after-electron-1200-dark-activity.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| activity · 空列表 | electron-1200 · light | [打开](after-electron-1200-light-activity.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| composer-empty · 空输入 | electron-1200 · dark | [打开](after-electron-1200-dark-composer-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-empty · 空输入 | electron-1200 · light | [打开](after-electron-1200-light-composer-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-long · 超长文本 | electron-1200 · dark | [打开](after-electron-1200-dark-composer-long.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-long · 超长文本 | electron-1200 · light | [打开](after-electron-1200-light-composer-long.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-menu · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-composer-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-menu · 正常 | electron-1200 · light | [打开](after-electron-1200-light-composer-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| context-tooltip · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-context-tooltip.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| context-tooltip · 正常 | electron-1200 · light | [打开](after-electron-1200-light-context-tooltip.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| date-control · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-date-control.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| date-control · 正常 | electron-1200 · light | [打开](after-electron-1200-light-date-control.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| dialog-account-model-dialog · 打开态（结构验收） | electron-1200 · dark | [打开](after-electron-1200-dark-dialog-account-model-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-account-model-dialog · 打开态（结构验收） | electron-1200 · light | [打开](after-electron-1200-light-dialog-account-model-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-legal-reader · 打开态（结构验收） | electron-1200 · dark | [打开](after-electron-1200-dark-dialog-legal-reader.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-legal-reader · 打开态（结构验收） | electron-1200 · light | [打开](after-electron-1200-light-dialog-legal-reader.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-memory-detail-dialog · 最终确认 | electron-1200 · dark | [打开](after-electron-1200-dark-dialog-memory-detail-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| dialog-memory-detail-dialog · 最终确认 | electron-1200 · light | [打开](after-electron-1200-light-dialog-memory-detail-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| dialog-password-dialog · 最终确认 | electron-1200 · dark | [打开](after-electron-1200-dark-dialog-password-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-password-dialog · 最终确认 | electron-1200 · light | [打开](after-electron-1200-light-dialog-password-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-revoke-dialog · 最终确认 | electron-1200 · dark | [打开](after-electron-1200-dark-dialog-revoke-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-revoke-dialog · 最终确认 | electron-1200 · light | [打开](after-electron-1200-light-dialog-revoke-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| goal-long-form · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-goal-long-form.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-long-form · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-goal-long-form.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-long-form-select-所属对话 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-goal-long-form-select-所属对话.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-long-form-select-所属对话 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-goal-long-form-select-所属对话.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-goal-schedule-form.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-goal-schedule-form.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-到点做什么 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-goal-schedule-form-select-到点做什么.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-到点做什么 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-goal-schedule-form-select-到点做什么.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-所属对话 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-goal-schedule-form-select-所属对话.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-所属对话 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-goal-schedule-form-select-所属对话.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-时间-分钟 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-goal-schedule-form-select-时间-分钟.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-时间-分钟 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-goal-schedule-form-select-时间-分钟.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-时间-小时 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-goal-schedule-form-select-时间-小时.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-时间-小时 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-goal-schedule-form-select-时间-小时.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-重复 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-goal-schedule-form-select-重复.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-重复 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-goal-schedule-form-select-重复.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goals-empty · 空列表 | electron-1200 · dark | [打开](after-electron-1200-dark-goals-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goals-empty · 空列表 | electron-1200 · light | [打开](after-electron-1200-light-goals-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| history-error · 出错 | electron-1200 · dark | [打开](after-electron-1200-dark-history-error.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| history-error · 出错 | electron-1200 · light | [打开](after-electron-1200-light-history-error.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| history-loading · 加载中 | electron-1200 · dark | [打开](after-electron-1200-dark-history-loading.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| history-loading · 加载中 | electron-1200 · light | [打开](after-electron-1200-light-history-loading.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-history · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-main-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-history · 正常 | electron-1200 · light | [打开](after-electron-1200-light-main-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-search · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-main-search.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 箭头状态、加号语义 / 已统一为箭头与“更多” |
| main-search · 正常 | electron-1200 · light | [打开](after-electron-1200-light-main-search.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 箭头状态、加号语义 / 已统一为箭头与“更多” |
| memory-empty · 空列表 | electron-1200 · dark | [打开](after-electron-1200-dark-memory-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-empty · 空列表 | electron-1200 · light | [打开](after-electron-1200-light-memory-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-error · 出错 | electron-1200 · dark | [打开](after-electron-1200-dark-memory-error.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-error · 出错 | electron-1200 · light | [打开](after-electron-1200-light-memory-error.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-export-menu · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-memory-export-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-export-menu · 正常 | electron-1200 · light | [打开](after-electron-1200-light-memory-export-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-normal · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-memory-normal.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-normal · 正常 | electron-1200 · light | [打开](after-electron-1200-light-memory-normal.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected · 异常 | electron-1200 · dark | [打开](after-electron-1200-dark-memory-rejected.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected · 异常 | electron-1200 · light | [打开](after-electron-1200-light-memory-rejected.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-memory-rejected-expanded.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded · 正常 | electron-1200 · light | [打开](after-electron-1200-light-memory-rejected-expanded.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded-final · 最终确认 | electron-1200 · dark | [打开](after-electron-1200-dark-memory-rejected-expanded-final.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded-final · 最终确认 | electron-1200 · light | [打开](after-electron-1200-light-memory-rejected-expanded-final.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-turn-warning · 最终确认 | electron-1200 · dark | [打开](after-electron-1200-dark-memory-turn-warning.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-turn-warning · 最终确认 | electron-1200 · light | [打开](after-electron-1200-light-memory-turn-warning.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-warning · 异常 | electron-1200 · dark | [打开](after-electron-1200-dark-memory-warning.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-warning · 异常 | electron-1200 · light | [打开](after-electron-1200-light-memory-warning.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| model-editor · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-model-editor.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| model-editor · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-model-editor.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| model-editor-select-位置 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-model-editor-select-位置.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| model-editor-select-位置 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-model-editor-select-位置.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| new-chat-menu · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-new-chat-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| new-chat-menu · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-new-chat-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| no-model-empty · 没配模型 / 空对话 | electron-1200 · dark | [打开](after-electron-1200-dark-no-model-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-empty · 没配模型 / 空对话 | electron-1200 · light | [打开](after-electron-1200-light-no-model-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-history · 没配模型 | electron-1200 · dark | [打开](after-electron-1200-dark-no-model-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-history · 没配模型 | electron-1200 · light | [打开](after-electron-1200-light-no-model-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| onboarding-0 · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-onboarding-0.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| onboarding-0 · 正常 | electron-1200 · light | [打开](after-electron-1200-light-onboarding-0.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| onboarding-1 · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-onboarding-1.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| onboarding-1 · 正常 | electron-1200 · light | [打开](after-electron-1200-light-onboarding-1.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| onboarding-2 · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-onboarding-2.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| onboarding-2 · 正常 | electron-1200 · light | [打开](after-electron-1200-light-onboarding-2.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| onboarding-3 · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-onboarding-3.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| onboarding-3 · 正常 | electron-1200 · light | [打开](after-electron-1200-light-onboarding-3.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| onboarding-4 · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-onboarding-4.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| onboarding-4 · 正常 | electron-1200 · light | [打开](after-electron-1200-light-onboarding-4.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| onboarding-5 · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-onboarding-5.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| onboarding-5 · 正常 | electron-1200 · light | [打开](after-electron-1200-light-onboarding-5.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| onboarding-6 · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-onboarding-6.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| onboarding-6 · 正常 | electron-1200 · light | [打开](after-electron-1200-light-onboarding-6.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| outputs-empty · 空列表 | electron-1200 · dark | [打开](after-electron-1200-dark-outputs-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| outputs-empty · 空列表 | electron-1200 · light | [打开](after-electron-1200-light-outputs-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| project-conversation-empty · 空对话 | electron-1200 · dark | [打开](after-electron-1200-dark-project-conversation-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| project-conversation-empty · 空对话 | electron-1200 · light | [打开](after-electron-1200-light-project-conversation-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| project-edit-dialog · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-project-edit-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| project-edit-dialog · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-project-edit-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| project-long-dialog · 超长文本 | electron-1200 · dark | [打开](after-electron-1200-dark-project-long-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| project-long-dialog · 超长文本 | electron-1200 · light | [打开](after-electron-1200-light-project-long-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| project-new-dialog · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-project-new-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| project-new-dialog · 正常 | electron-1200 · light | [打开](after-electron-1200-light-project-new-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| project-remove-dialog · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-project-remove-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| project-remove-dialog · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-project-remove-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| reply-menu · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-reply-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 默认菜单、无选中态 / 已复用统一组件 |
| reply-menu · 正常 | electron-1200 · light | [打开](after-electron-1200-light-reply-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 默认菜单、无选中态 / 已复用统一组件 |
| reply-model-submenu · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-reply-model-submenu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 默认菜单、无选中态 / 已复用统一组件 |
| reply-model-submenu · 正常 | electron-1200 · light | [打开](after-electron-1200-light-reply-model-submenu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 默认菜单、无选中态 / 已复用统一组件 |
| session-delete-dialog · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-session-delete-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| session-delete-dialog · 正常 | electron-1200 · light | [打开](after-electron-1200-light-session-delete-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| session-menu · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-session-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| session-menu · 正常 | electron-1200 · light | [打开](after-electron-1200-light-session-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| session-rename-dialog · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-session-rename-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| session-rename-dialog · 正常 | electron-1200 · light | [打开](after-electron-1200-light-session-rename-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| settings-about · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-about.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-about · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-about.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-account · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-account.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-account · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-account.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-appearance · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-appearance · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-approvals · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-approvals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-approvals · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-approvals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-archived · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-archived.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-archived · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-archived.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-assistant · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-assistant.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-assistant · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-assistant.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-backups · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-backups.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-backups · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-backups.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-devices · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-devices.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-devices · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-devices.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-general · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-general.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-general · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-general.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-memory · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-memory.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| settings-memory · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-memory.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| settings-models · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-models.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-models · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-models.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-notifications · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-notifications.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-notifications · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-notifications.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-personalization · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-personalization.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-personalization · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-personalization.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-resources · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-resources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-resources · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-resources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-schedules · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-schedules.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-schedules · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-schedules.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-system · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-system.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-system · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-system.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-usage · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-usage.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-usage · 正常 | electron-1200 · light | [打开](after-electron-1200-light-settings-usage.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-个性化-select-回复语气 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-个性化-select-回复语气.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-个性化-select-回复语气 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-settings-个性化-select-回复语气.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-助手-select-回复进行中时发送的消息 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-助手-select-回复进行中时发送的消息.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-助手-select-回复进行中时发送的消息 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-settings-助手-select-回复进行中时发送的消息.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-助手-select-回答详细程度 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-助手-select-回答详细程度.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-助手-select-回答详细程度 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-settings-助手-select-回答详细程度.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-助手-select-显示思考过程 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-助手-select-显示思考过程.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-助手-select-显示思考过程 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-settings-助手-select-显示思考过程.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-外观-select-主题色 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-外观-select-主题色.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-外观-select-主题色 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-settings-外观-select-主题色.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-外观-select-字号 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-外观-select-字号.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-外观-select-字号 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-settings-外观-select-字号.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-审批-select-新对话的默认模式 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-审批-select-新对话的默认模式.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-审批-select-新对话的默认模式 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-settings-审批-select-新对话的默认模式.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-模型-select-对话默认模型 · 打开态 | electron-1200 · dark | [打开](after-electron-1200-dark-settings-模型-select-对话默认模型.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-模型-select-对话默认模型 · 打开态 | electron-1200 · light | [打开](after-electron-1200-light-settings-模型-select-对话默认模型.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| side-running-approval-question · 运行中 / 审批 / 提问 | electron-1200 · dark | [打开](after-electron-1200-dark-side-running-approval-question.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| side-running-approval-question · 运行中 / 审批 / 提问 | electron-1200 · light | [打开](after-electron-1200-light-side-running-approval-question.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| subtask-menu · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-subtask-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| subtask-menu · 正常 | electron-1200 · light | [打开](after-electron-1200-light-subtask-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| temporary-empty · 空对话 | electron-1200 · dark | [打开](after-electron-1200-dark-temporary-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| temporary-empty · 空对话 | electron-1200 · light | [打开](after-electron-1200-light-temporary-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| user-focus · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-user-focus.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| user-focus · 正常 | electron-1200 · light | [打开](after-electron-1200-light-user-focus.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| user-hover · 正常 | electron-1200 · dark | [打开](after-electron-1200-dark-user-hover.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| user-hover · 正常 | electron-1200 · light | [打开](after-electron-1200-light-user-hover.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-model-submenu · 最终确认 | electron-480 · dark | [打开](after-electron-480-dark-D49-model-submenu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-model-submenu · 最终确认 | electron-480 · light | [打开](after-electron-480-light-D49-model-submenu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-reply-menu · 最终确认 | electron-480 · dark | [打开](after-electron-480-dark-D49-reply-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-reply-menu · 最终确认 | electron-480 · light | [打开](after-electron-480-light-D49-reply-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-user-hover · 最终确认 | electron-480 · dark | [打开](after-electron-480-dark-D49-user-hover.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-user-hover · 最终确认 | electron-480 · light | [打开](after-electron-480-light-D49-user-hover.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-user-keyboard · 最终确认 | electron-480 · dark | [打开](after-electron-480-dark-D49-user-keyboard.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| D49-user-keyboard · 最终确认 | electron-480 · light | [打开](after-electron-480-light-D49-user-keyboard.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| account-menu · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-account-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| account-menu · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-account-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| activity · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-activity.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| activity · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-activity.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| composer-empty · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-composer-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-empty · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-composer-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-long · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-composer-long.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-long · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-composer-long.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-menu · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-composer-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-menu · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-composer-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| context-tooltip · 正常 | electron-480 · dark | [打开](after-electron-480-dark-context-tooltip.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| context-tooltip · 正常 | electron-480 · light | [打开](after-electron-480-light-context-tooltip.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| date-control · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-date-control.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| date-control · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-date-control.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| dialog-account-model-dialog · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-dialog-account-model-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-account-model-dialog · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-dialog-account-model-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-legal-reader · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-dialog-legal-reader.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-legal-reader · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-dialog-legal-reader.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-memory-detail-dialog · 最终确认 | electron-480 · dark | [打开](after-electron-480-dark-dialog-memory-detail-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| dialog-memory-detail-dialog · 最终确认 | electron-480 · light | [打开](after-electron-480-light-dialog-memory-detail-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| dialog-password-dialog · 最终确认 | electron-480 · dark | [打开](after-electron-480-dark-dialog-password-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-password-dialog · 最终确认 | electron-480 · light | [打开](after-electron-480-light-dialog-password-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-revoke-dialog · 最终确认 | electron-480 · dark | [打开](after-electron-480-dark-dialog-revoke-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| dialog-revoke-dialog · 最终确认 | electron-480 · light | [打开](after-electron-480-light-dialog-revoke-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| history-error · 出错 | electron-480 · dark | [打开](after-electron-480-dark-history-error.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| history-error · 出错 | electron-480 · light | [打开](after-electron-480-light-history-error.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| history-loading · 加载中 | electron-480 · dark | [打开](after-electron-480-dark-history-loading.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| history-loading · 加载中 | electron-480 · light | [打开](after-electron-480-light-history-loading.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| login · 未登录 | electron-480 · dark | [打开](after-electron-480-dark-login.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| login · 未登录 | electron-480 · light | [打开](after-electron-480-light-login.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-history · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-main-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-history · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-main-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-search · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-main-search.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 箭头状态、加号语义 / 已统一为箭头与“更多” |
| main-search · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-main-search.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 箭头状态、加号语义 / 已统一为箭头与“更多” |
| memory-empty · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-memory-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-empty · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-memory-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-error · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-memory-error.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-error · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-memory-error.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-export-menu · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-memory-export-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-export-menu · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-memory-export-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-normal · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-memory-normal.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-normal · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-memory-normal.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-memory-rejected.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-memory-rejected.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-memory-rejected-expanded.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-memory-rejected-expanded.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded-final · 最终确认 | electron-480 · dark | [打开](after-electron-480-dark-memory-rejected-expanded-final.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded-final · 最终确认 | electron-480 · light | [打开](after-electron-480-light-memory-rejected-expanded-final.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-turn-warning · 最终确认 | electron-480 · dark | [打开](after-electron-480-dark-memory-turn-warning.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-turn-warning · 最终确认 | electron-480 · light | [打开](after-electron-480-light-memory-turn-warning.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-warning · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-memory-warning.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-warning · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-memory-warning.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| no-model-empty · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-no-model-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-empty · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-no-model-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-history · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-no-model-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-history · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-no-model-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| output-preview · 正常 | electron-480 · dark | [打开](after-electron-480-dark-output-preview.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| output-preview · 正常 | electron-480 · light | [打开](after-electron-480-light-output-preview.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| outputs-empty · 空列表 | electron-480 · dark | [打开](after-electron-480-dark-outputs-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| outputs-empty · 空列表 | electron-480 · light | [打开](after-electron-480-light-outputs-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| outputs-sources · 正常 | electron-480 · dark | [打开](after-electron-480-dark-outputs-sources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| outputs-sources · 正常 | electron-480 · light | [打开](after-electron-480-light-outputs-sources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| project-long-dialog · 超长文本 | electron-480 · dark | [打开](after-electron-480-dark-project-long-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| project-long-dialog · 超长文本 | electron-480 · light | [打开](after-electron-480-light-project-long-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| project-new-dialog · 正常 | electron-480 · dark | [打开](after-electron-480-dark-project-new-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| project-new-dialog · 正常 | electron-480 · light | [打开](after-electron-480-light-project-new-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| reply-menu · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-reply-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 默认菜单、无选中态 / 已复用统一组件 |
| reply-menu · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-reply-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 默认菜单、无选中态 / 已复用统一组件 |
| reply-model-submenu · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-reply-model-submenu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 默认菜单、无选中态 / 已复用统一组件 |
| reply-model-submenu · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-reply-model-submenu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 默认菜单、无选中态 / 已复用统一组件 |
| session-delete-dialog · 正常 | electron-480 · dark | [打开](after-electron-480-dark-session-delete-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| session-delete-dialog · 正常 | electron-480 · light | [打开](after-electron-480-light-session-delete-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| session-menu · 正常 | electron-480 · dark | [打开](after-electron-480-dark-session-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| session-menu · 正常 | electron-480 · light | [打开](after-electron-480-light-session-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| session-rename-dialog · 正常 | electron-480 · dark | [打开](after-electron-480-dark-session-rename-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| session-rename-dialog · 正常 | electron-480 · light | [打开](after-electron-480-light-session-rename-dialog.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 部分深色确认框白底 / 已使用主题表面 |
| settings-about · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-about.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-about · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-about.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-account · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-account.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-account · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-account.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-appearance · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-appearance · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-approvals · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-approvals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-approvals · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-approvals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-archived · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-archived.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-archived · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-archived.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-assistant · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-assistant.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-assistant · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-assistant.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-backups · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-backups.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-backups · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-backups.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-devices · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-devices.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-devices · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-devices.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-general · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-general.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-general · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-general.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-memory · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-memory.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| settings-memory · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-memory.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| settings-models · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-models.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-models · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-models.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-notifications · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-notifications.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-notifications · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-notifications.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-personalization · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-personalization.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-personalization · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-personalization.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-resources · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-resources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-resources · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-resources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-schedules · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-schedules.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-schedules · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-schedules.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-system · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-system.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-system · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-system.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-usage · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-settings-usage.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-usage · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-settings-usage.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| side-running-approval-question · 运行中 / 审批 / 提问 | electron-480 · dark | [打开](after-electron-480-dark-side-running-approval-question.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| side-running-approval-question · 运行中 / 审批 / 提问 | electron-480 · light | [打开](after-electron-480-light-side-running-approval-question.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| subtask-menu · 正常 | electron-480 · dark | [打开](after-electron-480-dark-subtask-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| subtask-menu · 正常 | electron-480 · light | [打开](after-electron-480-light-subtask-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| user-focus · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-user-focus.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| user-focus · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-user-focus.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| user-hover · 窄窗 / 打开态 | electron-480 · dark | [打开](after-electron-480-dark-user-hover.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| user-hover · 窄窗 / 打开态 | electron-480 · light | [打开](after-electron-480-light-user-hover.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 气泡内操作与编辑入口 / 已移出并移除 |
| composer-long · 超长文本 | phone-web-360 · dark | [打开](after-phone-web-360-dark-composer-long.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-long · 超长文本 | phone-web-360 · light | [打开](after-phone-web-360-light-composer-long.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-menu · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-composer-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-menu · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-composer-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| goal-long-form · 打开态 | phone-web-360 · dark | [打开](after-phone-web-360-dark-goal-long-form.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-long-form · 打开态 | phone-web-360 · light | [打开](after-phone-web-360-light-goal-long-form.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-long-form-select-所属对话 · 打开态 | phone-web-360 · dark | [打开](after-phone-web-360-dark-goal-long-form-select-所属对话.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-long-form-select-所属对话 · 打开态 | phone-web-360 · light | [打开](after-phone-web-360-light-goal-long-form-select-所属对话.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form · 打开态 | phone-web-360 · dark | [打开](after-phone-web-360-dark-goal-schedule-form.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form · 打开态 | phone-web-360 · light | [打开](after-phone-web-360-light-goal-schedule-form.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-到点做什么 · 打开态 | phone-web-360 · dark | [打开](after-phone-web-360-dark-goal-schedule-form-select-到点做什么.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-到点做什么 · 打开态 | phone-web-360 · light | [打开](after-phone-web-360-light-goal-schedule-form-select-到点做什么.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-所属对话 · 打开态 | phone-web-360 · dark | [打开](after-phone-web-360-dark-goal-schedule-form-select-所属对话.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-所属对话 · 打开态 | phone-web-360 · light | [打开](after-phone-web-360-light-goal-schedule-form-select-所属对话.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-时间-分钟 · 打开态 | phone-web-360 · dark | [打开](after-phone-web-360-dark-goal-schedule-form-select-时间-分钟.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-时间-分钟 · 打开态 | phone-web-360 · light | [打开](after-phone-web-360-light-goal-schedule-form-select-时间-分钟.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-时间-小时 · 打开态 | phone-web-360 · dark | [打开](after-phone-web-360-dark-goal-schedule-form-select-时间-小时.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-时间-小时 · 打开态 | phone-web-360 · light | [打开](after-phone-web-360-light-goal-schedule-form-select-时间-小时.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-重复 · 打开态 | phone-web-360 · dark | [打开](after-phone-web-360-dark-goal-schedule-form-select-重复.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-重复 · 打开态 | phone-web-360 · light | [打开](after-phone-web-360-light-goal-schedule-form-select-重复.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goals-empty · 空列表 | phone-web-360 · dark | [打开](after-phone-web-360-dark-goals-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goals-empty · 空列表 | phone-web-360 · light | [打开](after-phone-web-360-light-goals-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| login · 未登录 | phone-web-360 · dark | [打开](after-phone-web-360-dark-login.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| login · 未登录 | phone-web-360 · light | [打开](after-phone-web-360-light-login.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-history · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-main-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-history · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-main-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-search · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-main-search.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 箭头状态、加号语义 / 已统一为箭头与“更多” |
| main-search · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-main-search.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 箭头状态、加号语义 / 已统一为箭头与“更多” |
| memory-rejected · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-memory-rejected.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-memory-rejected.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-memory-rejected-expanded.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-memory-rejected-expanded.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| no-model-empty · 没配模型 / 空对话 | phone-web-360 · dark | [打开](after-phone-web-360-dark-no-model-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-empty · 没配模型 / 空对话 | phone-web-360 · light | [打开](after-phone-web-360-light-no-model-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-history · 没配模型 | phone-web-360 · dark | [打开](after-phone-web-360-dark-no-model-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-history · 没配模型 | phone-web-360 · light | [打开](after-phone-web-360-light-no-model-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| settings-about · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-about.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-about · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-about.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-account · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-account.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-account · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-account.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-appearance · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-appearance · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-approvals · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-approvals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-approvals · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-approvals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-archived · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-archived.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-archived · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-archived.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-assistant · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-assistant.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-assistant · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-assistant.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-devices · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-devices.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-devices · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-devices.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-general · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-general.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-general · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-general.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-home · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-home.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-home · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-home.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-memory · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-memory.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| settings-memory · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-memory.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| settings-models · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-models.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-models · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-models.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-notifications · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-notifications.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-notifications · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-notifications.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-personalization · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-personalization.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-personalization · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-personalization.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-resources · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-resources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-resources · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-resources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-schedules · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-schedules.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-schedules · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-schedules.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-usage · 正常 | phone-web-360 · dark | [打开](after-phone-web-360-dark-settings-usage.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-usage · 正常 | phone-web-360 · light | [打开](after-phone-web-360-light-settings-usage.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| composer-long · 超长文本 | phone-web-390 · dark | [打开](after-phone-web-390-dark-composer-long.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-long · 超长文本 | phone-web-390 · light | [打开](after-phone-web-390-light-composer-long.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-menu · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-composer-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| composer-menu · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-composer-menu.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 缩放把手、思考单独描边 / 已统一 |
| goal-long-form · 打开态 | phone-web-390 · dark | [打开](after-phone-web-390-dark-goal-long-form.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-long-form · 打开态 | phone-web-390 · light | [打开](after-phone-web-390-light-goal-long-form.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-long-form-select-所属对话 · 打开态 | phone-web-390 · dark | [打开](after-phone-web-390-dark-goal-long-form-select-所属对话.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-long-form-select-所属对话 · 打开态 | phone-web-390 · light | [打开](after-phone-web-390-light-goal-long-form-select-所属对话.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form · 打开态 | phone-web-390 · dark | [打开](after-phone-web-390-dark-goal-schedule-form.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form · 打开态 | phone-web-390 · light | [打开](after-phone-web-390-light-goal-schedule-form.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-到点做什么 · 打开态 | phone-web-390 · dark | [打开](after-phone-web-390-dark-goal-schedule-form-select-到点做什么.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-到点做什么 · 打开态 | phone-web-390 · light | [打开](after-phone-web-390-light-goal-schedule-form-select-到点做什么.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-所属对话 · 打开态 | phone-web-390 · dark | [打开](after-phone-web-390-dark-goal-schedule-form-select-所属对话.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-所属对话 · 打开态 | phone-web-390 · light | [打开](after-phone-web-390-light-goal-schedule-form-select-所属对话.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-时间-分钟 · 打开态 | phone-web-390 · dark | [打开](after-phone-web-390-dark-goal-schedule-form-select-时间-分钟.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-时间-分钟 · 打开态 | phone-web-390 · light | [打开](after-phone-web-390-light-goal-schedule-form-select-时间-分钟.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-时间-小时 · 打开态 | phone-web-390 · dark | [打开](after-phone-web-390-dark-goal-schedule-form-select-时间-小时.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-时间-小时 · 打开态 | phone-web-390 · light | [打开](after-phone-web-390-light-goal-schedule-form-select-时间-小时.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-重复 · 打开态 | phone-web-390 · dark | [打开](after-phone-web-390-dark-goal-schedule-form-select-重复.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goal-schedule-form-select-重复 · 打开态 | phone-web-390 · light | [打开](after-phone-web-390-light-goal-schedule-form-select-重复.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goals-empty · 空列表 | phone-web-390 · dark | [打开](after-phone-web-390-dark-goals-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| goals-empty · 空列表 | phone-web-390 · light | [打开](after-phone-web-390-light-goals-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| login · 未登录 | phone-web-390 · dark | [打开](after-phone-web-390-dark-login.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| login · 未登录 | phone-web-390 · light | [打开](after-phone-web-390-light-login.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-history · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-main-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-history · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-main-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| main-search · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-main-search.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 箭头状态、加号语义 / 已统一为箭头与“更多” |
| main-search · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-main-search.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 箭头状态、加号语义 / 已统一为箭头与“更多” |
| memory-rejected · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-memory-rejected.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-memory-rejected.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-memory-rejected-expanded.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| memory-rejected-expanded · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-memory-rejected-expanded.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| no-model-empty · 没配模型 / 空对话 | phone-web-390 · dark | [打开](after-phone-web-390-dark-no-model-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-empty · 没配模型 / 空对话 | phone-web-390 · light | [打开](after-phone-web-390-light-no-model-empty.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-history · 没配模型 | phone-web-390 · dark | [打开](after-phone-web-390-dark-no-model-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| no-model-history · 没配模型 | phone-web-390 · light | [打开](after-phone-web-390-light-no-model-history.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 标题上方提示 / 已改空状态或输入区提示 |
| settings-about · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-about.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-about · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-about.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-account · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-account.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-account · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-account.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-appearance · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-appearance · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-appearance.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-approvals · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-approvals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-approvals · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-approvals.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-archived · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-archived.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-archived · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-archived.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-assistant · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-assistant.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-assistant · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-assistant.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-devices · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-devices.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-devices · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-devices.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-general · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-general.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-general · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-general.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-home · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-home.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-home · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-home.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-memory · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-memory.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| settings-memory · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-memory.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 导出拥挤、异常重复 / 已合并与重排 |
| settings-models · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-models.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-models · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-models.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-notifications · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-notifications.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-notifications · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-notifications.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-personalization · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-personalization.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-personalization · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-personalization.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-resources · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-resources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-resources · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-resources.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-schedules · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-schedules.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-schedules · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-schedules.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-usage · 正常 | phone-web-390 · dark | [打开](after-phone-web-390-dark-settings-usage.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |
| settings-usage · 正常 | phone-web-390 · light | [打开](after-phone-web-390-light-settings-usage.png) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — / 通过 |

## 遗留与边界

- 本包无需要另做设计的前端遗留。Apple（苹果端）原生修改留给对应工作包，清单见 README。
- 真实安卓最终复验已通过；构建期间曾被 S3a 占用、模拟器曾被另包关闭，未干预其他测试应用。最后一次使用本包启动的 MuMu 0 完成验证并立即关闭。原生版本号保持 0.8.16 / code29；兜底页隐藏的 Kotlin（安卓语言）改动需随下一次新壳版本发布，由 Claude 统一递增。
- 全量测试交 CI（持续集成）；没有在本地跑全仓。相关交互、类型检查、资源一致性和独立安卓构建结果见 README。合成接口不证明真实模型、云部署或真实记忆形成的质量。

