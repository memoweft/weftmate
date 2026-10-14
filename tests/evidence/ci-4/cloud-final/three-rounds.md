# CI-4 三轮同提交全工作流验收

分支 wp/ci-4-recurring-reds；固定提交 4e99bfeab2f53067bed1fc079dd2d679a1464c18。轮与轮之间不改代码；自动工作流重跑 0。所有历史尝试和清单内恢复保留。

| 轮次 | 工作流 | 结论 | workflow attempt（工作流尝试） | 清单内重跑才过 |
|---|---|---|---:|---|
| 1 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38498118822) | success | 1 | 0 |
| 1 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38498126001) | success | 1 | 0 |
| 1 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38498133867) | success | 1 | 0 |
| 1 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38498140933) | success | 1 | 0 |
| 1 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38498148040) | success | 1 | 0 |
| 1 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38498154759) | success | 1 | 0 |
| 1 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38498162476) | success | 1 | 0 |
| 2 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38500642616) | success | 1 | 0 |
| 2 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38500650063) | success | 1 | 0 |
| 2 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38500657936) | success | 1 | 0 |
| 2 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38500666758) | success | 1 | 0 |
| 2 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38500674033) | success | 1 | 0 |
| 2 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38500680592) | success | 1 | 0 |
| 2 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38500687587) | success | 1 | 0 |
| 3 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38502731168) | failure | 1 | 0 |
| 3 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38502738561) | success | 1 | 0 |
| 3 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38502746152) | success | 1 | 0 |
| 3 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38502754070) | success | 1 | 0 |
| 3 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38502760964) | success | 1 | 0 |
| 3 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38502768277) | success | 1 | 0 |
| 3 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38502775016) | success | 1 | 0 |

| 轮次 | 工作流 | 检查 | 结论 | 秒 |
|---|---|---|---|---:|
| 1 | ci.yml | Observed bridge (real MemoWeft Core) | success | 82 |
| 1 | ci.yml | test (windows-latest, shard 1/3) | success | 1196 |
| 1 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 275 |
| 1 | ci.yml | test (macos-latest, shard 1/1) | success | 931 |
| 1 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 641 |
| 1 | ci.yml | test (windows-latest, shard 3/3) | success | 1145 |
| 1 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 408 |
| 1 | ci.yml | test (windows-latest, shard 2/3) | success | 1285 |
| 1 | ci.yml | Required unit tests (summary) | success | 50 |
| 1 | review-gallery.yml | Synthetic multi-device review gallery | success | 380 |
| 1 | windows-package.yml | Windows package and startup smoke | success | 552 |
| 1 | s1c-web.yml | Web cloud login interactions | success | 140 |
| 1 | s1c-web.yml | Android debug and JVM tests | success | 138 |
| 1 | relay.yml | Relay phone first input and file task | success | 195 |
| 1 | relay.yml | Relay full chain (443) | success | 92 |
| 1 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 75 |
| 1 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 266 |
| 2 | ci.yml | Observed bridge (real MemoWeft Core) | success | 73 |
| 2 | ci.yml | test (macos-latest, shard 1/1) | success | 873 |
| 2 | ci.yml | test (windows-latest, shard 2/3) | success | 1196 |
| 2 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 267 |
| 2 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 622 |
| 2 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 404 |
| 2 | ci.yml | test (windows-latest, shard 1/3) | success | 966 |
| 2 | ci.yml | test (windows-latest, shard 3/3) | success | 1320 |
| 2 | ci.yml | Required unit tests (summary) | success | 47 |
| 2 | review-gallery.yml | Synthetic multi-device review gallery | success | 436 |
| 2 | windows-package.yml | Windows package and startup smoke | success | 337 |
| 2 | s1c-web.yml | Android debug and JVM tests | success | 164 |
| 2 | s1c-web.yml | Web cloud login interactions | success | 132 |
| 2 | relay.yml | Relay full chain (443) | success | 89 |
| 2 | relay.yml | Relay phone first input and file task | success | 198 |
| 2 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 73 |
| 2 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 283 |
| 3 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 643 |
| 3 | ci.yml | test (windows-latest, shard 3/3) | success | 969 |
| 3 | ci.yml | test (windows-latest, shard 2/3) | success | 1347 |
| 3 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 351 |
| 3 | ci.yml | test (windows-latest, shard 1/3) | success | 1269 |
| 3 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 305 |
| 3 | ci.yml | Observed bridge (real MemoWeft Core) | success | 75 |
| 3 | ci.yml | test (macos-latest, shard 1/1) | failure | 978 |
| 3 | ci.yml | Required unit tests (summary) | failure | 48 |
| 3 | review-gallery.yml | Synthetic multi-device review gallery | success | 401 |
| 3 | windows-package.yml | Windows package and startup smoke | success | 461 |
| 3 | s1c-web.yml | Web cloud login interactions | success | 140 |
| 3 | s1c-web.yml | Android debug and JVM tests | success | 176 |
| 3 | relay.yml | Relay phone first input and file task | success | 167 |
| 3 | relay.yml | Relay full chain (443) | success | 94 |
| 3 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 55 |
| 3 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 272 |
