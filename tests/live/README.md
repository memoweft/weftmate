# 手动授权的真实遗忘分类回归

`forget-chat-scope.test.mjs` 调用生产 `classifyForgetRequest` 与真实模型，以返回的授权结果校验同一组固定正反输入；不用提示词文本匹配或按预期值返回的替身证明分类能力。普通 CI 不运行此目录。先取得调用模型的费用授权，再从既有凭据管理方式向当前进程注入以下变量，密钥不要写进命令、文件或日志：

- `WEFTMATE_LIVE_FORGET_AUTHORIZED=1`
- `WEFTMATE_LIVE_MODEL_BASE_URL`、`WEFTMATE_LIVE_MODEL_ID`、`WEFTMATE_LIVE_MODEL_KEY`
- `WEFTMATE_EVIDENCE_DIR`：尚不存在的新输出目录，其父目录须已存在

然后运行：

```sh
node --test --test-concurrency=1 tests/live/forget-chat-scope.test.mjs
```

12个固定输入各执行一次生产分类；生产函数自身至多两次格式尝试，每题总时限120秒。输出保留完整合成输入、实际请求体/响应、源文件散列、通过或失败，不存请求头或密钥。保留失败证据；不同版本使用不同新目录，不用补跑成功覆盖原结果。

本修复在未改提示前已经用等价私有入口实测10/12（天文摄影自然说法和英文爵士乐请求先失败），改提示后同组12/12。这里将那个实际行为回归入口入仓以便复跑，不另外宣称一次12题证明稳定性。宿主约束测试 `personal-memory-forget-chat-scope.test.ts` 只验证完整输入与拒绝不得被提升为授权；真实分类通过也不代替完整 M7 删除、来源与原聊天验收。

入仓入口本身用 `personal-memory-forget-live-runner.test.ts` 的本机HTTP替身验证接线与输出：固定返回拒绝，必须暴露3个正例失败，不能按期望伪造通过；缺少授权或凭据必须明确NOT RUN。该测试不连接外部模型，不把替身结果计入真实分类对照。入仓后未额外运行收费验证，之前的真实对照归属其时的生产提示快照。
