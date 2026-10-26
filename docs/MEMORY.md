# 记忆 · 现在怎么工作

这一页只写记忆这条链路是什么样、改的时候要知道什么；工作规矩只看 [AGENTS.md](../AGENTS.md)。和 [DECISIONS.md](DECISIONS.md) 冲突时，以 DECISIONS 为准。

## 1. 方向（2026-10-24）

- **一个大脑、多个窗口**（D119）：只有电脑上的 MemoWeft 形成、纠正、遗忘记忆；手机、iPhone、手表存原话、读同步来的记忆。
- **换新做法，做到能用就行**（D120）：形成按原则判断，召回语义优先并附本人档案和原话，采用 MemoWeft #143 的 E2，并含 #145 的修订链导出修复（`05bf798066b57986ab74636860c5450cd7a2b041`）；CI 和随包清单固定同一版本，已被取代的旧状态不再同步给手机。「能用」= 想得起、改得了、忘得掉；换完不再在实验题上调。
- **根子在内核就修内核**（D111）：MemoWeft 是独立仓库，修好合进它的主线后，WeftMate 再换版本；不在 WeftMate 这侧加队列、日志、补做这类层来绕。

## 2. 删除怎么算（D16、D33）

- 忘掉一条记忆，连同它的整条修订链和来源一起删；确认前列出会被连带忘掉的条目。聊天原话默认保留，勾选了才删。
- 只有内核回执确认删除成功，才能对本人说「已经忘了」。拿不准是不是要删（问句、引述、否定、目标不清），就不删，问一句。
- 日志、PR、截图和问题单里不写真实记忆内容，只写条数、状态和合成例子。

## 3. 代码在哪（2026-10-15 读代码核实）

| 事实 | 出处 |
|---|---|
| 链路：每轮结束，记忆插件把真人原话交给摄取，再交给按账户管理的 MemoWeft 进程（Python，独立仓库 `memoweft/memoweft`）。召回、纠正、遗忘走同一条链 | `src/plugins/weftmate-personal-memory.mjs` → `src/personal-access/memory-ingestion.mjs` → `src/personal-memory/`：`index.mjs` 管理器（每个账户一个进程，同时最多 4 个）、`rpc.mjs` 通信、`journal.mjs` 命令日志、`actions.mjs` 纠正与遗忘、`http.mjs` 接口 |
| Windows 安装版无显式配置时自动定位随包组件并生成本次启动配置；已有 `--personal-memory-config=<文件>` 或安装配置继续优先，macOS 不变 | `src/desktop-config.mjs`、`src/personal-memory/config.mjs`、`src/main.mjs` |
| 旧 `--dsh-window` 兼容插件仍由 DSH 模板装载，默认关闭；启用后必须显式提供 `WEFTMATE_MEMOWEFT_PYTHONPATH`，缺少时报告「记忆未配置」且不启动 Python。它没有账户管理器的随包校验元数据，不能自行选择随包运行时；个人主路继续使用上面的自动接线 | `src/plugins/weftmate-memory.mjs`、`src/dsh-web-runtime.ts` |
| 这个文件必须指向本机已有的 Python 解释器和 MemoWeft 源码目录（目录里要有 `memoweft/integrations/dsh_bridge/__main__.py`）；记忆处理用的模型入口只能是本机 `http://127.0.0.1:<端口>/v1` | `src/personal-memory/config.mjs` |
| 安装版把 `desktop-config.json` 里的 `personalMemoryConfig` 转成上面的参数。自动配置不写入此项，每次按当前安装位置重算，账户记忆仍在用户数据目录；macOS 只在配置旁边已有 `memory-config.json` 时才加 | `src/desktop-config.mjs` |
| 本人从源码版迁移来的安装版，迁移脚本写入了这一项，所以它依赖本机现成的 Python 和 MemoWeft 源码 | `scripts/migrate-desktop-config.mjs` |
| Windows 默认完整语义层，基础层可单独构建。应用元数据固定组件清单散列，启动核对文件后接入；组件异常只停用记忆，聊天和数据保留。实际新装/升级验收仍按地图记录 | `src/personal-memory/bundled-runtime.mjs`、`scripts/memory-runtime/README.md`；D106 / D110 |
| 记忆页：桌面 `src/personal-access-ui/components/memory.js`，共用逻辑 `src/ui-core/memory.js`，手机网页 `apps/mobile-ui/www/components/memory.js` | — |
| 旧插件 `src/plugins/weftmate-memory.mjs`（约 1240 行）仍写在 DSH 配置模板 R7–R10 里。按文件头注释，它只在 `WEFTMATE_MEMOWEFT_ENABLED=1` 时工作；个人宿主模式下设这个变量，程序会拒绝启动。默认路径写死了一个本机目录 | `src/dsh-web-runtime.ts`、`src/main.mjs` 约第 172 行 |
| 安卓与手机网页只存对话原话、读电脑同步来的记忆副本；旧容器里的手机轻量记忆字段读入即丢弃，不上传。苹果端旧实现尚待后续移除 | `src/ui-core/offline.js`、`apps/mobile-ui/www/components/memory.js`；苹果旧代码 `apps/apple/Packages/WeftMateCore/Sources/WeftMateCore/PhoneMemory.swift` |
| CI 里接真实 MemoWeft 的作业固定到 Core 主线的一个提交；内核修好合进主线后，再用单独的 PR 换这里和随包运行时的版本 | `.github/workflows/ci.yml` 的 `observed-core`、`scripts/memory-runtime/lock.json` |

G9 新英文召回合同以首行 `Memory:` / `Memory (past):` 定格式并用 LF 分隔条目：生产端须在正文中任何以 `记忆：`、`记忆（过往）：`、`Memory:`、`Memory (past):` 或反斜杠 `\` 开头的行前再加一个 `\`，解析端只按未转义英文条目头切分并逐行还原一层合法转义，日期及正文空白原样保留，首行不是条目头、条数与 ID 数不符、出现未转义中文条目头或非法转义时按原预算保留完整原文而不配 ID，不跨格式回退，首行旧中文格式仍逐字沿用旧规则且不作转义还原。

初始化语言取自 DSH 界面设置的 `locale.preference`：个人宿主通过 `settings.describe` 的 `locale.value.preference` 读取，旧插件通过 `settings.get('locale').preference` 读取；只有 `'en'` 传英文，中文、未设置或读取失败均传 `'zh'`。已有桥进程保留初始化语言，重启或按现有机制重新初始化时才读取新值，不做热切换。未显式选择语言时，浏览器自己的临时语言不作为宿主配置；此时记忆仍回退中文。

真实 Core 测试只接受显式环境输入：`WEFTMATE_TEST_MEMOWEFT_PYTHON` / `WEFTMATE_TEST_MEMOWEFT_SOURCE`，或旧桥接名 `WEFTMATE_MEMOWEFT_PYTHON` / `WEFTMATE_MEMOWEFT_PYTHONPATH`。本包按 `scripts/memory-runtime/lock.json` 下载并校验的隔离副本也通过这些变量传入；测试不猜本机源码位置，缺配置明确跳过，手工验收脚本缺必需输入则报错。测试和脚本设置 `PYTHONDONTWRITEBYTECODE=1`，不向源码目录写缓存。DSH 源码测试/构建同样要求显式 `WEFTMATE_DSH_CHECKOUT`；已有固定成品缓存仍可复用。

E2 的 `selected_item_ids` 是整段召回的依赖，`count` 统计全部依赖，可含 `evidence`；档案和原话窗口不能与这些 ID 逐行配对。宿主保留有界整段正文及完整来源引用，桌面回合、历史补交和离线回传保留 `model_context_dependencies.world_items`，遗忘按原 ID 交 Core 处理。记忆页、导出和摘要仍只列四类正式记忆，原话不作为独立记忆展示。

## 4. 安装包里的记忆

安装包带受管 Python、MemoWeft 和完整语义层（D106、D110），用户不用装 Python；组件异常只停用记忆，聊天和数据保留。组件说明见 [scripts/memory-runtime/README.md](../scripts/memory-runtime/README.md)。

改 `/personal/v1/memory` 下的路由，同时改 [CLIENT_API.md](CLIENT_API.md) 和安卓白名单（AGENTS「写代码」）。

## 5. 手机窗口（D119）

安卓与手机网页每条消息只请求一次聊天模型；使用手机自配模型或电脑下发模型时，都从 `/offline/sync` 的 `snapshot.items` 选取相关记忆作为背景。没有电脑副本时如实说明记忆在电脑上形成、连上电脑后才有。手机不提炼、纠正或遗忘记忆；离线要求忘掉时，提示连上电脑后再说一次或去记忆页忘掉。

连着电脑时沿用电脑记忆页；断开后只读展示副本与上次同步时间，提示「电脑连上后可以修改和忘掉」。从没连过电脑时提示「记忆在电脑上形成。连上电脑后，这里会显示 WeftMate 记得的事。」原始对话加密保存在手机，连上电脑自动按原批次与轮次 ID 回传，不再按 100 轮或 256 KiB 要求手机确认；电脑回执确认前保留待交原话。旧 `phoneMemory` 字段丢弃不影响对话原话。
