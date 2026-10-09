# IA-3 · Windows 程序与网页主对话

已实现固定 WeftMate 主对话、旁聊 / 项目导航、按天折叠、日期跳转、搜索与结果摘要高亮、来源开旁聊及结果返回、逻辑发送与附件暂存。D42-A 的全部原始历史保留；客户端只保留最多 1,000 个事件模型，真实视口附近挂载行有界。

主界面为生产 `createPersonalDesktop` 创建的真实 Electron（桌面程序框架）窗口，使用 Playwright（自动化框架）驱动。合成账号、系统临时目录和随机端口；万条夹具经过实际个人宿主 API（应用接口）与原生历史投影，跨三个执行段、十天，混合长代码、图片、工具步骤与流式更新。该夹具的执行后端是合成的，不把它称作万条真实 DSH（助手运行时）磁盘日志。

## 交互证据

- `desktop-light-recent.png` / `desktop-dark-recent.png`：固定顶部主对话，旁聊 / 项目与成功、失败、停止结果引用。
- `desktop-light-folded.png` / `desktop-light-date.png`：旧日折叠、真实日期定位。`desktop-light-search.png` / `desktop-light-result-search.png`：中文搜索、前后命中与结果摘要高亮，目标矩形在可见滚动区域内。
- `desktop-light-side-origin.png`：来源引用可返回主对话原消息，明确“相关上下文尚未带入”，草稿转入旁聊。仅引用不是完整上下文转移。
- `desktop-dark-narrow.png`：720×600 窄窗；`mobile-web-390x844.png`：390×844 手机远程网页不溢出且完整显示 WeftMate 标题。
- `desktop-main-approval.png` / `desktop-main-question.png` 与 `controls.json`：主对话键盘搜索、焦点返回、批准、回答与发送 / 停止同按钮。`accessibility-tree.txt` 是实际可访问树快照；未声称操作了实体读屏软件。
- `real-mimo-main-attachment.png` / `real-send.json`：生产宿主、固定 DSH 和真实 MiMo，从桌面输入区首发；逻辑暂存原件与模型可读附件，模型正确读出 PAPER-42，受理后清理附件草稿并保留同一命令 / 请求 / 回执身份。

## 性能实测

设备：AMD Ryzen 7 9700X 8-Core Processor；Windows，约 47.1 GiB（吉二进制字节）内存；1200×800，循环回送网络，无注入时延，客户端页上限 200。首屏不等待完整索引和旁聊列表。

| 指标 | 实测 | 设计预算 |
|---|---:|---:|
| 已启动窗口切入主对话，30 次 p95（第 95 百分位） | 118.59 ms | ≤1,000 ms |
| 登录及渲染器重新装载后的首次可读 / 可输入 | 917.26 ms，单次 | 单独记录，不当作 30 次分位数 |
| 已建索引文字搜索，30 次宿主 HTTP（网络请求）p95 | 9.79 ms | ≤500 ms |
| 日期定位，30 次宿主 HTTP p95 | 10.02 ms | ≤300 ms |
| 连续滚动 60.00 秒，10343 个绘制帧的 p95 | 10.00 ms | ≤20 ms |
| 最长帧间隔 / >20 ms 帧数 | 65.10 ms / 178 | 不持续阻塞 >100 ms |
| 主线程长任务 | 0 | 不持续阻塞 >100 ms |
| 最大挂载行 / 滚动期间新增流式消息 | 27 / 74 | 挂载有界 |
| 1,000 → 10,000 条渲染器私有内存增量 | 22.64 MiB（兆二进制字节） | ≤50 MiB |
| 同档 JS（客户端脚本）堆增量 | -0.10 MiB | 辅助指标 |

帧回调实际频率约 172.4 Hz（每秒次数），未人为降到 60 Hz。内存是两个独立渲染器进程的对照：同一程序、同一 1×1 图片资源、各 30 次切入、各同长滚动与流式更新，采样前强制 JS 垃圾回收；不是整个宿主或整台电脑内存。图片解码缓存无法从 Electron 私有内存数字单独拆出，限制明示。完整样本见 `verification.json`。

固定 DSH 首次未命中的物理日志读取限制仍按 CLIENT_API 9.7 / IA-2b：十万条首次建缓存约 1,539 ms，不能把本包合成宿主测量冒充原生冷磁盘成绩。服务端缓存命中、万条 / 十万条冷读的原始证据继续在 `../ia-2b/`。

## 回归与审稿

相关测试按文件执行；末批 132 项通过，新增源身份及满窗口锚点回归后 8 项专门用例通过，`npm run typecheck` 通过；已有桌面 UI-1（三端对话界面第一阶段）交互 3 项通过。合入最新 UX-3（输入区）后 72 项相关回归通过，UX-3 六组界面交互和主对话键盘 / 审批 / 提问 / 停止复验通过，真实 MiMo 附件再次通过。完整单测交 [PR（拉取请求）#154](https://github.com/memoweft/weftmate/pull/154) 的 CI（持续集成），不在本地重复跑全量。

审稿页新增 `main-chat`，桌面与手机网页浅深色 4 张均为独立合成宿主；本地桌面 / 手机 52 个场景均已捕获，包括原提问条。机械设计检查返回空问题列表。独立静态审查指出的窄屏标题、日期覆盖、结果高亮与打开提示四项均判定已解决；该判定只覆盖这四项，未冒充整页的运行验收。

## 契约、边界与交接

能力版本精确匹配 1；未派发 `chat.message` 可以没有 `sessionId`，只查询原 `requestId`，不生成新请求重复执行。历史和 `syncCursor` 独立，按 `eventId` 去重。409 `CURSOR_RESET_REQUIRED` 先清正文、搜索、资源及审批 / 问题 / 任务缓存再读新尾页；旧异步结果按代次丢弃，`building` / `failed` 都不能解释为没有记录。

`ui-core/chat-window.js` 提供无界面依赖的窗口 / 日期模型，`ui-core/main-chat.js` 提供逻辑动作；手机原生壳默认保留已有适配器，IA-4 在提供逻辑界面 effects（展示回调）后设置 `logicalChats:true` 接入。段不成为侧栏新对话，原任务和附件仍用真实来源身份。主对话已存在后沿宿主当前模型；当前契约没有独立换模型路由，界面不伪造切换。动态 / 目标 / 成果库页面留 TB 包；Apple（苹果端）原生界面留 IA-5。

MiMo 三次成功真实推理：输入 6,847 token（令牌），缓存 1,536，输出 95，共 6,942；详见 `usage.json`。早期定位器故障没有触发推理。未请求 8081 或局域网模型，未使用本人日用数据，参照图片未复制到仓库。

## 清理记录

测试运行器在收尾关闭宿主 / Electron / Chromium（浏览器引擎）并删除自己的隔离目录。曾强制终止卡住的审稿进程树 8 个，其中 6 个 node / cmd / Electron 明确属于测试链，1 个 crashpad（崩溃收集进程）未保留完整归属记录；另 1 个 MuMuNxService 因父进程编号复用被误筛，已于本次收尾恢复并确认存活，原有主界面 / 远程服务继续运行，未启动模拟器设备。该错误如实保留，最终清理改为同时检查创建时间、可执行路径与本包参数；不再仅按父进程编号处理。

早期 `failure*` / `controls-failure*` / `real-send-failure.json` 为修复前的夹具或定位故障记录，最终通过依据为 `verification.json`、`controls.json` 和 `real-send.json`。复现：`node tests/integration/ia-3-main-chat.mjs`、`node tests/integration/ia-3-controls.mjs`；真实模型复现用 `node tests/integration/ia-3-real-send.mjs`，会使用已批准的系统 MiMo 配置。
