# FX-11 首次写入来源与项目细节

验收使用合成账号、随机端口、临时目录、真实 `src/main.mjs`、固定 DSH（助手运行时）及 MiMo。没有访问 18186 / 8081，没有读取本人日用保管库或 `Runtime/UnifiedAssistant`，未改停止链路或审批风险判断。

## BL-14 根因与版本边界

FX-9 验收提交 `68b6d36c` 的 `artifacts.mjs` 在成果来源筛选中只允许 `device.authKind === 'password'`，遗漏 `cloud`（云账号登录）设备。通用执行回执已经接受云账号，原生 `write` 已经写出文件；随后 `register_file` 读回文件、登记成果时失败，原生工具因此显示 `TOOL_SOURCE_UNAVAILABLE`。后续命令写相同内容没有产生新文件变化，便不再触发这一登记错误。

PJ-1 合入时已经把该筛选改成密码与云设备均可用。本包起点包含这一修复，因此最初普通对话及原手机网页链路已经首写成功。本包没有声称新增修复这条已合入的条件：恢复**仅这一旧条件**做失败复现，补齐真实云身份的三场景回归，并在源码说明这一必须保留的来源语义。

- [旧条件集成复现](source-baseline.txt)：普通、项目、受信手机三项均失败，错误来自成果来源筛选。
- [现条件三场景回归](source-fixed.txt)：3/3 通过；覆盖首写、读回成果登记、原请求及原账号归属、伪造回执和撤销设备拒绝。
- [真实桌面旧条件复现](baseline/assessment.json)、[原生调用与结果](baseline/native-events.jsonl)：首次直接 `write` 失败，模型随后通过命令完成。旧运行器的 `phoneTask.passed` 只表示任务最终完成，**不表示首写通过**；assessment（结果判读）明确保留这一区别。

另外，最初普通对话复现发现 Windows（视窗系统）的工作目录扫描与显式文件参数可能只差路径大小写，同一文件因此被登记两次。本包按 Windows 文件身份合并观察键，保留实际路径；同一首写只生成一个成果，未变内容不重复登记，更新不被误判为新建。相关回归在 `personal-native-files.test.ts`。

## BL-13 界面

新建、编辑项目的文件权限都使用 UI-P2 的共用 combobox（组合选择框），保留原表单值和权限接口。真实程序验证鼠标、方向键、Home / Enter / Escape、焦点返回、创建可写项目及编辑只读 / 可写保存。

进展汇总按文件、命令、搜索、网页、计划、任务目标、子任务、定时安排、后台命令、脚本、电脑应用、记忆及扩展服务命名；`load_tools` 的成功准备步骤不计入操作数。旧历史的内部描述同样转为可读文案，失败的准备步骤仍可展开查看真实错误。原始工具名称与参数仅保留在数据和详情中。手机共享资产已重新生成。

| 真实场景 | 首次直接 write | 成果登记 / read 读回 | 审批 | 证据 |
|---|---|---|---|---|
| 普通对话 | 成功，1 次 | 通过 | 2 次 | [事件](confirmed/ordinary-first.txt.events.json)、[浅色](confirmed/ordinary-progress-light.png)、[深色](confirmed/ordinary-progress-dark.png) |
| 项目对话 | 成功，1 次 | 通过，项目目录 | 2 次 | [事件](confirmed/project-first.txt.events.json)、[浅色](confirmed/project-progress-light.png)、[深色](confirmed/project-progress-dark.png) |
| 受信手机网页发起电脑任务 | 成功 | 通过，原云账号 | 2 次 | [事件](confirmed/events.json)、[手机结果](confirmed/mobile-web-task-result-light.png)、[电脑结果](confirmed/desktop-phone-result.png) |

三种场景均未重试 `write`，未使用命令写入。项目浅色截图捕获读回运行行；原生完成事件及断言证明读回最终成功，未把界面轮询尚未同步的行描述成已完成。

项目对话框：[新建浅色](confirmed/create-project-permission-light.png)、[新建深色](confirmed/create-project-permission-dark.png)、[编辑浅色](confirmed/edit-project-permission-light.png)、[编辑深色](confirmed/edit-project-permission-dark.png)。[完整验收结果](confirmed/mobile-web-visual-verification.json)记录控件角色、键盘及保存行为。

## 验证与用量

- 相关五个测试文件 76/76 通过；后续文件观察与进展改动三个文件 55/55 通过，二者有重叠。[相关结果](related-tests.txt)、[后续结果](changed-tests.txt)。三场景回归最后单独复核 3/3。
- 既有桌面交互与弹出层回归 62/62 通过：[结果](interaction-tests.txt)。
- CI（持续集成）首轮发现项目夹具未限定原生平台、来源描述回退丢失具体扩展说明。已修正：项目文件夹的原生读取器目前只支持 Windows，因此项目场景与既有项目服务测试使用相同平台条件；普通 / 手机来源回归继续跨平台运行。具体扩展来源说明保持既有行为，不被进展的泛称回退覆盖。Windows 定向 4/4，WSL（Windows 的 Linux 子系统）定向 3/3、项目原生项按平台跳过：[Linux 结果](linux-targeted-tests.txt)，无新增 CI 例外清单。
- `npm run typecheck`、共享手机资产一致性、界面机械检测通过。全量测试交 GitHub CI（持续集成），结果见 PR（拉取请求）。
- 真实程序运行器使用 `_electron.launch`，加载真实 `main.mjs` 与固定 DSH；仅保管库改为测试内存实现、加入用量观察。旧条件复现另用明确的加载钩子，不改仓库生产源码。
- 初轮账号链路在任务通过后进入不相关账号操作超时；第二轮项目运行器在文件夹自动建议名称与填值之间发生夹具竞态，首写已通过但项目查找失败。确认轮修正夹具后全部通过。失败报告和用量分别保留在 `mobile-web/`、`final/`，没有抹除失败轮次。
- MiMo 已知 48 条原生回复或完整提供方用量报告：未缓存输入 32843、缓存读取 102272、输出 4264 token（词元）。[用量与轮次](usage.json)。配置 / 连接探测不在原生回复计数中；一轮早期错误审批夹具在请求仍进行时结束，未报告用量未知。已知总量为下界，不当作账单。密钥只在进程内读取，没有进入证据或仓库。

未安装或验证 Android（安卓）原生壳、Apple（苹果）客户端，没有发布界面包、部署生产云、中继复验或运行长期浸泡测试。手机场景是受信云账号的 390×844 远程网页。

已清理进程：7（早期错误审批夹具额外强制结束的本包进程树；其他宿主、Electron〔桌面程序框架〕、浏览器、WSL〔Windows 的 Linux 子系统〕云夹具均由运行器收尾正常关闭，不编造这些正常子进程的数量）。按 w3、本包临时目录及 Linux（操作系统）命令行检查没有残留；本包未启动模拟器。运行器正常清除各自资料目录；额外删除早期合成临时目录的递归操作被自动审批审查拒绝，未执行。
