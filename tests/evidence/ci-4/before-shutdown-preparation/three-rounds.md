# CI-4 新增关闭用例前的两轮验收

分支 wp/ci-4-recurring-reds；固定提交 0e25c421bbf8e1636449984a9b123c8726ef1c7e。轮与轮之间不改代码；自动工作流重跑 0。所有历史尝试和清单内恢复保留。

| 轮次 | 工作流 | 结论 | workflow attempt（工作流尝试） | 清单内重跑才过 |
|---|---|---|---:|---|
| 1 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38492254168) | success | 1 | 0 |
| 1 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38492260558) | success | 1 | 0 |
| 1 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38492267616) | success | 1 | 0 |
| 1 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38492274230) | success | 1 | 0 |
| 1 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38492281237) | success | 1 | 0 |
| 1 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38492288556) | success | 1 | 0 |
| 1 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38492295679) | success | 1 | 0 |
| 2 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38494406720) | success | 1 | 0 |
| 2 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38494413465) | success | 1 | 0 |
| 2 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38494420195) | success | 1 | 0 |
| 2 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38494427082) | success | 1 | 0 |
| 2 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38494433904) | success | 1 | 0 |
| 2 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38494440422) | success | 1 | 0 |
| 2 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38494446321) | success | 1 | 0 |

| 轮次 | 工作流 | 检查 | 结论 | 秒 |
|---|---|---|---|---:|
| 1 | ci.yml | Observed bridge (real MemoWeft Core) | success | 76 |
| 1 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 301 |
| 1 | ci.yml | test (macos-latest, shard 1/1) | success | 889 |
| 1 | ci.yml | test (windows-latest, shard 1/3) | success | 1189 |
| 1 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 255 |
| 1 | ci.yml | test (windows-latest, shard 3/3) | success | 1267 |
| 1 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 606 |
| 1 | ci.yml | test (windows-latest, shard 2/3) | success | 1008 |
| 1 | ci.yml | Required unit tests (summary) | success | 59 |
| 1 | review-gallery.yml | Synthetic multi-device review gallery | success | 381 |
| 1 | windows-package.yml | Windows package and startup smoke | success | 553 |
| 1 | s1c-web.yml | Web cloud login interactions | success | 152 |
| 1 | s1c-web.yml | Android debug and JVM tests | success | 165 |
| 1 | relay.yml | Relay phone first input and file task | success | 230 |
| 1 | relay.yml | Relay full chain (443) | success | 86 |
| 1 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 70 |
| 1 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 287 |
| 2 | ci.yml | Observed bridge (real MemoWeft Core) | success | 80 |
| 2 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 249 |
| 2 | ci.yml | test (windows-latest, shard 3/3) | success | 1263 |
| 2 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 328 |
| 2 | ci.yml | test (macos-latest, shard 1/1) | success | 928 |
| 2 | ci.yml | test (windows-latest, shard 2/3) | success | 1337 |
| 2 | ci.yml | test (windows-latest, shard 1/3) | success | 1272 |
| 2 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 634 |
| 2 | ci.yml | Required unit tests (summary) | success | 52 |
| 2 | review-gallery.yml | Synthetic multi-device review gallery | success | 280 |
| 2 | windows-package.yml | Windows package and startup smoke | success | 453 |
| 2 | s1c-web.yml | Android debug and JVM tests | success | 119 |
| 2 | s1c-web.yml | Web cloud login interactions | success | 152 |
| 2 | relay.yml | Relay full chain (443) | success | 92 |
| 2 | relay.yml | Relay phone first input and file task | success | 193 |
| 2 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 62 |
| 2 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 281 |
