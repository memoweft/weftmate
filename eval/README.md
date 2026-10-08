# M0-7 场景评测

这份评测使用 Node 24 和 `/personal/v1`，没有新依赖。首批定义共 12 条：办事 6、记忆 4、跨端 2。Mac 用假 HTTP 服务自测 runner；Qwen / MiMo 的真实基线由 Windows 跑，不能把假服务通过率当作模型或产品通过率。

## M0-7b 正式基线

Windows 可运行 `node tests/integration/personal-scenario-baseline.mjs`（Qwen）与 `node tests/integration/personal-scenario-baseline.mjs --mimo`。每次启动真实 Electron（桌面程序框架）和固定 DSH（执行框架），新建隔离所有者账号和独立 MemoWeft Core（记忆核心）数据目录。两个模型都只登记指定入口和模型；记忆换模型场景的第二轮使用另一模型。密钥直接读取 Windows 用户环境中的 `MODEL_SWITCH_UNIFIED_KEY` / `MIMO_API_KEY`，通过账户 API（应用接口）传入仅内存的测试凭据适配；不读取日用保险库。程序退出后删除本次测试凭据、Cookie（会话凭据）与设置授权文件，并扫描隔离产物是否含明文模型密钥。

`--diagnostic` 仅补验 action-06，不计正式基线。测试入口为主进程和原生 DSH 添加只记录时间与计数的 fetch（网络请求）观测：开始、响应头、首块、完成/取消、令牌用量；不记录请求头、目标文本、推理文本或密钥。私有产物位于 `C:/Temp/weftmate-m0-7b-*`。正式报告仍由 `/personal/v1` 的 `turn.ended` 判定完成；请求结束不等于场景通过。

测试通过已有 `/settings/models` 为隔离账号明确选择主评测模型作为后台模型，并先确认Core记忆注入可用，避免新建私有配置尚未被选中造成的测试配置失败。新对话和换模型仍按原场景执行；不向记忆底层写入预制事实。

场景文件是 JSON 子集，校准依据写在 `notes`（说明字段）中，作为可由评测器保留的注释。2026-10-08 实测本地 27B 首轮 8,468 令牌预填充约82秒，生成约6–13 tokens/s（每秒令牌数）。时限涵盖全部回合：整理/读代码360秒；联网资料/脚本900秒；停止续做/删除两轮600秒；两轮记忆600秒、三轮纠正900秒。人工跨端600秒。目标、检查、审批次数与决定保持；不对未声明审批自动放行。时限是正式失败的截止线，不保证模型一定完成。

报告中的每轮 `startedAt` / `endedAt` / `durationMs` 和 `timeline`（事件时间线）只保存公开事件类型、序号及时间，便于与8081和后端日志对齐。超时轮也保留已观察事件及耗时。

## Windows：先启动隔离宿主

**runner 必须与宿主在同一台机器运行**，因为测试文件由 runner 写进这台机器的系统临时目录，检查也读取这些临时文件。`--host` 是宿主的 origin，不带 `/personal/v1`。跨端场景需要真人拿手机验收，自动运行只列为「需人工」。

在仓库根目录打开 PowerShell。选择全新的隔离数据目录，绝不用 `D:\AIProjects\WeftMate\Runtime`，也不复用日用账号、模型密钥文件、记忆服务数据或联系人。宿主启动脚本需要的 DSH vendor 由 Windows 正常开发环境提供；本评测不生成 vendor。

```powershell
$evalRoot = Join-Path $env:TEMP ("weftmate-eval-host-" + [guid]::NewGuid())
$evalProfile = Join-Path $evalRoot 'profile'
$evalWorkspace = Join-Path $evalRoot 'workspace'
New-Item -ItemType Directory -Path $evalWorkspace -Force | Out-Null
node scripts/run-personal-host.mjs --user-data-dir $evalProfile --workspace-dir $evalWorkspace --access-port 18790
```

这是持续运行的宿主终端；runner 在第二个 PowerShell 终端运行。评测期间保持隔离宿主启动。API 无法证明宿主的 `--user-data-dir`，因此隔离必须由这个启动方式保证；仅仅换测试账号不能代替隔离宿主。

### 测试账号、模型与所有者能力

默认 runner 自动 POST `/auth/register` 创建随机 `eval-<UUID>` 账号，再 POST `/auth/login`；随机密码仅写入 `<out>/credentials.json`（文件模式 0600，目录 0700；Windows 权限仍由本机 ACL 决定）。输出目录自动写 `.gitignore`（忽略所有内容），密码、Cookie、CSRF 和 setup grant 不出现在报告中。再次用同一个 `--out` 会登录原测试账号，且核对 host 和 `eval-` 前缀；没有指定日用账号的参数。

**当前契约的限制**：普通注册账号与宿主所有者不同，不能借用所有者模型/桌面能力，任务 stop/resume 只适用于 `personal-remote` 会话。要评测六条办事场景，应在**全新隔离宿主**中让 runner 通过 setup grant 创建 `eval-` 所有者测试账号。这个动作只初始化隔离宿主，不修改产品权限。

在上面的宿主终端逐行输入宿主已有的管理命令：

```json
{"action":"account.setup"}
```

宿主打印 `setupLinkFile=...`。文件内容为临时 setup 页面链接。将**文件路径**交给 runner，不把 grant 放命令行或报告里：

```powershell
node scripts/eval.mjs --host http://127.0.0.1:18790 --model qwen --out out/eval-qwen --setup-file 'C:\实际隔离目录\profile\personal-access\setup\setup-UUID.json'
```

若模型尚未配置，报告会说明 `unsupported`，账号及本地凭据仍已创建。然后在隔离宿主控制台按 Windows 的 M0-6 启动方式配置本地模型；已有控制台命令可以登记本地模型目录：

```json
{"action":"model.configure-local-catalog"}
```

这只登记模型目录，不证明模型服务已经启动或能推理。也可在隔离宿主 UI 登录 `out/eval-qwen/credentials.json` 中的测试账号，配置其测试模型。Qwen 和 MiMo 都必须出现在该账号的 `GET /personal/v1/models` 中且 `configured:true`。`--model qwen` 先匹配 profile 的 `id`，否则匹配唯一的显示 `name`（忽略大小写），不会猜测或挑选其它模型。真实 profile 名不是 `qwen` 时，用它的实际配置名。对照模型的密钥也只配在隔离测试账号，不复制日用数据目录。

基线命令（已配置模型后重新运行，不再传 setup-file）：

```powershell
node scripts/eval.mjs --host http://127.0.0.1:18790 --model qwen --out out/eval-qwen

# 同一个 eval 账号、不同的结果目录；只复制本地测试凭据，不进 Git。
New-Item -ItemType Directory -Path out/eval-mimo -Force | Out-Null
Copy-Item out/eval-qwen/credentials.json out/eval-mimo/credentials.json
node scripts/eval.mjs --host http://127.0.0.1:18790 --model mimo --out out/eval-mimo
```

记忆可能受同账号先前基线影响。严格对照建议为两次基线各启一个全新的隔离宿主 profile（不同端口、不同 out，分别 setup），并连接独立的测试记忆服务数据。若不连接记忆，记忆场景的行为检查可能失败，报告会保留这个事实。`--personal-memory-config <隔离测试配置绝对路径>` 是宿主启动参数；不能指向本人日用记忆配置/存储。评测不通过底层记忆接口写假数据冒充日常形成。

## 参数与运行

```powershell
node scripts/eval.mjs --host http://127.0.0.1:18790 --scenarios 'eval/scenarios/*.yaml' --model qwen --out out/eval-qwen --only action-06-delete-approval
node scripts/eval.mjs --host http://127.0.0.1:18790 --model qwen --out out/eval-qwen --judge-model same
node scripts/eval.mjs --host http://127.0.0.1:18790 --model qwen --out out/eval-qwen --judge-model mimo --switch-model mimo
node --test tests/eval-runner.test.ts
```

- `--host <origin>`：必填，宿主地址。
- `--scenarios <glob>`：默认 `eval/scenarios/*.yaml`，交给 Node 原生 glob；请用引号避免 shell 展开。
- `--model <配置名>`：默认 `qwen`，只从测试账号已配置模型选择。
- `--out <dir>`：默认 `out/eval`，保存结果和本地测试凭据。再次运行会覆盖报告，保留账号；需要保留每次基线请使用新结果目录。
- `--only <id>`：只跑该场景。
- `--judge-model same|<配置名>`：启用可选 LLM 评判，`same` 使用该轮实际模型（换模型后也随之变化）。未传时评判跳过并记明；不会为了评判自动配置模型。
- `--switch-model <配置名>`：替代记忆换模型场景的 `$alternate`；默认 qwen 换 mimo，其余配置换 qwen。
- `--setup-file <path>`：只在未初始化的隔离宿主首次创建 eval 所有者时使用，读取宿主生成的 setup 链接文件。已有 credentials 时沿用登录，不重复 setup。

脚本通过 Cookie、同源 Origin 和 CSRF 写入；从 `/status.hostId` 取执行目标，通过 `/commands` 创建会话/发送，轮询 commands、events 和 approvals。事件按服务端 `nextSeq` 向前读取至无 `hasMore`，不用条数推算游标。202/accepted_by_dsh 不算完成，必须看到 `turn.ended`。停止等待 aborted，再等任务 `canResume` 后续做。不存在同会话换模型 API，因此场景的换模型会在新模型上新建会话，不复制旧偏好。

`timeoutSec` 覆盖该场景的准备、全部回合、检查和 judge，包括挂起 HTTP 请求；注册/登录等整次运行前置请求另有 15 秒超时。失败或超时后 runner 对当前会话登记 cancel，最多再等 2 秒，报告会说明它只是取消请求、未证明后台副作用已停止。临时文件保留供检查，必要时先退出隔离宿主，再人工清理结果中的 `scratchDir`；脚本不清理用户数据。

## 写场景

`.yaml` 使用 **YAML 1.2 的 JSON 子集**，可读的 UTF-8 JSON 对象就是有效 YAML；runner 为避免依赖和隐式类型转换，只接受这个子集，用 `JSON.parse` 读取。不支持缩进式 YAML、注释、锚点、标签、单引号或尾逗号。复制现有场景修改即可，使用 `node --test tests/eval-runner.test.ts` 验证首批场景结构。

```json
{
  "id": "example-organize",
  "category": "action",
  "title": "整理小票",
  "setup": {
    "files": [{"path":"小票.txt","content":"茶 25\n咖啡 24\n"}],
    "memories": [],
    "devices": ["宿主电脑，runner 同机"]
  },
  "turns": [{"user":"{{testDir}}/小票.txt 里是今天的开销，帮我算一下合计，把结果存到 {{testDir}}/合计.txt 吧。"}],
  "checks": [
    {"type":"file_contains","path":"合计.txt","text":"49"},
    {"type":"turn_status","status":"completed"}
  ],
  "timeoutSec": 120,
  "notes": "只在 runner 临时目录读写。"
}
```

所有文件路径都是临时目录内的相对路径，不允许绝对路径、`..` 或反斜线；Windows 也用 `/`。runner 自动生成 `setup.files` 并替换用户文本中的 `{{testDir}}`。检查拒绝文件/祖先目录 symlink，避免检查读到目录之外；目标文本本身也必须只要求操作测试目录，隔离宿主工作目录亦应独立。用户目标写成自然日常表达，不暗示 shell、read_file、浏览器工具等具体工具。

`setup.memories` 是需要预先告诉助手的自然语言字符串，runner 会在开始时逐条发送；为空代表由场景的显式 turns 形成记忆。若用预置记忆来测跨会话采用，请在实际 turns 中声明 `after.newSession`，不要让同会话上下文冒充记忆。`setup.devices` 声明实际需要的设备，不自动连接设备。

每轮以 `user` 表示输入，可选：

```json
{
  "user": "这份过期草稿我不需要了，帮我删掉吧。",
  "approvals": [{"outcome":"allowed-once","reasonMatches":"删除|delete"}],
  "after": {"newSession":true,"model":"$alternate","waitMs":1000}
}
```

`approvals` 按出现顺序处理，outcome 只有 `allowed-once`（批准这一次）和 `rejected`（拒绝）；可选 reasonMatches 对公开审批原因匹配。只批准场景声明的次数和范围；未声明或原因不符的审批会失败并请求取消，不默认允许。缺少应有审批也失败。`stopAfterMs` 表示本轮发送后延迟多少毫秒发 stop；下一轮 `resume:true` 使用原任务 resume 而非发送新根任务。模型改变需要 `after.newSession:true`。`waitMs` 只是显式等待窗口，不证明记忆已经形成。

跨端场景加 `manual:true`，runner 不注册账号、不创建文件、不操作手机（若同次运行还含自动场景，它们仍会执行）。人工验收者应在系统临时目录创建 setup.files，替换目标的 `{{testDir}}`，用隔离 eval 账号完成设备操作并保存截图/观察记录；报告「需人工」不会自动转成通过。原对话内进度、审批、成果展示按 PLAN D5–D9 / M1-0 验收，不能用独立任务页代替。

## 检查与结果

检查的 `turn` 是从 1 开始的场景回合编号（不包括 setup.memories），省略时检查最后一轮。文件检查在指定轮结束时立刻执行并保留结果，后面回合改变文件不会覆盖先前断言。回复检查只看该轮 assistant.message，不将历史回复混入；判断 completed 以 turn.ended 为准，error 映射 failed，并保留 endReasonKind。

| 类型 | 字段 | 当前情况 |
|---|---|---|
| `file_exists` / `file_absent` | `path` | 可用，仅测试目录内 |
| `file_contains` | `path,text` | 可用，UTF-8 包含检查 |
| `reply_contains` | `text` | 可用，区分大小写 |
| `reply_matches` | `pattern,flags?` | 可用，JavaScript 正则，默认 `u` |
| `turn_status` | `status` 字符串或数组 | 可用，如 completed / aborted / blocked / failed |
| `approval_seen` | `outcome?,reasonMatches?` | 可用，核对本轮实际看到并按声明提交的审批；POST answered 只说明决定登记，不冒充 resolved |
| `memory_used` | 可选描述字段 | **unsupported**：CLIENT_API §3.4/§3.9 没有逐条回复采用记忆的依据字段。memory/items/sources 是记忆来源，capabilities.inject 是能力，replyEvidence 是输出状态，均不能证明采用 |
| `llm_judge` | `prompt` | 可选；未配置 skipped；配置后通过模型代理，用当前轮实际模型或指定 profile，严格读取 JSON pass/reason。判断只依据目标和回复，不读取内部推理或宣称证明文件事实 |

输出：

- `<out>/results.json`：每场景状态、耗时、完整回合回复、检查结果、原因、临时目录、超时/取消信息。
- `<out>/report.md`：每条通过/失败/需人工/不支持、耗时、原因、最终回复摘要（最多 500 字符），逐项检查和末尾汇总。
- `<out>/credentials.json`：唯一保存随机密码的本地凭据文件，**不要提交/分享**。报告不包含此内容。

场景中任一检查失败即「失败」；无失败但有 memory_used 等不支持的必需检查即「不支持」，其余成功的行为检查仍逐项列出；可选 judge skipped 不使其它已验证检查失败。记忆场景因此不会仅凭关键词碰巧出现就被计成完整通过。可判定通过率 = 通过 /（通过 + 失败）；另列全部覆盖率 = 通过 / 全部条数，需人工、不支持不算通过。无法判定时通过率为 N/A。退出码：0 无失败（仍可能有不支持/需人工），1 有失败，2 参数/场景等运行错误；使用 JSON 的状态/覆盖率判断是否完成验收。

首批清单：

| ID | 场景 |
|---|---|
| action-01-organize | 整理指定目录 |
| action-02-web-document | 查官方网页并保存中文文档 |
| action-03-read-code | 读项目代码回答金额与精度问题 |
| action-04-research-script | 查资料 → 写脚本 → 实际运行 → 汇报 |
| action-05-stop-resume | 中途停止再继续 |
| action-06-delete-approval | 删除批准一次、拒绝一次 |
| memory-01-preference | 告诉偏好 → 新对话采用 |
| memory-02-correction | 纠正理解 → 后续按纠正走 |
| memory-03-switch-model | 换模型后记得称呼 |
| memory-04-person | 再提某人能联系上背景 |
| cross-01-desktop-approval | 电脑发起、手机看进度并审批（人工） |
| cross-02-phone-result | 手机发起、电脑执行、手机看成果（人工） |
