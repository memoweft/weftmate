# 最终六轮的额外观测

固定提交 `9825b8bf3d1e624b698894755f0e0fc9c0050076` 的六轮结论见 [完整表](cloud/six-rounds.md)。原先准备／同步控制器／项目冷初始化修复前的运行另存，不能混进此提交的六轮。

| 现象 | 分类 | 依据与处理 | 验收限制 |
|---|---|---|---|
| 中继手机审批位置断言 | 产品里的真问题，具体根因未唯一定位 | [38357073116](https://github.com/memoweft/weftmate/actions/runs/38357073116) 的 `phone approval must be inside the conversation above the composer`；`services/cloud/test/relay-phone.test.mjs` 的真实手机审批布局保护点。随后同提交第4轮和第6轮通过。属于 MOB-3／MOB-4 手机输入／审批／中继范围，本包保留断言和失败、不改选择器。 | 偶发仍存在，不能称本包已修复；不是纯计时，不进清单。 |
| macOS 手机健康空闲读取数 | 夹具竞态方向，根因尚缺分方法计数 | [38359286867](https://github.com/memoweft/weftmate/actions/runs/38359286867)，`tests/bl-29-rework.test.ts:116` 的 `all bridge methods count in 31s healthy idle`，实际81,926ms完成整段场景后断言失败。`probe-browser.mjs:44` 在重载／选会话后开始计数，只等 booted/loggedIn/mainChat，没有证明所有初始化读取已结束；现有尾部没有留下逐方法计数，不能据此断定产品额外请求或单一夹具根因。后续同提交第4、5轮该分片通过。 | 功能性请求数断言，不能登记墙钟例外；没有删除断言、重试或改预算。留待有完整计数的固定复现。 |
| 重复验收控制器、下载撞文件 | 夹具竞态 | 重开前同脚本曾同时有两个控制器；同提交21条额外触发运行和取消均见 [额外运行](cloud/duplicate-dispatches.json)，原下载报 `The file exists`。驱动新增原子独占租约，重入在 GitHub 调用前失败；每次报告下载使用独立目录。 | [独立临时目录固定证明](controller-duplicate-proof.json)通过。原先取消不算绿；前两轮7份报告分别重新获取，工作流未重跑。 |
| 本机原生退出／配置同步 | 夹具进程／同步方向，根因未唯一定位 | Node24.15.0 完整门禁曾有 `tests/fg-1-lifecycle-models.test.ts` 的 `0xC0000409` 文件退出、`tests/bl-29-rework.test.ts` 同码退出，另有同步配置7秒断言失败。单文件复验通过。最后完整门禁使用官方哈希核验过的 Node24.21.0，与云端版本一致；旧失败仍保留为遗留。 | 版本一致是验证条件，不能推断旧版本就是根因；无进程退出例外、无功能性重跑。最终本机结论见 local-verification.json。 |

第六轮各工作流仍按实际运行填表。取消轮的报告不可用时明确写“报告不可用”，不把恢复次数填写为已证明的0；已完成轮的全部历史尝试和清单内恢复分别记录。包内曾有一次约20秒重活名额重叠，已记录在 decisions.md，之后改为串行。
