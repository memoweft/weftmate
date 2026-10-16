# 记忆主路 · 现状与规则

这一页给负责「记住我的事」的单独会话（D105）。开工前先读 [PROJECT-MAP.md](../PROJECT-MAP.md) 和 [AGENTS.md](../AGENTS.md)，再读这一页。这一页和 [DECISIONS.md](DECISIONS.md) 冲突时，以 DECISIONS 为准。

## 1. 现在是什么样（2026-10-15 读代码核实）

| 事实 | 出处 |
|---|---|
| 链路：每轮结束，记忆插件把真人原话交给摄取，再交给按账户管理的 MemoWeft 进程（Python，独立仓库 `memoweft/memoweft`）。召回、纠正、遗忘走同一条链 | `src/plugins/weftmate-personal-memory.mjs` → `src/personal-access/memory-ingestion.mjs` → `src/personal-memory/`：`index.mjs` 管理器（每个账户一个进程，同时最多 4 个）、`rpc.mjs` 通信、`journal.mjs` 命令日志、`actions.mjs` 纠正与遗忘、`http.mjs` 接口 |
| 只有启动时带 `--personal-memory-config=<文件>` 才启用 | `src/main.mjs`（解析参数约第 209 行，创建管理器约第 3150 行） |
| 这个文件必须指向本机已有的 Python 解释器和 MemoWeft 源码目录（目录里要有 `memoweft/integrations/dsh_bridge/__main__.py`）；记忆处理用的模型入口只能是本机 `http://127.0.0.1:<端口>/v1` | `src/personal-memory/config.mjs` |
| 安装版把安装配置 `desktop-config.json` 里的 `personalMemoryConfig` 转成上面的参数。全新安装时，Windows 默认配置没有这一项；macOS 只在配置旁边已有 `memory-config.json` 时才加 | `src/desktop-config.mjs` |
| 本人从源码版迁移来的安装版，迁移脚本写入了这一项，所以它依赖本机现成的 Python 和 MemoWeft 源码 | `scripts/migrate-desktop-config.mjs` |
| 安装包不带 Python 和 MemoWeft，**全新安装默认没有记忆** | `package.json` 的打包配置 |
| 手机单独聊天只有轻量记忆，不合并成第二套正式记忆；电脑接手后，原对话交给电脑摄取（D63） | [PHONE_MEMORY.md](PHONE_MEMORY.md)、`src/ui-core/phone-memory.js`、`apps/apple/Packages/WeftMateCore/Sources/WeftMateCore/PhoneMemory.swift` |
| 记忆页：桌面 `src/personal-access-ui/components/memory.js`，共用逻辑 `src/ui-core/memory.js`，手机网页 `apps/mobile-ui/www/components/memory.js` | — |
| CI 里接真实 MemoWeft 的作业固定在一个候选提交上（注释写着待替换），测试文件名单写死在作业里 | `.github/workflows/ci.yml` 的 `observed-core` |
| 旧插件 `src/plugins/weftmate-memory.mjs`（约 1240 行）仍写在 DSH 配置模板 R7–R10 里。按文件头注释，它只在 `WEFTMATE_MEMOWEFT_ENABLED=1` 时工作；个人宿主模式下设这个变量，程序会拒绝启动。默认路径写死了一个本机目录 | `src/dsh-web-runtime.ts`、`src/main.mjs` 约第 172 行 |
| WeftMate 这一侧的记忆代码约 5400 行，含命令日志、待发队列和恢复补做。2026-10-14、15 两天连着修了遗忘循环（FIX-45）、纠正与遗忘的中断恢复（FIX-47），遗忘由宿主执行（FIX-50）还在做 | 上面这些文件；GitHub 上对应的 PR |

## 2. 规则

1. **先验收，再动手。** 开工第一件事是按 PLAN 的记忆场景（M1–M5）跑一遍，结果记进地图第 4 节。两种环境都要跑：全新安装的 Windows 安装包（合成账号），以及开发模式下带记忆配置的宿主（合成数据）。本人自己的安装版只在本人在场时只读核对，不改它的数据。
2. **不碰本人的日用数据。** 测试用独立的数据目录和合成账号。本人安装版用到的那份 MemoWeft 源码目录（位置见本机 `MACHINE.md`）不切分支、不改文件；改内核用单独的工作目录。
3. **记忆内容不外露。** 日志、PR、截图和问题单里不出现真实的记忆内容，只写条数、状态和合成例子。
4. **打包方式由本人定。** 先写一页方案比较交给本人，未定之前不改打包。可以比较的方向（不限于这些）：安装包里带 Python 和 MemoWeft；把 MemoWeft 打成单独的可执行程序随安装包发；把内核移植到 Node、和宿主在同一个进程；做成首次用到时才下载的可选组件。每个方案写清体积、怎么更新、失败时用户看到什么、工作量。
5. **可靠性放进内核，不在 WeftMate 这一侧再叠层。** 不再新增队列、日志、恢复补做这类层。遇到失败，先复现、先写一条会失败的测试，再判断原因在哪一层：内核缺原子性或幂等，就改 MemoWeft（在它自己的仓库，走它自己的 PR），WeftMate 这侧只做同步调用。确实要在 WeftMate 这侧加，在 PR 里写清复现步骤和为什么不能放进内核。
6. **删除语义照 D16、D33。** 忘掉一条记忆包含整条修订链及其来源，确认前列出连带条目；独立的其他话题和默认保留的聊天原话不动。同批最新指令一起核对，取消先于命令提交就不删除；已提交的命令以 Core 实际回执为准，只有确认成功才能说「已经忘了」。纠正也必须关联真实消息原话，模型改写只是提议；宿主核对 Core 的来源能力，由 Core 复用该消息的来源、逐字片段和形成规则。
7. **接口变化要同步。** 改 `/personal/v1/memory` 下的路由，同时改 [CLIENT_API.md](CLIENT_API.md) 和安卓白名单（`Network.kt::validBusinessPath`、`BusinessRouteUnitTest.kt`）。
8. **真实内核的测试进 CI 名单。** 新增接真实 MemoWeft 的测试，加进 `observed-core` 的文件名单；换内核的固定版本时，同时改那里的 `ref`，并在 PR 里说明。
9. **范围。** 只改上表里的记忆文件和 MemoWeft 仓库，界面只改记忆页。别的端、别的功能有问题，记下来交给总代理。
10. **先看在途的工作。** 开工前查 GitHub 上打开的、动到记忆的 PR，不要并行重写同一块。2026-10-15 在途的有 FIX-50（遗忘）和 APPLE-14（iPhone 单机记忆）；APPLE-14 属于后续平台（D101），不在这条轨道里。
11. **收尾时落盘。** 新结论写进这一页或 DECISIONS，不留在对话里；地图第 4 节记忆那一行同步更新。

## 3. 第一步

1. 按规则 1 跑 M1–M5，写下每个场景在两种环境里的结果。
2. 写打包方案比较（规则 4），交本人选。
3. 把失败的场景按根因归并成少数几个包，写进 PLAN 当前清单的记忆一项，然后一个一个修。
4. 核实旧插件 `weftmate-memory.mjs` 是不是完全不起作用；是的话，连同 DSH 配置模板里的引用一起删（先查清 R7–R10 模板的升级兼容）。

## 4. 做完的标准

PLAN 里的 M1–M5 在 Windows 安装版（包括全新安装）和安卓上都通过，结论和安装包版本记进地图第 4 节；全新安装的记忆有了本人选定的打包方式。
