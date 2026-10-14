# CI-4 三轮同提交全工作流验收

分支 wp/ci-4-recurring-reds；固定提交 a6942c49b6cf5e1edb4d3da65ec533dc129e73f0。轮与轮之间不改代码；自动工作流重跑 0。所有历史尝试和清单内恢复保留。

| 轮次 | 工作流 | 结论 | workflow attempt（工作流尝试） | 清单内重跑才过 |
|---|---|---|---:|---|
| 1 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38484221085) | success | 1 | 0 |
| 1 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38484229705) | success | 1 | 0 |
| 1 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38484239397) | success | 1 | 0 |
| 1 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38484250768) | success | 1 | 0 |
| 1 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38484259888) | success | 1 | 0 |
| 1 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38484268909) | success | 1 | 0 |
| 1 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38484276576) | success | 1 | 0 |
| 2 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38487171539) | success | 1 | 0 |
| 2 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38487178679) | failure | 1 | 0 |
| 2 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38487186182) | success | 1 | 0 |
| 2 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38487192909) | success | 1 | 0 |
| 2 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38487200107) | success | 1 | 0 |
| 2 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38487206298) | success | 1 | 0 |
| 2 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38487213033) | success | 1 | 0 |
| 3 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38489361518) | failure | 1 | 0 |
| 3 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38489368745) | success | 1 | 0 |
| 3 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38489376714) | success | 1 | 0 |
| 3 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38489384776) | success | 1 | 0 |
| 3 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38489392821) | success | 1 | 0 |
| 3 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38489400832) | success | 1 | 0 |
| 3 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38489407959) | success | 1 | 0 |

| 轮次 | 工作流 | 检查 | 结论 | 秒 |
|---|---|---|---|---:|
| 1 | ci.yml | Observed bridge (real MemoWeft Core) | success | 70 |
| 1 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 272 |
| 1 | ci.yml | test (windows-latest, shard 2/3) | success | 1029 |
| 1 | ci.yml | test (macos-latest, shard 1/1) | success | 910 |
| 1 | ci.yml | test (windows-latest, shard 1/3) | success | 1023 |
| 1 | ci.yml | test (windows-latest, shard 3/3) | success | 1248 |
| 1 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 375 |
| 1 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 613 |
| 1 | ci.yml | Required unit tests (summary) | success | 49 |
| 1 | review-gallery.yml | Synthetic multi-device review gallery | success | 460 |
| 1 | windows-package.yml | Windows package and startup smoke | success | 320 |
| 1 | s1c-web.yml | Android debug and JVM tests | success | 126 |
| 1 | s1c-web.yml | Web cloud login interactions | success | 159 |
| 1 | relay.yml | Relay phone first input and file task | success | 197 |
| 1 | relay.yml | Relay full chain (443) | success | 98 |
| 1 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 212 |
| 1 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 294 |
| 2 | ci.yml | Observed bridge (real MemoWeft Core) | success | 90 |
| 2 | ci.yml | test (macos-latest, shard 1/1) | success | 892 |
| 2 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 360 |
| 2 | ci.yml | test (windows-latest, shard 2/3) | success | 943 |
| 2 | ci.yml | test (windows-latest, shard 1/3) | success | 1236 |
| 2 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 592 |
| 2 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 266 |
| 2 | ci.yml | test (windows-latest, shard 3/3) | success | 1092 |
| 2 | ci.yml | Required unit tests (summary) | success | 46 |
| 2 | review-gallery.yml | Synthetic multi-device review gallery | failure | 431 |
| 2 | windows-package.yml | Windows package and startup smoke | success | 319 |
| 2 | s1c-web.yml | Android debug and JVM tests | success | 159 |
| 2 | s1c-web.yml | Web cloud login interactions | success | 149 |
| 2 | relay.yml | Relay phone first input and file task | success | 202 |
| 2 | relay.yml | Relay full chain (443) | success | 83 |
| 2 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 57 |
| 2 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 262 |
| 3 | ci.yml | Observed bridge (real MemoWeft Core) | success | 79 |
| 3 | ci.yml | test (windows-latest, shard 2/3) | success | 1329 |
| 3 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 518 |
| 3 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 255 |
| 3 | ci.yml | test (macos-latest, shard 1/1) | failure | 1120 |
| 3 | ci.yml | test (windows-latest, shard 1/3) | success | 989 |
| 3 | ci.yml | test (windows-latest, shard 3/3) | success | 1343 |
| 3 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 412 |
| 3 | ci.yml | Required unit tests (summary) | failure | 46 |
| 3 | review-gallery.yml | Synthetic multi-device review gallery | success | 407 |
| 3 | windows-package.yml | Windows package and startup smoke | success | 514 |
| 3 | s1c-web.yml | Android debug and JVM tests | success | 157 |
| 3 | s1c-web.yml | Web cloud login interactions | success | 157 |
| 3 | relay.yml | Relay phone first input and file task | success | 175 |
| 3 | relay.yml | Relay full chain (443) | success | 94 |
| 3 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 72 |
| 3 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 257 |
