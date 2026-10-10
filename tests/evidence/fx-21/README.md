# FX-21 · 迁移阻断修复

所有账号、消息、文件、模型响应均为合成数据；只用随机端口、系统临时目录和独立安装身份。未请求 8081 / 18186，未操作本人程序或数据。QA-6 原证据目录只读。真实模型请求 0，费用 0。

## 前后对照

| 项目 | 修复前 | 修复后与保护点 |
|---|---|---|
| B01 主对话首句 | `b01-before.txt`、`b01-both-before.txt`：新账号与旧账号升级在真实 `src/main.mjs` + 固定 DSH（助手运行时）拒绝 `chat.message / BACKEND_UNAVAILABLE` | `b01-after.txt`、`b01-upgrade-after.txt`：同一真实测试通过；旧日用 `f787c3c` 代码实际创建合成原生数据，再升级，旧旁聊 / 历史保留，首次主对话成功。`b01-both-before.txt` 中新账号和旧版升级同一组测试均收到相同拒绝；修后 2/2 成功。`migration-session-errors.test.ts` 覆盖包装后的 404，以及创建前 / 后、发送、单条描述各处；其他 404、5xx 不创建。 |
| B02 安装版文件夹 | `b02-before.txt`：把基线读取模块放入真实 ASAR（应用归档），系统 PowerShell（命令解释器）无法按 `-File` 读取，`PROJECT_FILE_UNAVAILABLE` | `b02-after.txt`：同一真实归档测试通过；原有目录身份、文件版本、链接、ADS（备用数据流）、UTF-8（文本编码）拒绝测试保留。`unpacked/results.json`：真实打包程序中主对话、项目登记、原生读文件 / 两次审批后写文件、实际主对话导出均通过。真实 NSIS（Windows 安装器）最终结果见 `installed/results.json`。 |
| U01 手机输入栏 | `u01-before/phone-geometry.json`：390×844，页面 912，发送按钮底边 891；截图与 QA-6 完全一致 | `u01-after/phone-geometry.json`：390×844 页面 844 / 底边 823；360×780 页面 780 / 底边 759。浅深、有 / 无额外条、键盘缩小、480px 都测。`bundle-geometry.json` 另测生产手机界面包、安全区、底部选项卡与键盘。 |

U01 根因是 UX-6 的 `search.js` 把导航按钮移到旧页面顶栏，加 `display:flex!important`；顶栏 min-height（最小高度）仍为 68px，后面的 `100dvh`（动态视口高度）壳因此变成 912px。AND-1、UX-9、UX-7、M3-1、MOB-P1、TB-4 不是这个 68px 的来源。导航按钮留在原对话顶栏；visualViewport（可视视口）用于跟随键盘，壳按 border-box（包含内边距的尺寸）只消费一次安全区，内容区域可缩小。

B01 在后端的一个 `readSession` 中识别网关保留的 `nativeStatus=404 / nativeCode=session-not-found`。创建时可选读取返回不存在；强制读取统一为 `SESSION_UNAVAILABLE`；真实连接 / 5xx 错误继续不可用。逐一覆盖 `requireSession`、`describeSession`、`describeSessions` 单个、创建后身份检查。此前测试直接抛原生错误码，未经过真实网关包装，因此漏检；新增真实网关测试进入 vendor（固定运行时集成）组。

B02 不新增可替换的落盘可执行脚本，改为从应用归档固定读取内容到内存，经私有标准输入传给固定 PowerShell 启动命令；JSON 请求与可执行内容分开。完整同类路径清单与边界见 [resource-audit.md](resource-audit.md)。

## 小问题

- U02：开关样式与 44×26 尺寸集中在 `controls.css`，助手、备份、开机自启共用；移除重复覆盖与旧开机项宽度覆盖。
- U05：初始读取完成隐藏状态行，仅刚保存时经统一 toast（轻提示）显示“已同步 · 从下一次回复开始生效”。读取 / 保存失败仍有原因与重试。
- U04：主对话成果卡只显示一次状态；原生停止事实、历史停止 / 拒绝前缀不再标成功；内部工具名用共享的人话描述，移除反引号。`side-result-copy.test.ts` 覆盖重复 / 冲突的旧卡和新卡。

## 验证与复跑

```powershell
node .github/scripts/ci-unit-tests.mjs required
node .github/scripts/ci-unit-tests.mjs vendor
node --test tests/personal-cloud-web.test.ts apps/mobile-ui/tests/cloud-login.test.mjs apps/mobile-ui/tests/chat-interactions.test.mjs apps/mobile-ui/tests/visual-interactions.test.mjs apps/mobile-ui/tests/approval-interactions.test.mjs
npm run typecheck
# 归档缺陷前后使用同一测试，只切换待打包的基线源模块。
$env:FX21_BASELINE='1'; node --test tests/packaged-project-reader.test.ts
Remove-Item Env:FX21_BASELINE
node --test tests/packaged-project-reader.test.ts
# 生成手机证据。
$env:FX21_EVIDENCE='tests/evidence/fx-21/u01-after'
node --test apps/mobile-ui/tests/composer-viewport.test.mjs
```

手机交互 109/109，审批专项连续五次各 1/1，vendor 203/203，定向 28/28；类型检查通过。required（必过单测）1,429 项，1,415 通过、0 失败、14 项沿用跳过，995.008 秒，完整计数见 `required-summary.json`。未删除保护点、添加异常清单、放宽断言或增加功能跳过。归档测试沿用 Windows 平台条件，真实主对话与升级测试进入 vendor 完整文件。

新增夜间 `installed-smoke` 从当前代码构建独立身份程序并启动，失败直接使夜间阶段失败。真实安装 / 卸载和复用测试安装器的命令见 [WINDOWS_RELEASE.md](../../../docs/WINDOWS_RELEASE.md)。系统选择 / 保存窗口仅测试返回值；本人试用时确认实际系统对话框交互。

## 第 8 条界面自查

- [x] 1 没有新增浏览器默认控件；输入框无缩放把手，菜单 / 下拉保持统一控件。
- [x] 2 导航、发送、开关和成果卡沿既有按钮四态。
- [x] 3 导航留在已有顶栏，保存提示用轻提示；没有增加常驻新行。
- [x] 4 390、360 与 480px 的发送按钮完整在视口内；无页面纵向溢出，内容区独立滚动。
- [x] 5 使用原加载 / 错误 / 空状态；开关状态与保存结果明确。
- [x] 6 手机网页与手机界面包浅深均拍摄，真实程序浅深 / 480px 验收见 installed 图。
- [x] 7 按 UI_SPEC 与既有组件 / 已存证据核对输入区层级、统一开关和轻提示密度；工作树没有 `ref-products/`，不声称已逐张比对私人参照。
- [x] 8 未新增弹层；文件夹确认卡 / 助手设置有浅深打开状态截图。
- [x] 9 截图中本包输入栏 / 控件缺陷均修复并核对几何。
- [ ] 10 本包手机证据是 Chromium 模拟网页视口和合成安全区，没有系统栏 / 浏览器工具栏整屏，不称为原生系统栏验收。未修改原生壳 / 状态栏能力；实际系统栏沿 AND-1 证据与夜间原生系统栏检查。

Android（安卓）不需要新壳版本，没有新增路由、原生能力或权限；未改安卓版号或界面默认版号。Windows 必须更新程序本体以包含网关与项目读取修复；手机布局资源可随界面包更新。Apple（苹果端）无接口 / 路由接线变化。

## 遗留线索

U03 模型行三个常驻动作仍在模型设置渲染逻辑，未修改。QA-6 的回环代理建议空响应与模型路由被识别成本地单槽相关，仍需直接云路由展示验收；本包合成响应不验证真实建议质量。流式末尾呼吸点的 QA-6 可见帧观察仍是独立问题，本包未修改其动效。没有执行生产迁移、发布、真实模型或长时浸泡。

真实安装最终复验：五项冒烟全部通过，项目旁聊创建回执为 `accepted_by_dsh`，确认卡已消失；真实原生读结果到达合成模型，两个独立审批后落盘，导出来自实际主对话历史。浅深审批打开态、助手设置与 480px 图齐全；安装已卸载，临时签名私钥已删除。安装器 SHA-256（文件哈希）：`aa4575895976d29fb3cb37f4086523b3a2184958f0afab77fafe7e4f7a5dd2ca`。

清理：额外结束两个早期夹具进程，按创建时间、可执行路径、相对命令结合工作目录解析核对，未按父 PID（进程标识）清理。自动审批审查拒绝删除旧本地构建副本，只返回 `blocked by policy`；`installed/release/` 保留本地且由本目录 `.gitignore` 排除，未改用其他工具重试删除。

最终审批截图等待实际按钮出现，并只点击一次“批准”；批准后待办可从默认列表移除，因此运行器以该原审批不再待答及实际磁盘结果核验。源模块最后补验保留 `read.md` / `notes/read` 文件路径原样（8/8）；当前源码已重新构建 NSIS 并安装 / 卸载通过。

合主线复验：`origin/main=086f52d4`，已最新，无冲突；相关 139/139、类型检查通过，日志见 `post-main-tests.txt` / `post-main-typecheck.txt`。vendor CI（持续集成）的默认浅克隆不含旧版本代码，已增加只获取固定 `f787c3c1b1215b969a4db8e143b18da0b2421d5a` 的步骤；独立空 Git 仓库实际获取并读取旧主程序成功（`ci-legacy-fixture.json`），不把测试依赖留给 CI 失败后处理。
