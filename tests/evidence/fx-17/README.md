# FX-17 纠正记忆验证

QA-4首轮模型输出与重写输出的固定回放在Core（记忆核心）PR #99的 `py/tests/test_fx17_correction.py`；改前分别为 `topic_name_not_in_span`、`duplicate_cognition_in_batch`，改后同一新对象取代两个旧对象。原QA-4证据未改写。

- `before-mimo`、`before-mimo-2`：真实MiMo（小米模型）改前探测。实际出现确认命题拒写和未失效的肉桂提议项；没有冒充每次都重现同一个双目标重复错误。
- `full-mimo`：真实Electron（桌面程序框架）／固定DSH（助手运行时）／真实Core，两个肉桂对象失效、一个柠檬对象有效；34轮无关问答、重启、LAN（局域网）`local-quality`新对话回答柠檬且 `memoryUsed` 仅含新对象。
- `rejection-verified`：人为替换形成模型输出为非法解释，实际健康、动态、对应回合警示、展开原话、桌面点击重试通过；390×844远程网页展示通过；旧对象来源页可直接看到纠正原话。
- 较早 `after-mimo-1`、`rejection-final` 及八步／变体探索批次保留失败。`rejection-final` 暴露轮询重绘收起详情，已修为状态未变化时保留展开节点；未将原失败成绩改为成功。

运行器：`node tests/integration/fx17-correction-desktop.mjs --model mimo --core <Core>/py/src --out <evidence-directory> --full`；人为拒绝使用 `--reject`。固定题集见 `tests/fixtures/fx17-corrections.json`。真实核心回归 `tests/personal-memory-fx17.integration.test.ts` 还覆盖失败持续超过32轮、重启、连续失败重试、共享后继及两端来源。

这些开发运行包含未提交改动，运行器开头的Git（版本控制）HEAD（当前提交）不能代表完全固定的产品源码；最后固定提交由CI（持续集成）验证。失败、取消、重写与复跑全部计入用量。没有访问本人日用程序、18186、8081或日用密钥库。


最终复验：`wang-post-merge` 原王小明八步 **8/8**；`alternate-final` **4/4**；`delayed-post-merge` **4/4**。均为真实MiMo形成＋LAN新会话采用，变体实际采用确认决定自身ID（标识）；没有覆盖或放宽旧失败判据。`wang-final` 是已失败的探索批次，在等LAN时终止，其前三步原件、终止说明和实际用量保留。

确定性回放的改前失败见 `before-replay.txt`；编译／主题／近期召回／重试／RPC（远程过程调用）定向83项通过见 `core-focused.txt`。后续还固定并修复“重试成功后旧拒写原话仍被当作近期未整理内容”，专项31项通过。Core上一固定提交的全量CI为1908项通过、220模块严格类型检查通过；最终提交追加该回归，最终CI由Claude核对。WeftMate（宿主）类型检查通过，真实Core集成8项、HTTP（应用接口）／手机界面／调度相关46项、动态与界面相关9项通过。`core-ci-snapshot.json` 与 `weftmate-ci-snapshot.json` 为明确提交的检查快照，不将旧快照冒充后续提交。

两仓PR已开，均未合并或部署。MiMo完整用量见 `usage-total.json`，缺用量计为未知，不当作免费；没有另报未经本次核价的费用。最终复验摘要见 `verification.json`。新增常规评测入口 `eval/scenarios/memory-05-confirmed-correction.yaml`；耐久性入口 `memory-06-correction-durability.yaml` 指向支持真实重启的本包专用自动运行器，不把通用评测器未支持的生命周期操作伪装为已执行。
