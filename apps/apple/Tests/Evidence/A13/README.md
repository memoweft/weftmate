# A13 · Apple 跟随 UX-1 的界面一致性

仅使用合成账号、合成内容、随机回环端口和隔离目录。真实 macOS / iPhone / Watch 原生界面，真实个人宿主认证、提问与审批 HTTP；规划器、DSH 日志和模型为合成，不代表编译 DSH、真实模型、生产中继或真机验收。

Mac / iPhone 提问位于输入区正上方，与审批共用位置，审批优先并显示等待的问题数。逐题填写、余数、完整说明、单选 / 多选 / 其他回答；最后按原契约整批提交。匹配请求与整批回答的有效回执或读回立即移除提问条，原位置保留一行「已回答」。未知回执保留原请求与草稿，既有账户 / 设备 / 来源校验、持久重试及原生接收确认继续独立执行。

Mac 提交按钮使用原生 NSButton 第一响应者处理 Return，未设置默认 / 全局 Return 快捷键；颜色、字号、间距和圆角来自 AppleTokens。iPhone 使用原生 SwiftUI 焦点与按键处理。输入框的 Return 不提交。Mac 验收使用 A10 自有控件 / 窗口运行器、目标文本框自己的原生编辑器、真实按钮与自有窗口按键事件，没有全局辅助功能权限或全局输入。

中文操作 / 参数名由 `Scripts/generate_operation_names.mjs` 从 `src/ui-core/timeline-model.js` 生成，Swift 与 Node 均逐项核对。来源、步骤、审批、详情及错误复用这些名称，未知扩展与参数使用中文兜底；文件名、正文、命令及输出保持内容。详情的高级显示也使用中文参数名，原始协议仍可复制。Watch 审批经 iPhone 共用同一描述。

时间戳按设备时区显示中文年月日和 24 小时制；用量继续向实际接口传设备时区。Mac / iPhone 复用同一原生月份选择器，完整日历年与上一年 / 下一年浏览跟随 UX-1，选择后实际统计请求切换月份。历史健康日摘要保留其所属日，仅改变显示格式，不改变健康计算 / 上传字段。

复查 A12：保留真实 SMAppService 开机自启；移除静态密度 / 语言行、过时的设备管理说明及对应搜索词；A12 已移除的共享 / 通知空壳不恢复。

`check_ui_copy.mjs` 导入 Windows UX-1 的同一个内部名称规则，扫描 Swift 人话字符串、可见 API 字符串与本地字符串资源；再扫描随原图采集的原生辅助功能文字，包含多行详情。标识和传输键不是界面文案。没有声称 OCR，PNG 均为未经裁剪、缩放或修改的原图。仓库 CI 的 `tests/apple-ui-copy.test.ts` 检查生成表、扫描反例与四种主题 / 平台及 Watch 的必需场景。

验证汇总与源码 / 二进制 / 原图指纹见 `validation.json`、`screenshots.json`；行为回执位于每个平台 / 主题目录的 `host-receipts.json`。截图文字在 `screenshot-text.json`。

重跑（仓库根；先串行构建，所有 xcodebuild 均 `-jobs 2`）：

```sh
node apps/apple/Scripts/generate_operation_names.mjs --check
swift test --package-path apps/apple/Packages/WeftMateCore --jobs 2 --filter 'A13ConsistencyTests|ApprovalQuestionSDKTests|AppleParityTests|A9PolishTests|ConversationResourcesTests|ConversationFlowTests'
python3 apps/apple/Scripts/run_state_checks.py --artifacts apps/apple/Build/A13-State-Rerun --check TaskInteractionChecks --check ToolProgressChecks
node apps/apple/Scripts/check_ui_copy.mjs
node --test tests/apple-ui-copy.test.ts tests/design-tokens.test.ts
python3 apps/apple/Tests/run_a13.py --platform mac --theme light --app <Mac Debug executable> --capture <compiled A5MacCapture> --evidence <evidence>
python3 apps/apple/Tests/run_a13.py --platform iphone --theme light --xctestrun <Phone xctestrun> --simulator <isolated iPhone> --result <new xcresult> --evidence <evidence>
# 同样运行 dark；Watch 只开已配对的 iPhone + Watch：
python3 apps/apple/Tests/run_a13_watch.py --phone <paired iPhone> --watch <paired Watch> --products <Build/Products> --xctestrun <Watch xctestrun> --result <new xcresult> --evidence <evidence>
xcrun simctl shutdown all
```

无 `/personal/v1` 契约变化、无新增系统权限、无日用数据操作、无发布 / 部署 / 自动合并。完整仓库测试由 PR CI 执行。
