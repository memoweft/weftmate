# 本机阶段验证

| 分组 | 通过 | 失败 | 跳过 | 毫秒 |
|---|---:|---:|---:|---:|
| activity-resources-offline | 26 | 0 | 0 | 15304.4918 |
| questions-approvals-mobile-release | 38 | 0 | 0 | 52934.425 |
| multi-account-adoption-relay-storage | 22 | 0 | 0 | 36536.3816 |
| policy-ui-core-weekly | 83 | 0 | 0 | 5040.1891 |
| native-wait | 3 | 0 | 0 | 6032.5429 |
| real-electron-asar-vault | 4 | 0 | 0 | 493947.1074 |
| fixed-final | 10 | 0 | 0 | 5310.1592 |
| additional-lifecycle-cloud | 30 | 0 | 0 | 未记录 |

最终固定回归14/0，无vendor条件14/0，完整 required 1962/0/18，vendor 241/0/0；Node 24.21.0 与云端一致。类型检查通过、公开卫生0命中，真实凭据中断矩阵27格通过。分组包含重叠用例，不相加为独立通过数。

重活名额的全部开始／结束／退出码见 local-verification.json 的 slots。早期约20秒重复占用已记录，之后包内串行。旧Node24.15.0的两次原生退出和同步配置断言失败保留为未唯一定位的遗留，不登记计时例外。
