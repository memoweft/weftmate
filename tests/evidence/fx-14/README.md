# FX-14 · 非记忆问题修复

只使用合成账号、随机端口与隔离目录。未请求 8081 / 18186，未控制日用计划任务或读取本人备份。记忆形成与旧记忆可见不在本包范围。

| QA-3 项 | 根因与修复 | 本轮证据 |
|---|---|---|
| B01 在线误入离线页 | 写请求缺保护头且双重编码；同步错误被当成断连。两端传对象并启用保护写入，只把明确传输不可达归为离线；轮询不改变导航，“返回”持续有效；离线内容放入聊天滚动区，不能覆盖操作区 | [真实 HTTP（网页传输协议）前后探针](offline/production-transport-proof.json)、[安卓完整链](android-inline/android-visual-verification.json)、[390×844 手机网页完整链](mobile-web-retry/mobile-web-visual-verification.json) |
| 02 迁移 Verify 401 | 匿名配置请求受保护。改用公开 `/personal/v1/auth/state`，检查实际响应结构；配置仍受保护 | [真实安装包 Prepare → 启动 → Verify 演练](migration/verification.json)、[安装版截图](migration/installed-rehearsal.png) |
| 05 项目双滚动 | 弹窗与滚动表单相邻；动作在表单内。外层限制高度，内容区滚动，动作分离为固定底部 | [四种尺寸／主题验证](project-dialog/verification.json)、[窄深](project-dialog/480-dark.png)、[宽浅](project-dialog/1200-light.png) |
| 06 Mac 滚动断言 | 原断言把 ResizeObserver（尺寸观察器）下一帧贴底当成跳动；同步折叠再展开也不是实际点击。改用真实点击，分别检查贴底与长记录阅读锚点 | [首轮 Mac 原断言失败](mac/before.log)、[最终 Mac 通过](mac/after-final.log)、[Windows 通过](windows-motion.log) |
| 04 停止按钮 p95（第95百分位） | 按 FX-13 逐条追加请求记录方法独立测量 30 轮；结果待当前批次完成 | [逐轮结果](stop-desktop/results.json) |
| 07 模型五分钟静默 | 原生 DSH（助手运行时）流空闲超时默认为 300 秒。宿主默认改为 90 秒，环境变量 `WEFTMATE_STREAM_IDLE_TIMEOUT_MS` 可改，提供方 `streamIdleTimeoutMs` 优先；仍用原生取消／重试，未新增次数限制 | [合成慢流测试](../../../model-stream-timeout.test.ts)、[45 项定向测试](targeted-tests.log)、[类型检查](typecheck.log) |

首块只有角色／空包不算内容进展。合成慢流分别验证静默流一次原生重试成功、持续增量的总时长超过空闲预算仍成功、用户取消后不重试，并检查重试进展提示发布。90 秒为模型启动留出约一分钟的余量，避免原问题的五分钟静默等待，不保证真实模型速度。

安卓与网页均从全新云账号注册，真实桌面批准手机，手机请求创建合成文件并处理审批，浅深设置、项目新对话、第二账号隔离及切回后的设备允许均通过；离线遮挡 0。安卓测试 APK（安卓安装包）复用已有独立 `fx9qa` 验收身份，不覆盖调试应用；测试应用、反向映射、调试转发已清理，系统主题已恢复，模拟器已关闭。未通过强制点击或移除遮挡层提高成绩。

失败尝试保留：`android/` 的旧精确名称定位不适应当前侧栏；`android-final/` 的运行器没有取消“移至项目”；`android-complete/` 的“新对话”名称匹配重复；`mobile-web/` 首次主进程启动调试连接中断。均未计作完整链通过。`android-verified/` 在离线内容改为聊天区内呈现前已完整通过，最终以 `android-inline/` 为准。`windows-motion-first.log` 显示首次断言准备方式仍有同步折叠／滚动钳制竞态，之后改为实际点击和明确阅读场景，未放宽性能或动画布局门槛。Mac 首次原断言失败，第二次原断言通过，说明旧瞬时几何采样与贴底调度存在竞态；最终两端新行为断言通过。

安装首轮三分钟测试预算中断，第二轮隔离目录缺少既有宿主标记而拒绝启动，随后补正确夹具并用既有十分钟安装预算完成演练；[拒绝启动记录](migration/marker-missing-attempt.json) 保留。自动审批审查拒绝递归删除首轮合成迁移临时目录，返回 `blocked by policy`（策略阻止），未给出具体原因；该目录保留，后续成功演练目录已清理。未删除或放宽宿主标记保护。

[MiMo 用量](mimo-usage.json)：21 笔实际推理、21 笔完整用量，输入 66,683 token（词元），缓存输入 32,832，输出 1,329。包括失败尝试和后台标题请求，不是账户账单。停止、HTTP 探针和慢流均无付费模型请求。[公开扫描](privacy-scan.json) 不含实际密钥、私有 LAN（局域网）服务目的地、凭据、证书或运行数据；截图使用合成内容。[Mac 清理](mac/cleanup.json) 含独立工作树与本轮临时目录。
