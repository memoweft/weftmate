可以迁移本人日用程序到安装版：否。两个旧产品阻断已经解除，但固定基线 Windows 检查仍失败，安卓真实登录后与底部系统栏证据未闭环，当前不满足本轮放行条件。

# QA-7 · 迁移放行第三次验收

固定基线 `2a075c13c9f9a428c149d5831432a469e2d97b4f`；Core（记忆核心）`233cc2f0b27a921a699a9c4c43b1a612375970f8`。先执行 `npm ci`。没有修改产品代码，没有运行本人程序、触碰日用数据、访问 18186 / 8081 或控制两个日用计划任务；没有使用电脑操作工具、WSL（Windows 的 Linux 子系统）或 HAProxy（反向代理）。系统文件夹选择只替换返回值；真实拖放使用实际合成目录。

## 判定与分级

**QA7-G01 · 阻断迁移：规定的固定基线检查不是全绿。** GitHub（代码托管平台）最终为9项成功、1项失败；Windows 的 `node --test tests/nightly-regression.test.mjs` 为10通过、2失败，尚未进入后面的完整必过测试。复现是查看固定提交对应任务，而不是拿本包后来提交的绿色检查替代。

- `synthetic artifact write is observed before exposing its task approval`：`PRIVATE_STORAGE_UNAVAILABLE`，合成宿主初始化的目录权限检查失败。
- `temp pruning removes only stale unused weftmate-* directories and never follows a junction`：实际 `[false,3,2,0,1,0]`，预期 `[false,3,1,0,1,1]`。
- 这是发布验收门失败，未把它伪称为本人对话丢失或实际安装版主对话失败。上次 Apple（苹果端）回调换行审查已经通过。
- [固定提交检查](baseline-checks-summary.json)、[失败摘要](baseline-failure-summary.json)、[Windows 原始日志](baseline-windows-full.log)。各任务的实际 GitHub 链接见下方。

**QA7-G02 · 必需验收证据缺口，不能按通过交付。** 安卓直连合成本地认证返回成功，原生 `auth.me` 显示已登录，`host.status` 授权有效，主对话业务接口也成功；但测试页面状态被清空，出现“登录已失效”且输入禁用。经过有限的本地登录夹具初始化补测，仍未取得真实业务连接的完整14场景证据。没有重建云环境或用本人账号替代。此结果不能直接定性为正常生产云登录故障。[匿名合成诊断](android/auth-diagnostic.json)、[原始图与回执](android/measurements.json)。

另有 MuMu `qemu.hw.mainkeys=1`，系统导航栏高度0。真实原生壳的 AND-1 页面夹具补图已覆盖14个浅深场景，但不能代替真实业务连接或“底部系统栏已验收”。两项缺口均显式保留。

**QA7-U01 · 迁移后尽快修：灰字补全未获得正向证据。** 新合成账号直接配置 `https://api.xiaomimimo.com/v1`、`mimo-v2.6-flash`，完成自然问答并看到建议胶囊后，在输入框键入“请把刚才的整理建议”。请求为 `POST /sessions/:id/suggestions`，`{kind:"completion",draft:"请把刚才的整理建议",requestId:…}`；200响应为 `{suggestions:[],completion:""}`，18秒内没有灰字，因此无法验收 Tab 接受。该次建议账本耗时4993毫秒、用量未知，与接口5000毫秒超时路径吻合；这是推断，不声称已收到云端完整补全文本。[请求响应](live/results.json)、[MiMo 响应元数据](live/direct-usage.json)、[截图](live/gray-completion-failed.png)。

**QA7-U02 · 迁移后尽快修：界面正文一次性出现，末尾呼吸点未出现。** 使用自然的家庭资料整理问题，不要求精确字数。8,004帧中呼吸点0帧、正文流式类0帧；助手消息数1→2，末条正文长度只有12→1508两个取值，没有中间增字；该回合公开事件只有1条 `assistant.message`，最终正常完成且无残留点。可定位为客户端没有形成“正文进行中”的展示阶段；尚不能进一步区分云端、网关或事件投影在哪一级缓冲。不能写成“持续增字时单独漏画了圆点”，也不能宣称动效验收通过。[帧摘要](motion-summary.json)、[全部帧](live/results.json)、[事件](live/events-7.json)、[完成图](live/motion-final.png)。

**QA7-U03 · 小毛病：短暂提示覆盖顶栏。** 浅色数据与存储页的系统通知说明提示、360×480模拟键盘场景的连接恢复提示横跨标题区域；没有遮挡发送或审批。打开数据页／恢复连接即可见。[数据页](android-gallery/data-storage-light.png)、[恢复连接](phone/360-keyboard-viewport-simulation-dark.png)。不作为迁移否决理由。

## 两个旧阻断：均已解除

| 场景 | 本轮结果与证据 |
|---|---|
| 全新合成账号，安装版默认主对话第一句普通聊天 | MiMo真实回复，主会话正常创建；[逐回合结果](live/results.json)、[首回合事件](live/events-0.json) |
| 随后主对话连续5轮，第4轮纠正偏好 | 从柠檬改成苹果，5/5完成；第1和第4轮等待真实Core形成完毕 |
| 新开旁聊验证纠正 | 回答“加一片苹果（不加柠檬）”，界面显示用到1条记忆；[截图](live/side-recall.png) |
| 最后记忆健康 | ready，待提交、待形成、失败、失败纠正均0，worldRevision=2；[结果](live/results.json) |
| 旧日用 f787c3c 创建3个合成会话，由安装版打开 | 3/3成为旁聊，事件保留，全文搜索各命中1次；安装版主对话首句成功；[升级结果](upgrade/results.json)、[截图](upgrade/new-version.png) |
| 空旁聊选择合成文件夹 | 原生选择器返回值替身 → 可读写 → “在这个文件夹里工作”，成功登记 |
| 项目里MiMo读文件、写文件、审批 | 原生审批后生成 approved.txt，内容逐字为 QA7_SYNTHETIC_PROJECT_SOURCE，读回一致，成果库有记录；[审批橙点](live/project-pending-0.png)、[成果](live/project-complete.png)、[API结果](live/results.json) |
| 折叠项目等待批准 | 橙点正确显示，截图与原始项目行HTML均保存 |
| 真实目录拖放 | 补测收到真实目录的 drop 事件，directory=true，确认卡显示并成功登记；[事件与结果](ui-recheck/results.json)、[确认卡](ui-recheck/drag-before-confirm.png) |

首轮拖放发生在刚切换新旁聊后，未收到有效确认；等待页面稳定的独立补测通过，没有改产品或伪造目录路径成功回执。

## 私人备份副本迁移

只读复制最新授权 `pre-upgrade-20261009b` 内的数据目录，66,050文件。私人内容不进入截图、事件证据或云请求；原账号仅在副本临时改为合成登录别名／密码，账号身份未替换。模型网络边界限定本机，显式拒绝18186和8081。

- Prepare（准备）演练通过；脚本演练模式拒绝真实 Apply（应用）／Rollback（回退）任务控制。
- 源码启动 → 安装版启动 → Verify（验证） → 原主账号主对话发合成文字 → 得到合成回复 → 源码回退，全部成功。
- 四个账号会话数全程3／0／0／0。原主账号原有3会话全部保留，发送后数量仍3。
- 原主账号记忆健康正常，待提交、待形成、失败均0；该授权备份正式记忆为空，不声称验证了非空正式记忆迁移。其他账号的既有模型不可用状态保留在匿名报告。
- “整理过去的对话”只预览，没有确认。云模型请求0。本机合成端点计数3次；旧字段名 `localStubRejectedRequests` 在此运行器实为全部POST计数，不表示拒绝，说明见 interpretation.json。
- 恢复副本后逐文件新增／删除／变化均0；原备份前后也均0。运行期间文件有正常变化，零差异只指恢复后。
- 副本和副本生成的备份目录已删除。

[匿名迁移报告](installed/migration-report.json)、[统计字段说明](installed/interpretation.json)。首次把备份容器目录当作数据目录，运行器在启动前报缺少 settings.json；失败副本已删除，随后改用正确数据子目录重新完整演练。原件保留，未将运行器错误定为产品故障。

## 建议、手机与安卓

真实MiMo下一步建议已经出现3条，点击后填入输入框，命令数不增加，没有自动发送。[建议截图](live/next-suggestions.png)、[点击断言与请求响应](live/results.json)。账户模型直接配置云端地址，没有QA-6的外加回环转发代理；用量来自宿主记录的MiMo响应及原始usage字段。

手机网页24个场景均在视口内：390×844主对话发送底边823，旁聊／文件夹／建议／离线783；360×780对应759／719。模拟键盘缩小至544／480高时，发送底边483／419。页面总高始终等于视口，无纵向溢出。建议条是明确标注的布局夹具；键盘缩小是模拟，不能代替原生IME。[逐项几何](phone/geometry.json)、[逐图审查](mobile-review.md)。补图复用同一安装包构建的 win-unpacked 真实程序，源文件512/512与基线相符；没有将源码宿主称作安装版。

安卓原生业务直连缺口见G02。额外真实壳的合成投影夹具14张浅深整屏图覆盖主对话、抽屉及状态点、全屏搜索、顶栏菜单、数据与存储、键盘、连接失败提示。每张已标系统／页面主题、Android 15、导航区域、色差和IME尺寸。状态栏高31px，色差最大1.724（门限18），图标主题一致；搜索框顶边51.39px，未被状态栏遮挡；IME高324px，输入区底边957px，键盘顶边956px，约1px接缝。测试键盘固定浅色；暗色页面的键盘主题不代表正式输入法主题。底部导航栏隐藏，仍不合第8条第10项完整要求。所谓offline图实际是合成连接失败后的“正在连接·草稿会保留”状态，未进行长时离线等待。[逐图表](mobile-review.md)、[原生夹具原始数值](android-gallery/measurements.json)。

## 安装、基线与测试

独立身份 `qa7`，版本 `0.1.1-preview.7`。NSIS安装包 SHA-256（文件哈希）：`bef226273008493998644469e5f9acbbc18e260f9d47bc9a7b3ef993ab322b62`。临时签名私钥构建后立即删除；实际安装、卸载均为隔离目录。主要MiMo安装轮耗时120.358秒。

包内512个src文件与固定基线、旧版354个src文件与f787c3c核对：忽略Git换行后零不匹配。[来源证明](source-proof.json)。Windows构建曾将生成的release-notes.js改成LF（换行），导致与手机CRLF（回车换行）副本的一致性比较失败；恢复原工作树文件后完整安卓构建通过。这是构建副作用，非安卓产品内容差异；初始失败和完整重建日志均保留，最终没有跳过检查。

| 验证 | 结果 |
|---|---|
| node .github/scripts/ci-unit-tests.mjs required | 1429项，1415通过，0失败，14既有跳过；982.905秒 |
| node .github/scripts/ci-unit-tests.mjs vendor | 203/203，0失败、0跳过；132.457秒 |
| node scripts/nightly/installed-smoke.mjs --executable <本包真实安装exe> | 五项全部通过；没有重新构建包；[结果](installed-smoke/results.json) |
| Android基线完整构建 | BUILD SUCCESSFUL；[日志](android-build-restored.log) |
| 固定基线GitHub | 9成功、Windows 1失败；[快照](baseline-checks-summary.json) |


固定基线的线上任务：

- [test (windows-latest)](https://github.com/memoweft/weftmate/actions/runs/38065588864/job/114252442163)：failure。
- [test (ubuntu-latest)](https://github.com/memoweft/weftmate/actions/runs/38065588864/job/114252442126)：success。
- [Observed bridge (real MemoWeft Core)](https://github.com/memoweft/weftmate/actions/runs/38065588864/job/114252441951)：success。
- [Pinned DSH vendor unit tests](https://github.com/memoweft/weftmate/actions/runs/38065588702/job/114252441561)：success。
- [Web cloud login interactions](https://github.com/memoweft/weftmate/actions/runs/38065588684/job/114252441495)：success。
- [Relay phone first input and file task](https://github.com/memoweft/weftmate/actions/runs/38065588660/job/114252441346)：success。
- [Android debug and JVM tests](https://github.com/memoweft/weftmate/actions/runs/38065588684/job/114252441300)：success。
- [Host certificates (Pebble DNS-01)](https://github.com/memoweft/weftmate/actions/runs/38065588680/job/114252441268)：success。
- [Relay full chain (443)](https://github.com/memoweft/weftmate/actions/runs/38065588660/job/114252441171)：success。
- [Synthetic multi-device review gallery](https://github.com/memoweft/weftmate/actions/runs/38065588601/job/114252441081)：success。

两组完整单测各跑一次且与真实交互测量串行。没有删除测试、放宽断言、改异常清单或修改产品。[本地测试汇总](tests-summary.json)。官方冒烟的合成模型结果不冒充MiMo验证。

## 运行器限制与原件

首次MiMo运行器在首个窗口前提前退出；同一安装随后官方冒烟和旧版升级都成功。采用QA-6原有本机占位记忆配置重新启动，新账号MiMo全部主对话场景完成。第一次退出没有取得完整启动日志，不武断给出产品根因。[初次结果](live-initial/results.json)。修正仅在运行器，没有修产品。

手机初轮用旧登录helper重载后未建立完整页面状态、按钮可访问名称又受窄屏影响；最终使用真实本地认证回执调用现有会话初始化，并使用稳定控件标识，24项通过。安卓的类似补测仍未闭环，保留全部阶段，不以合成投影替换失败。运行器的PASS表示其局部断言成立，例如natural-stream的PASS仅说明回复完成；最终需求结论以本README和逐项证据为准。

## 用量、清理与下一步

MiMo记账31次，其中28次有响应计量，3次建议取消／超时用量未知。已知输入108,029词元（其中缓存76,864），输出3,100；按程序内单价估算¥0.03890228，不是含未知请求的最终账单。[逐请求账本](live/usage-ledger.json)、[直接云响应](live/direct-usage.json)。其他迁移／升级／官方冒烟／原生布局夹具均使用本机合成模型或合成投影，未用8081或LAN（局域网）模型。

已清理进程：1（首次失败运行器留下的合成HTTP监听；正常退出的子进程不重复计数）。本包运行残留0、私人副本0、私钥0，全部测试安装已卸载，独立安卓包及测试包已卸载。MuMu在开工前已存在，本包未启动模拟器，按只清理本包进程的规则保留它，不动后台服务。构建产物留在被忽略的.local/qa-7供复现，不进入公开提交。[清理证明](cleanup.json)。

Claude下一步只需闭环固定基线Windows门，以及实际已登录安卓与可见系统导航栏的证据；本轮主对话、项目文件夹、旧版升级和私人副本迁移不需因本报告而全部重跑。当前结论为否，因此不提供可直接执行正式迁移的放行清单，也没有执行任何生产迁移步骤。
