# CI（持续集成）单测

`node .github/scripts/ci-unit-tests.mjs required` 是本机完整必过组，Windows 保留两文件并发，不重跑。`vendor` 是另一个阻断组，要求先 `npm run vendor:dsh`；继续使用 `.github/vendor-test-suite.json` 与 `.github/ci-test-exceptions.json` 原有划分。

云端 `ci.yml` 的 Windows / Linux 按文件名 SHA-256（安全哈希算法）固定种子 `required-v5190` 分成三片，每片 `--test-concurrency=1`。新增文件不会移动已有文件。macOS 保留一片。两项较重的 BL-29 计时用例原样移入独立文件，避免一次重跑连带重复混合文件的其余用例；清单的 `evidenceFile` 保留历史位置用于核对取证。`--shard 1/3` 选择第一片；`--report <文件>` 输出结果与每次尝试。各片上传报告后，`Required unit tests (summary)` 汇总通过、失败、跳过与重跑恢复记录；报告缺失、重复或任何分片失败都会阻断。

`.github/timing-sensitive-tests.json` 只登记 [CI-1 失败表](../tests/evidence/ci-1/flaky-table.md) 中实际失败过的墙上时钟或真实 Electron（桌面程序框架）预算用例。预算与断言不变，不删除或跳过用例。`CI === 'true'` 的 required 文件首次失败，且所有失败叶用例都在清单里时，整个文件只再跑一次。清单外失败、同文件混合功能失败、进程崩溃、文件期限或无法识别的失败都直接阻断。第二次失败仍红；通过则在步骤摘要的「本次重跑才通过的用例」列出全名与文件。计数采用文件最终尝试，保留两次尝试供取证，不重复计入通过数。

本机、vendor、`schedule` 触发及 `CI_TEST_STRICT=true` 的运行保持单次严格执行。清单名称用 TypeScript（类型化 JavaScript）语法树与当前测试声明核对，写错或过期的名称会报错。

云端 required 单文件期限为 10 分钟，依据既有最长文件约 8 分 12 秒的取证确定。超期结束本文件拥有的进程树，打印阶段、输出尾段、提交内存与退出码，判失败后继续下一文件。Windows 回收仍同时核对创建时间、可执行文件和隔离目录；每次尝试都有独立临时目录。矩阵 job（作业）期限为 25 分钟；完整报告在各分片步骤摘要与汇总步骤都可见。Chromium（浏览器引擎）和 Electron 二进制缓存按系统、架构及 `package-lock.json` 隔离；Windows 的 Media Foundation（媒体基础组件）安装与 Node 准备并行，实际界面测试前仍等待成功结果。DSH（宿主运行时）缓存与版本不变。

只读取 GitHub 的取证命令：`node .github/scripts/ci-failure-survey.mjs` 获取最近 80 次主流程；`survey({workflow:'windows-package.yml', ...})` 另取打包流程。原日志留在 `.local/ci-1/`，公开表格和诊断摘要在 `tests/evidence/ci-1/`。`node .github/scripts/ci-run-evidence.mjs <运行ID> <标签>` 下载各片报告、记录用时与重跑恢复；`round-1` 至 `round-6` 自动生成完整结果表。

旧检查名 `test (windows-latest)` / `test (ubuntu-latest)` 分别替换为 `test (windows-latest, shard 1/3)` 至 `3/3`、`test (ubuntu-latest, shard 1/3)` 至 `3/3`，新增阻断汇总 `Required unit tests (summary)`。原 `test (macos-latest)` 按原触发条件显示为 `test (macos-latest, shard 1/1)`。其他产品平台、云端服务与手机系统栏取证流程保留。
