# CI-3 六轮同提交全工作流验收

分支 wp/ci-3-steady-checks；固定提交 49ecbf56c909060a9624fdff66b4343441842fac。轮与轮之间不改代码；自动工作流重跑 0。所有历史尝试和清单内恢复保留。

| 轮次 | 工作流 | 结论 | workflow attempt（工作流尝试） | 清单内重跑才过 |
|---|---|---|---:|---|
| 1 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38349796851) | success | 1 | 0 |
| 1 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38349804102) | success | 1 | 0 |
| 1 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38349811158) | success | 1 | 0 |
| 1 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38349862017) | success | 1 | 0 |
| 1 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38349868984) | success | 1 | 0 |
| 1 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38349918217) | success | 1 | 0 |
| 1 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38349924822) | success | 1 | 0 |
| 2 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38352404463) | success | 1 | 0 |
| 2 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38352411254) | success | 1 | 0 |
| 2 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38352418046) | success | 1 | 0 |
| 2 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38352424220) | success | 1 | 0 |
| 2 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38352476163) | success | 1 | 0 |
| 2 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38352527175) | success | 1 | 0 |
| 2 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38352581379) | success | 1 | 0 |

| 轮次 | 工作流 | 检查 | 结论 | 秒 |
|---|---|---|---|---:|
| 1 | ci.yml | Observed bridge (real MemoWeft Core) | success | 71 |
| 1 | ci.yml | test (windows-latest, shard 2/3) | success | 955 |
| 1 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 273 |
| 1 | ci.yml | test (windows-latest, shard 3/3) | success | 1113 |
| 1 | ci.yml | test (macos-latest, shard 1/1) | success | 916 |
| 1 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 590 |
| 1 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 234 |
| 1 | ci.yml | test (windows-latest, shard 1/3) | success | 1231 |
| 1 | ci.yml | Required unit tests (summary) | success | 40 |
| 1 | review-gallery.yml | Synthetic multi-device review gallery | success | 274 |
| 1 | windows-package.yml | Windows package and startup smoke | success | 502 |
| 1 | s1c-web.yml | Android debug and JVM tests | success | 119 |
| 1 | s1c-web.yml | Web cloud login interactions | success | 136 |
| 1 | relay.yml | Relay full chain (443) | success | 71 |
| 1 | relay.yml | Relay phone first input and file task | success | 202 |
| 1 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 64 |
| 1 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 419 |
| 2 | ci.yml | Observed bridge (real MemoWeft Core) | success | 66 |
| 2 | ci.yml | test (windows-latest, shard 1/3) | success | 1207 |
| 2 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 596 |
| 2 | ci.yml | test (macos-latest, shard 1/1) | success | 888 |
| 2 | ci.yml | test (windows-latest, shard 3/3) | success | 1203 |
| 2 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 268 |
| 2 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 244 |
| 2 | ci.yml | test (windows-latest, shard 2/3) | success | 1256 |
| 2 | ci.yml | Required unit tests (summary) | success | 41 |
| 2 | review-gallery.yml | Synthetic multi-device review gallery | success | 383 |
| 2 | windows-package.yml | Windows package and startup smoke | success | 527 |
| 2 | s1c-web.yml | Android debug and JVM tests | success | 117 |
| 2 | s1c-web.yml | Web cloud login interactions | success | 148 |
| 2 | relay.yml | Relay phone first input and file task | success | 180 |
| 2 | relay.yml | Relay full chain (443) | success | 100 |
| 2 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 49 |
| 2 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 397 |
