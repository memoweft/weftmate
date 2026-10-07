# S00-A 本机核验

2026-09-08，在实际 Windows 工作区执行。以下首先记录上一轮本机删除与检查结果；这不等于 S00-A 全部归位完成。用户反馈后的补正见文末。

## 核验结果

- 24 个精确清理目标全部删除，共 752,420 个文件条目，逻辑文件大小约 11.094 GiB。此数是文件长度合计，不等于实测磁盘物理释放量，硬链接和压缩可能影响差异。
- 主仓库布局检查通过，核对 23 个入口/文档文件；手机仓库通过，核对 6 个。检查包括仓库内现行文档链接与精确忽略规则。
- WeftMate 许可证契约：1 项通过；手机发布打包测试：3 项通过。后者有 1 条既有 Starlette/httpx 弃用提示，未更改依赖。
- 两个变更仓库 `git diff --check` 通过。
- 对六个现用仓库的 17,694 个原始文件记录做 SHA-256（文件校验摘要）复核：17,680 个字节相同，14 个是本次预期的文档/忽略规则修改或删除，意外变化为 0。四套已明确清理的未追踪运行候选不纳入源码基线。
- 六库 Git HEAD（当前提交位置）全部保持原值；MemoWeft/Core、Hermes、共享 DSH 和 WeftLearn 的原有文件全部字节相同，包括开始时的未提交改动。
- 删除前扫描现用仓库 27,895 个目录链接，未发现指向本次检查的打包/导出清理目标的依赖；清理脚本另对全部目标逐项校验绝对路径与父目录，不跨链接递归删除。
- 两份用户指定输入移到 WeftMate/References。工作期间根目录新增一份前端现状说明，也归入 References，未将其旧快照结论合并成本机状态。没有创建备份。

本机校验摘要和清理清单见 [local-validation.json](local-validation.json)。本轮新增的文档与检查脚本不计入开始时的文件基线。

## 精确清理目标

路径相对于本机工作区根；清理目录包括其全部子项。单项文件数与大小为删除前统计。

| 目标 | 文件数 | MiB |
| --- | ---: | ---: |
| `_ProjectRepairArchive` | 859 | 15.14 |
| `.pytest_cache` | 4 | 0.01 |
| `WeftMate/Exports` | 17,853 | 318.86 |
| `WeftMate/.codex` | 5 | 0.26 |
| `WeftMate/Repository/.stage` | 34,071 | 249.93 |
| `WeftMate/Repository/.tmp` | 1,457 | 302.24 |
| `WeftMate/Repository/NVIDIA Corporation` | 0 | 0.00 |
| `WeftMate/Repository/docs/ROADMAP.md` | 1 | 0.00 |
| `WeftMate/Repository/docs/AI-GAME-AUTONOMOUS-MOBILE-TASKS.md` | 1 | 0.00 |
| `WeftMate/Runtime/Stage3/builds` | 131,859 | 3481.52 |
| `WeftMate/Runtime/Stage3/install` | 32,955 | 627.11 |
| `WeftMate/Runtime/Stage3/staging` | 131,396 | 980.91 |
| `WeftMate/Runtime/Stage4B/dsh-47f943859bef-stage4b-src` | 400,786 | 5109.96 |
| `WeftMate/Runtime/Stage4B/dsh-47f943859bef.tar` | 1 | 51.57 |
| `WeftMate/Runtime/Stage4B/pack-probe-artifact` | 1 | 0.05 |
| `AIGame/Repository/.managed-runtime-candidate-4161310` | 285 | 42.30 |
| `AIGame/Repository/.managed-runtime-verify` | 288 | 42.30 |
| `AIGame/Repository/.managed-runtime-verify-closure` | 285 | 42.30 |
| `AIGame/Repository/.managed-runtime-verify-final` | 276 | 40.65 |
| `AIGame/Repository/.pytest_cache` | 2 | 0.24 |
| `AIGame/Repository/.ruff_cache` | 4 | 0.00 |
| `AIGame/Repository/work` | 29 | 54.91 |
| `AIGame/Repository/docs/product/ACCEPTANCE.md` | 1 | 0.01 |
| `AIGame/Repository/docs/product/EXECUTION_CONTRACT.md` | 1 | 0.00 |

## 保留和未验证

保留现用源码、依赖、模型、工具链、Git 历史及含会话/凭据的运行数据。Stage3/data、Stage4B 的 owner/qa 数据等因此仍在原路径；它们是本机状态，不是当前任务或完成证据。

首轮没有应用启动、模型、设备、原生跨平台、用户体验或远端验证；本轮补读远端 HEAD 的范围见下文。用户 A01—A04 仍全部未测；没有提交、推送或改名远端。未引入旧包的测试日志充当本机证据。

## 用户反馈后补正的证据范围

两库已经建立 chore/repository-layout 整理分支，保留原提交及未提交变更；没有提交、fetch、推送或改名远端。只读 ls-remote 取得主程序指定远端与手机 origin 的默认分支/提交，实际值及本机未配置主程序 remote 的缺口见 CURRENT_STATE。

恢复累计包重要决定与完整开工资料后重新检查文档链接和迁移文件。此前 1+3 项测试结果仍仅属于首轮，没有冒称本轮重跑。完整远端差异、保护/发布引用和用户 A01—A04 均未完成，因此 S00-A 为进行中。

## 本次续办：剩余产物、旧开发约束与有限代码审查

用户追加授权审查代码并清理旧模型限制，明确当前只有本助手在修改。执行结果如下：

- 新增清理 50 个目标、62,933 个文件条目，逻辑大小约 1.655 GiB；两次累计 74 个目标、815,353 个文件条目，约 12.749 GiB。没有新建备份。所有目标均已确认不存在。
- 清理的旧模型约束包括 MemoWeft 外层 .codex 控制文档、Hermes Desktop 嵌套角色规则、旧空技能目录，以及各活动入口中的总代理/子代理、固定模型/数量、强制派单交接制度。WeftLearn 产品/教学要求保留，只删除其开发分工限制。
- Hermes skills/optional-skills 是 CLI 实际读取的功能资料；研究目录包含 11 个独立 Git 仓库。前者保留，后者移动到 References/Research。移动前后 3,600 个文件 SHA-256 相同，11 个仓库在新位置状态干净。
- 主程序 src 中 90 个源文件做了名称引用扫描，进一步核查 main、插件资产加载、Gateway、凭据、记忆等关键入口。src/runtime/gateway/legacy 仍被正式宿主加载，手机 ApplicationRuntime/MobileTask 仍有 API 接线；不能按 legacy 或旧命名删除。此范围不是全部上游源码逐行审计。
- vault-file-guard.ts 仅由 tests/vault-file-guard.test.ts 调用，公开/生产入口没有调用。两个文件已删除。在用 config-store.ts 调用 credential-vault-document.ts，相关读/存/删坏密文保护测试继续保留并通过，未删除产品凭据保护。
- `npm run typecheck` 通过；`node --test tests/credential-vault-document.test.ts tests/licensing-contract.test.ts` 为 4 通过、0 失败。
- 主程序/手机布局检查分别检查 24/6 个文件并通过；不存在的仓库路径按预期拒绝。五个变更仓库 diff 检查通过。10 个修改中的文档链接检查通过；现行 docs 不被忽略，四类精确私密路径受忽略。追踪文件名未发现所检查的 .env、数据库、私钥路径；这不是内容级秘密扫描。
- 六个现用仓库本轮开始时的 17,711 个文件校验未发现范围外变化；全部提交位置保持不变。实际变更是已列明的规则/文档与两个已授权删除文件。根目录导航和仓库外旧控制文件另按明确路径处理。

### 本次主要删除目标

另有 36 个 Python/测试缓存目录，完整路径、原因和数量同存 local-validation.json，不在正文重复展开。

| 目标 | 文件数 | MiB |
| --- | ---: | ---: |
| `WeftMate/Repository/dist` | 61,498 | 1542.04 |
| `WeftMate/Runtime/HarnessBuilds` | 5 | 0.28 |
| `WeftMate/Runtime/HarnessStatus` | 2 | 0.00 |
| `WeftMate/Runtime/IsolatedOnline` | 2 | 0.00 |
| `WeftMate/Runtime/K4D` | 7 | 0.01 |
| `WeftMate/Runtime/Stage3/evidence` | 4 | 0.00 |
| `AIGame/Repository/runtime/tmp` | 6 | 86.10 |
| `AIGame/Repository/runtime/releases` | 9 | 19.94 |
| `AIGame/Repository/runtime/review-bundles` | 338 | 6.35 |
| `AIGame/Repository/.agents` | 0 | 0.00 |
| `MemoWeft/.codex` | 5 | 0.04 |
| `MemoWeft/Hosts/HermesAgent/apps/desktop/AGENTS.md` | 1 | 0.00 |
| `WeftMate/Repository/src/vault-file-guard.ts` | 1 | 0.00 |
| `WeftMate/Repository/tests/vault-file-guard.test.ts` | 1 | 0.00 |

### 远端接续的事实边界

取得完整非浅 Git 对象后，主程序本地与远端没有共同祖先，提交独有数为 8/88，已提交树差异为 275 个路径；手机本机领先远端 29 次提交，树差异 327 个路径。主程序 origin 已规范为用户指定地址，比较引用已收口到 origin/main。没有合并两条历史、提交、推送或重命名远端。

仓库/分支/工作流/发布/Pages 信息已从当前仓库接口核对：两个 main 的 protected 字段为 false，各有一个活动检查工作流，无发布，has_pages 为 false。手机规则集为空；主程序规则集读取为 HTTP 403，记录未能核实，不推定不存在。权限读取与实际远端写入是两回事。

精确提交、远端元数据、树差异路径、本次清理和选择性变更清单保存在 [local-validation.json](local-validation.json)。用户四项文档检查仍未测，产品启动/模型/设备未运行。远端历史整合不是本轮已完成事项。

本次临时辅助目录 `.local/layout-cleanup` 的最后删除操作被工具自动审批策略拦截（返回 blocked by policy，未提供更细原因）。目录内仅有本次脚本和校验元数据，受 .gitignore 忽略，不是源码备份；主要清理目标均已删除。
