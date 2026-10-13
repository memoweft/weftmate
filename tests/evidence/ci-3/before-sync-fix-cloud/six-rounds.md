# CI-3 六轮同提交全工作流验收

分支 wp/ci-3-steady-checks；固定提交 c388db1c7f9956281841f68cf6310043e996ae26。轮与轮之间不改代码；自动工作流重跑 0。所有历史尝试和清单内恢复保留。

| 轮次 | 工作流 | 结论 | workflow attempt（工作流尝试） | 清单内重跑才过 |
|---|---|---|---:|---|
| 1 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38345175372) | failure | 1 | 0 |
| 1 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38345181553) | success | 1 | 0 |
| 1 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38345187594) | success | 1 | 0 |
| 1 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38345194616) | success | 1 | 0 |
| 1 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38345201851) | success | 1 | 0 |
| 1 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38345209643) | success | 1 | 0 |
| 1 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38345259755) | success | 1 | 0 |

| 轮次 | 工作流 | 检查 | 结论 | 秒 |
|---|---|---|---|---:|
| 1 | ci.yml | Observed bridge (real MemoWeft Core) | success | 68 |
| 1 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 311 |
| 1 | ci.yml | test (windows-latest, shard 1/3) | success | 1105 |
| 1 | ci.yml | test (macos-latest, shard 1/1) | failure | 1495 |
| 1 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 812 |
| 1 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 230 |
| 1 | ci.yml | test (windows-latest, shard 3/3) | success | 862 |
| 1 | ci.yml | test (windows-latest, shard 2/3) | success | 1183 |
| 1 | ci.yml | Required unit tests (summary) | failure | 46 |
| 1 | review-gallery.yml | Synthetic multi-device review gallery | success | 291 |
| 1 | windows-package.yml | Windows package and startup smoke | success | 561 |
| 1 | s1c-web.yml | Android debug and JVM tests | success | 110 |
| 1 | s1c-web.yml | Web cloud login interactions | success | 139 |
| 1 | relay.yml | Relay full chain (443) | success | 74 |
| 1 | relay.yml | Relay phone first input and file task | success | 170 |
| 1 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 58 |
| 1 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 366 |
