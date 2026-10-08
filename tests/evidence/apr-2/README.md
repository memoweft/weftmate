# APR-2 同命令动态写目标

2026-10-09，Codex · Windows-3；[PR（拉取请求）#97](https://github.com/memoweft/weftmate/pull/97)。只修改审批风险策略、目标解析模块、对应测试与本目录证据、STATE 的 Windows-3 行。客户端契约、界面、记忆实现与 D12 审批模式保持。

同一条 PowerShell（命令解释器）命令先算出新文件路径，再写入该变量时，原策略把目标当成未知覆盖。本包按语句顺序做 static evaluation（静态求值），不执行表达式或脚本；只把可以证明的路径交给原有存在性和本对话创建文件规则。新文件自动，已有用户文件覆盖和未知写入继续审批，删除与移动覆盖继续审批。

支持 PowerShell 的字面量赋值、Join-Path（路径组合）、字符串拼接／插值、$PWD（当前目录）、环境变量、Set-Location／Push-Location／Pop-Location（目录切换／压栈／恢复），以及 bash（命令解释器）的 VAR=、cd、$(pwd)。映射 `[IO.File]::WriteAllText/WriteAllBytes/AppendAllText`、New-Item、Out-File、Set-Content、Add-Content、`>`／`>>`、Invoke-WebRequest -OutFile、curl -o／--output 的目标。字面量参数、括号内 Join-Path、移动到目录时的源文件名也参与解析；未知源文件名不会放过目录中的潜在覆盖。

固定字面量 foreach（遍历循环）列表，包括 @(...），可以有限静态展开。分支只保留各路径相同的变量与目录事实。动态集合、用户输入、网络内容作为路径、函数返回值、无法确认的目录或表达式继续按未知写入审批。写入内容本身可以来自网络；路径必须可证明。未知命令不建立路径事实，复杂或混合引号表达式不能被猜成一个不存在的文件。

另补真实回归观察到的 Node.js（脚本运行时）字面文件 URL（资源地址）：`new URL('./result.json', import.meta.url)`。已有 result.json 仍需审批。JavaScript（脚本语言）源码只使用原有脚本目标解析，不把箭头与比较符号当成 shell（命令解释器）重定向。

## EV-1 原始命令离线重判

[原始命令](action-02-original-command.json) 从 EV-1 保存的待审批记录提取，命令未改。实际保存命令与派单里的 notes.md 示例有差异：它对两个固定版本 `v24.0.0`／`v22.0.0` 遍历，`$p=Join-Path $dir "$v.html"` 后调用 `[IO.File]::WriteAllText($p,$r.Content)`。本包解析的是这条原始命令，不是另造一个简单命令代替。

[offline-replay.json](offline-replay.json)：同一命令旧策略为 overwrite（覆盖），新策略无审批。根目录已经存在，但两个 HTML（网页文档）目标均不存在；创建已有目录不被当成文件覆盖。命令 SHA-256（内容摘要）为 `2e9bf9bb35e7be9522e35422adf248baa1edc9df0139100d2b32c9129a789100`，模型请求0，不执行命令，不修改原始文件。重判从 EV-1 提交 `33d8cada6a9f7d149ba452aae86ef7f08c4d6686` 读取两个原模块。

```powershell
node tests/evidence/apr-2/replay.mjs
node --test tests/personal-dynamic-write-targets.test.ts tests/personal-approval-modes.test.ts tests/personal-tool-approvals.test.ts tests/personal-approval-bridge.test.ts
npm run typecheck
```

最终相关测试82/82，无失败或跳过；类型检查通过。每种写入形式覆盖新文件与已有用户文件，另覆盖未知输入／网络路径／动态循环／函数返回、分支与重赋值、目录切换、环境变量、删除和移动覆盖。完整测试交 PR 的 CI（持续集成）。[verification.json](verification.json) 保存最终验证概要。

## 真实 MiMo（小米模型）验证

真实 Electron（桌面程序框架）+ 固定 DSH（执行框架），每批独立合成账号、隔离 Core（记忆核心）、系统临时目录和随机端口。模型 `mimo-v2.6-flash`。原 action-01..06 的目标、预算、检查和审批决定均不改，[原场景校验](original-scenarios.json) 对照 EV-1 逐文件确认。可选模型评判未启用；没有改场景来避开审批。

```powershell
node tests/integration/personal-scenario-baseline.mjs --mimo --mimo-machine --only action-01-organize,action-02-web-document,action-03-read-code,action-04-research-script,action-05-stop-resume,action-06-delete-approval
node tests/integration/personal-scenario-baseline.mjs --mimo --mimo-machine --only action-02-web-document,action-06-delete-approval
```


最后两项安全补修：Node 文件 URL 的未支持转义／无法解码值保持未知；PowerShell 的 `"$PWD.Path/..."` 将 `.Path` 保留为普通字符串，只有 `$($PWD.Path)` 显式子表达式才求值，`${PWD.Path}` 保持未知。类型／作用域重赋值、自增、bash 的 PWD／OLDPWD、失败或非目录的目录切换均有安全反例。

| 批次（失败完整保留） | 01 | 02 | 03 | 04 | 05 | 06 | 通过数 |
|---|---|---|---|---|---|---|---|
| [development-1](development-1.json) | 失败 53.33s | 通过 267.21s | 通过 43.81s | 失败 45.87s | 通过 172.53s | 通过 375.69s | 4/6 |
| [development-2](development-2.json) | 失败 31.11s | 通过 636.58s | 失败 360.41s | 失败 59.14s | 通过 82.77s | 通过 348.32s | 3/6 |
| [development-3](development-3.json) | 失败 58.80s | 通过 386.00s | 通过 355.13s | 失败 346.77s | 通过 160.65s | 失败 600.39s | 3/6 |
| [development-repeat](development-repeat.json) | — | 通过 347.35s | — | — | — | 通过 355.98s | 2/2 |
| [mimo-regression](mimo-regression.json) | 通过 43.72s | 通过 567.15s | 通过 359.28s | 通过 396.93s | 通过 350.36s | 通过 387.14s | 6/6 |
| [mimo-repeat](mimo-repeat.json) | — | 通过 744.15s | — | — | — | 通过 338.36s | 2/2 |
| [safety-regression](safety-regression.json) | 失败 22.54s | 通过 719.17s | 通过 333.35s | 通过 368.42s | 通过 54.19s | 通过 362.35s | 5/6 |
| [safety-repeat](safety-repeat.json) | — | 通过 563.13s | — | — | — | 通过 359.48s | 2/2 |
| [final-repeat](final-repeat.json) | — | 通过 513.51s | — | — | — | 通过 324.43s | 2/2 |

每个批次保留实际宿主两个审批模块的 SHA-256，不能把不同代码快照的六项通过声明为当前版本全通过。安全补修后的六项为 5/6：action-01 使用动态 `ForEach-Object`、哈希表和成员访问，目标不能静态确认，仍要求 overwrite；场景无匹配决定，取消后失败。按续做要求，不再为此扩展复杂解析。此前六项 6/6 是补修前快照的真实结果，保留供比较。

最终当前代码只补跑 action-02 与 action-06 各一次，结果 2/2；快照与当前代码一致。02审批数 0；06原生决定 delete: allowed-once、delete: rejected。所有失败保留，总计 38 项执行、29 通过、9 失败；这不是最终版本通过率。各批次原目标、预算、检查和允许／拒绝决定均保持，可选 llm_judge（模型评判）未配置的检查明确标记 skipped（跳过）。

开发失败清单：

- `development-1` / `action-01-organize`：Unexpected approval; scenario has no matching decision (left pending)。
- `development-1` / `action-04-research-script`：Unexpected approval; scenario has no matching decision (left pending)。
- `development-2` / `action-01-organize`：Unexpected approval; scenario has no matching decision (left pending)。
- `development-2` / `action-03-read-code`：Scenario timed out。
- `development-2` / `action-04-research-script`：Unexpected approval; scenario has no matching decision (left pending)。
- `development-3` / `action-01-organize`：Unexpected approval; scenario has no matching decision (left pending)。
- `development-3` / `action-04-research-script`：Unexpected approval; scenario has no matching decision (left pending)。
- `development-3` / `action-06-delete-approval`：Scenario timed out。
- `safety-regression` / `action-01-organize`：Unexpected approval; scenario has no matching decision (left pending)。

## MiMo 费用与隔离

| 批次 | 请求 / 有用量 / 无用量 | 输入 token（令牌） | 缓存输入 | 输出 | 已知估算人民币 |
|---|---:|---:|---:|---:|---:|
| development-1 | 39 / 36 / 3 | 607457 | 260288 | 11032 | ¥0.37443876 |
| development-2 | 43 / 38 / 5 | 837011 | 294656 | 15498 | ¥0.57924412 |
| development-3 | 43 / 38 / 5 | 1404753 | 298880 | 14798 | ¥1.14144660 |
| development-repeat | 20 / 19 / 1 | 651822 | 144000 | 12473 | ¥0.53564800 |
| mimo-regression | 45 / 39 / 6 | 854945 | 304896 | 12053 | ¥0.58025292 |
| mimo-repeat | 22 / 21 / 1 | 901017 | 158720 | 14884 | ¥0.77523940 |
| safety-regression | 54 / 50 / 4 | 1362734 | 409344 | 14784 | ¥0.99114488 |
| safety-repeat | 22 / 20 / 2 | 778559 | 170176 | 13147 | ¥0.63808052 |
| final-repeat | 27 / 26 / 1 | 1281561 | 232384 | 17214 | ¥1.08825268 |
| 合计 | 315 / 287 / 28 | 8679859 | 2273344 | 125883 | **¥6.70374788 下界** |

[usage.json](usage.json) 包含全部开发、失败、取消和验收批次；只计真实上游请求，去除本机转发重复。2026-10-09 重新核对[官方价格](https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash)：缓存输入¥0.02、未缓存输入¥1、输出¥2／百万 token。28 笔请求无用量，因此估算是已知费用下界，不是账单；HTTP 429（请求限流）0。离线重判费用0。

每批清除合成凭据文件并扫描隔离根，模型密钥命中均为0；共享依赖链接不遍历。公开证据只含检查、审批结论、快照摘要与费用汇总，原日志／账号数据留仓库外。未使用局域网或本地模型推理，未触碰日用数据。

## 正反例与边界

- 正例：31种常见命令写法分别验证新文件不审批，包括赋值、Join-Path、拼接／插值、当前目录／环境变量、目录切换、所有任务要求的写入调用和重定向；固定字面列表及字面 Node 文件 URL 另测。
- 反例：同31种写法目标已存在均审批；未知输入、网络路径、函数返回、动态循环、分支、重赋值、混合引号、失败目录切换、URL转义均审批；`>`／`>>` 到已有文件、Remove-Item／rm -rf、Move-Item／mv 覆盖及已有目录中的同名目标均受保护。
- 未做：任意复杂 shell（命令解释器）语法／函数／动态控制流的完整求值，客户端、界面、记忆和长期浸泡测试；普通新目标移动仍遵循既有规则。未知写入继续审批，action-01复杂写法保留失败。完整单测交 PR 的 CI。
