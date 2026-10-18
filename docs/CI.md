# CI（持续集成）单测

`node .github/scripts/ci-unit-tests.mjs required` 是本机完整必过组，Windows 保留两文件并发，不重跑。`vendor` 是另一个阻断组，要求先 `npm run vendor:dsh`；继续使用 `.github/vendor-test-suite.json` 与 `.github/ci-test-exceptions.json` 原有划分。

云端 `ci.yml` 按文件名 SHA-256（安全哈希算法）分片：Windows 五片使用固定种子 `required-windows-v10760`，Linux 三片与 macOS 一片保留 `required-v5190`，每片 `--test-concurrency=1`。Windows 种子按已记录主线首轮的较慢逐文件耗时平衡，新增文件不会移动已有文件。两项较重的 BL-29 计时用例原样移入独立文件，避免一次重跑连带重复混合文件的其余用例；清单的 `evidenceFile` 保留历史位置用于核对取证。Windows 的 `--shard 1/5`、Linux 的 `--shard 1/3` 分别选择第一片；`--report <文件>` 输出结果与每次尝试。各片上传报告后，`Required unit tests (summary)` 汇总通过、失败、跳过与重跑恢复记录；报告缺失、重复或任何分片失败都会阻断。

`.github/timing-sensitive-tests.json` 只登记 [CI-1 失败表](https://github.com/memoweft/weftmate/blob/85321e89888552fb25abe95b0fc8d61f62f2ef5f/tests/evidence/ci-1/flaky-table.md) 中实际失败过的墙上时钟或真实 Electron（桌面程序框架）预算用例。预算与断言不变，不删除或跳过用例。`CI === 'true'` 的 required 文件首次失败，且所有失败叶用例都在清单里时，整个文件只再跑一次。清单外失败、同文件混合功能失败、进程崩溃、文件期限或无法识别的失败都直接阻断。第二次失败仍红；通过则在步骤摘要的「本次重跑才通过的用例」列出全名与文件。计数采用文件最终尝试，保留两次尝试供取证，不重复计入通过数。

本机、vendor、`schedule` 触发及 `CI_TEST_STRICT=true` 的运行保持单次严格执行。清单名称用 TypeScript（类型化 JavaScript）语法树与当前测试声明核对，写错或过期的名称会报错。

云端 required 单文件期限为 10 分钟，依据既有最长文件约 8 分 12 秒的取证确定。超期结束本文件拥有的进程树，打印阶段、输出尾段、提交内存与退出码，判失败后继续下一文件。Windows 回收仍同时核对创建时间、可执行文件和隔离目录；每次尝试都有独立临时目录。矩阵 job（作业）期限为 25 分钟；完整报告在各分片步骤摘要与汇总步骤都可见。Chromium（浏览器引擎）和 Electron 二进制缓存按系统、架构及 `package-lock.json` 隔离；Windows 的 Media Foundation（媒体基础组件）仍用 Playwright 顺序安装。DSH（宿主运行时）缓存与版本不变。

只读取 GitHub 的取证命令：`node .github/scripts/ci-failure-survey.mjs` 获取最近 80 次主流程；`survey({workflow:'windows-package.yml', ...})` 另取打包流程。原日志留在 `.local/ci-1/`，诊断摘要写到 `WEFTMATE_EVIDENCE_DIR` 下的 `ci-1/`，未设置时使用被忽略的 `.local/evidence/ci-1/`。`node .github/scripts/ci-run-evidence.mjs <运行ID> <标签>` 下载各片报告、记录用时与重跑恢复；`round-1` 至 `round-6` 自动生成完整结果表。

检查名为 `test (windows-latest, shard 1/5)` 至 `5/5`、`test (ubuntu-latest, shard 1/3)` 至 `3/3`，阻断汇总为 `Required unit tests (summary)`。macOS 按原触发条件显示为 `test (macos-latest, shard 1/1)`。其他产品平台、云端服务与手机系统栏取证流程保留。

## 合并与红灯处理

合并前，必须把最新 main 合入工作分支，等待该合并结果的全部云端检查通过；单个工作包此前通过不能替代合并结果通过。合主线后的检查也全部核对，由编排者收取结果。计时清单内一次恢复仍须在结果中明示，不能称为首次全绿。

遇到红灯，先保存运行 ID（标识）、提交、平台、文件、用例、历史尝试与失败日志；重跑成功不删除原失败。`node .github/scripts/ci-post-merge-survey.mjs <起点 UTC（协调世界时）>` 按固定起点采集 CI、Review gallery（审稿画廊）、Windows packaged application（打包程序）、S1c、S2、S2b 与 Pinned DSH vendor tests（固定运行时测试）。公开证据清理机器身份；原始日志留本包 `.local`。

按证据区分夹具竞态、测试写法不确定、产品问题与纯墙上时钟预算。等待必须依据命令终态、真实长轮询注册或观察者关闭；不靠固定 sleep（休眠）猜测就绪。密文篡改解码后翻转字节。精确读计数和完整存储快照测试先关闭独立后台观察者。继承临时目录的子进程不更新创建者租约。

预算不包含与被测行为无关的合成身份准备或清理。BL-29 审批探针由 hooks（测试钩子）等待准备与退出；原 25 秒测量期限、30 秒测试期限及四项 2 秒断言保留。手机界面发布的准备也移入钩子，20 秒测量期限不变，SSE（服务器发送事件）读取期限的定时器在读完后释放。非零文件退出一律记录十进制／十六进制退出码、信号、阶段、输出尾段与提交内存概况，报告和失败日志都保留。

`Required unit tests (summary)` 仍须等全部分片报告，缺失、重复或失败继续阻断；它不需要安装依赖。无法在其它分片未结束时宣布整体通过。Observed bridge（记忆观察桥）、vendor／打包／画廊保持独立，继续拆这些任务不能缩短 `gh run rerun --failed` 对同一次运行结束的等待。保持全部检查标准；需要定位时查看已完成的失败 job（任务）日志，完整失败重跑等运行结束后执行。

空账户关闭的500ms检查不在自动重试清单；它的首次失败直接阻断，测试与计时要求保留。不为功能失败登记计时例外；再次失败应继续查阶段耗时和真实条件，不能增加第二次自动重跑。固定复现、逐项定性和连续六轮同代码证据见 [CI-3](https://github.com/memoweft/weftmate/blob/85321e89888552fb25abe95b0fc8d61f62f2ef5f/tests/evidence/ci-3/README.md)。

两条宿主关闭用例都会输出 `host-close-phases`：撤销等待、各组件清理、审批落盘、空闲连接清扫、HTTP 关闭、服务端响应结束和客户端读完响应的相对毫秒数。观测只注入测试夹具，失败时同样保留；观测回调出错被内部吞掉，原关闭调用、异常、完整响应及500ms要求不变。

同步探针后续采用相同 hooks（测试钩子）边界：合成身份、桌面／手机准备与退出在测量之外，原55秒／60秒及6秒／1秒／7秒断言不变。硬期限收集控制器时使用SIGKILL（强制终止信号），避免SIGTERM（终止信号）处理器让同步控制器一直不返回；失败保留每一步耗时，合成桌面验证正常退出0。该修复只在共享测试夹具，Apple（苹果端）工作流与原生检查不变。首次验收在macOS Node组600秒到期的失败与下一额外观察轮macOS组通过都保留在 before-sync-fix-cloud（同步修复前证据），不计入最终冻结代码六轮。
