# CI-3 六轮同提交全工作流验收

固定提交 9825b8bf3d1e624b698894755f0e0fc9c0050076；六轮间没有代码改动。全绿轮次：4，最长连续全绿 1 轮；目标未达到。重复驱动造成的取消不能算通过，额外运行见 duplicate-dispatches.json。驱动未自动重跑任何工作流。

六轮之后修复了前台投影测量起点、临时目录异步清理、云账号测试时钟，并合入M3-3。最终代码没有重新完成六轮；最新PR检查单独记录。

| 轮次 | 工作流 | 结论 | 工作流尝试 | 清单内重跑才过 |
|---|---|---|---:|---|
| 1 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38357032267) | success | 1 | 0 |
| 1 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38357042684) | success | 1 | 0 |
| 1 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38357052881) | success | 1 | 0 |
| 1 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38357062983) | success | 1 | 0 |
| 1 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38357073116) | failure | 1 | 0 |
| 1 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38357081920) | success | 1 | 0 |
| 1 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38357090876) | success | 1 | 0 |
| 2 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38359286867) | failure | 1 | 0 |
| 2 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38359321656) | success | 1 | 0 |
| 2 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38359360837) | success | 1 | 0 |
| 2 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38359395477) | success | 1 | 0 |
| 2 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38359403926) | cancelled | 1 | 0 |
| 2 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38359441150) | success | 1 | 0 |
| 2 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38359449121) | success | 1 | 0 |
| 3 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38361723315) | cancelled | 1 | 报告不完整（0/7） |
| 3 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38361734699) | cancelled | 1 | 0 |
| 3 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38361745006) | cancelled | 1 | 0 |
| 3 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38361755905) | cancelled | 1 | 0 |
| 3 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38361767646) | cancelled | 1 | 0 |
| 3 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38361777599) | success | 1 | 0 |
| 3 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38361788957) | cancelled | 1 | 0 |
| 4 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38361914655) | success | 1 | 0 |
| 4 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38361923644) | success | 1 | 0 |
| 4 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38361932054) | success | 1 | 0 |
| 4 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38361939899) | success | 1 | 0 |
| 4 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38362002019) | success | 1 | 0 |
| 4 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38362012728) | success | 1 | 0 |
| 4 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38362023068) | success | 1 | 0 |
| 5 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38364783767) | success | 1 | 0 |
| 5 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38364794338) | cancelled | 1 | 0 |
| 5 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38364806656) | success | 1 | 0 |
| 5 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38364816212) | success | 1 | 0 |
| 5 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38364826137) | cancelled | 1 | 0 |
| 5 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38364836412) | cancelled | 1 | 0 |
| 5 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38364846142) | cancelled | 1 | 0 |
| 6 | [ci.yml](https://github.com/memoweft/weftmate/actions/runs/38367509701) | failure | 1 | 报告不完整（6/7） |
| 6 | [review-gallery.yml](https://github.com/memoweft/weftmate/actions/runs/38367522245) | success | 1 | 0 |
| 6 | [windows-package.yml](https://github.com/memoweft/weftmate/actions/runs/38367591055) | success | 1 | 0 |
| 6 | [s1c-web.yml](https://github.com/memoweft/weftmate/actions/runs/38367604591) | success | 1 | 0 |
| 6 | [relay.yml](https://github.com/memoweft/weftmate/actions/runs/38367617625) | success | 1 | 0 |
| 6 | [host-certs.yml](https://github.com/memoweft/weftmate/actions/runs/38367628154) | success | 1 | 0 |
| 6 | [vendor-tests.yml](https://github.com/memoweft/weftmate/actions/runs/38367641530) | success | 1 | 0 |

| 轮次 | 工作流 | 检查 | 结论 | 秒 |
|---|---|---|---|---:|
| 1 | ci.yml | test (windows-latest, shard 2/3) | success | 1269 |
| 1 | ci.yml | test (windows-latest, shard 3/3) | success | 1255 |
| 1 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 238 |
| 1 | ci.yml | test (windows-latest, shard 1/3) | success | 1237 |
| 1 | ci.yml | Observed bridge (real MemoWeft Core) | success | 68 |
| 1 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 591 |
| 1 | ci.yml | test (macos-latest, shard 1/1) | success | 697 |
| 1 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 385 |
| 1 | ci.yml | Required unit tests (summary) | success | 41 |
| 1 | review-gallery.yml | Synthetic multi-device review gallery | success | 348 |
| 1 | windows-package.yml | Windows package and startup smoke | success | 507 |
| 1 | s1c-web.yml | Web cloud login interactions | success | 209 |
| 1 | s1c-web.yml | Android debug and JVM tests | success | 122 |
| 1 | relay.yml | Relay full chain (443) | success | 75 |
| 1 | relay.yml | Relay phone first input and file task | failure | 182 |
| 1 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 65 |
| 1 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 402 |
| 2 | ci.yml | Observed bridge (real MemoWeft Core) | success | 76 |
| 2 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 325 |
| 2 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 495 |
| 2 | ci.yml | test (windows-latest, shard 3/3) | success | 1231 |
| 2 | ci.yml | test (macos-latest, shard 1/1) | failure | 907 |
| 2 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 247 |
| 2 | ci.yml | test (windows-latest, shard 1/3) | success | 959 |
| 2 | ci.yml | test (windows-latest, shard 2/3) | success | 1110 |
| 2 | ci.yml | Required unit tests (summary) | failure | 55 |
| 2 | review-gallery.yml | Synthetic multi-device review gallery | success | 392 |
| 2 | windows-package.yml | Windows package and startup smoke | success | 644 |
| 2 | s1c-web.yml | Web cloud login interactions | success | 136 |
| 2 | s1c-web.yml | Android debug and JVM tests | success | 112 |
| 2 | relay.yml | Relay phone first input and file task | cancelled | 20 |
| 2 | relay.yml | Relay full chain (443) | cancelled | 19 |
| 2 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 63 |
| 2 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 418 |
| 3 | ci.yml | Observed bridge (real MemoWeft Core) | cancelled | 64 |
| 3 | ci.yml | test (ubuntu-latest, shard 2/3) | cancelled | 90 |
| 3 | ci.yml | test (macos-latest, shard 1/1) | cancelled | 61 |
| 3 | ci.yml | test (windows-latest, shard 3/3) | cancelled | 69 |
| 3 | ci.yml | test (ubuntu-latest, shard 1/3) | cancelled | 78 |
| 3 | ci.yml | test (ubuntu-latest, shard 3/3) | cancelled | 77 |
| 3 | ci.yml | test (windows-latest, shard 2/3) | cancelled | 71 |
| 3 | ci.yml | test (windows-latest, shard 1/3) | cancelled | 68 |
| 3 | ci.yml | Required unit tests (summary) | failure | 39 |
| 3 | review-gallery.yml | Synthetic multi-device review gallery | cancelled | 113 |
| 3 | windows-package.yml | Windows package and startup smoke | cancelled | 108 |
| 3 | s1c-web.yml | Web cloud login interactions | cancelled | 120 |
| 3 | s1c-web.yml | Android debug and JVM tests | cancelled | 116 |
| 3 | relay.yml | Relay phone first input and file task | cancelled | 148 |
| 3 | relay.yml | Relay full chain (443) | success | 74 |
| 3 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 56 |
| 3 | vendor-tests.yml | Pinned DSH vendor unit tests | cancelled | 155 |
| 4 | ci.yml | Observed bridge (real MemoWeft Core) | success | 76 |
| 4 | ci.yml | test (windows-latest, shard 2/3) | success | 1211 |
| 4 | ci.yml | test (windows-latest, shard 1/3) | success | 971 |
| 4 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 564 |
| 4 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 348 |
| 4 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 189 |
| 4 | ci.yml | test (macos-latest, shard 1/1) | success | 842 |
| 4 | ci.yml | test (windows-latest, shard 3/3) | success | 1434 |
| 4 | ci.yml | Required unit tests (summary) | success | 38 |
| 4 | review-gallery.yml | Synthetic multi-device review gallery | success | 386 |
| 4 | windows-package.yml | Windows package and startup smoke | success | 649 |
| 4 | s1c-web.yml | Android debug and JVM tests | success | 104 |
| 4 | s1c-web.yml | Web cloud login interactions | success | 148 |
| 4 | relay.yml | Relay phone first input and file task | success | 166 |
| 4 | relay.yml | Relay full chain (443) | success | 81 |
| 4 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 62 |
| 4 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 353 |
| 5 | ci.yml | Observed bridge (real MemoWeft Core) | success | 56 |
| 5 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 592 |
| 5 | ci.yml | test (windows-latest, shard 1/3) | success | 1230 |
| 5 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 349 |
| 5 | ci.yml | test (macos-latest, shard 1/1) | success | 1000 |
| 5 | ci.yml | test (windows-latest, shard 2/3) | success | 1286 |
| 5 | ci.yml | test (windows-latest, shard 3/3) | success | 1154 |
| 5 | ci.yml | test (ubuntu-latest, shard 1/3) | success | 237 |
| 5 | ci.yml | Required unit tests (summary) | success | 73 |
| 5 | review-gallery.yml | Synthetic multi-device review gallery | cancelled | 0 |
| 5 | windows-package.yml | Windows package and startup smoke | success | 318 |
| 5 | s1c-web.yml | Web cloud login interactions | success | 163 |
| 5 | s1c-web.yml | Android debug and JVM tests | success | 118 |
| 5 | relay.yml | Relay full chain (443) | cancelled | 1 |
| 5 | relay.yml | Relay phone first input and file task | cancelled | 1 |
| 5 | host-certs.yml | Host certificates (Pebble DNS-01) | cancelled | 0 |
| 6 | ci.yml | Observed bridge (real MemoWeft Core) | success | 70 |
| 6 | ci.yml | test (ubuntu-latest, shard 2/3) | success | 594 |
| 6 | ci.yml | test (windows-latest, shard 2/3) | success | 1275 |
| 6 | ci.yml | test (windows-latest, shard 1/3) | success | 1253 |
| 6 | ci.yml | test (ubuntu-latest, shard 1/3) | failure | 76 |
| 6 | ci.yml | test (macos-latest, shard 1/1) | success | 927 |
| 6 | ci.yml | test (ubuntu-latest, shard 3/3) | success | 330 |
| 6 | ci.yml | test (windows-latest, shard 3/3) | failure | 1158 |
| 6 | ci.yml | Required unit tests (summary) | failure | 42 |
| 6 | review-gallery.yml | Synthetic multi-device review gallery | success | 382 |
| 6 | windows-package.yml | Windows package and startup smoke | success | 384 |
| 6 | s1c-web.yml | Android debug and JVM tests | success | 119 |
| 6 | s1c-web.yml | Web cloud login interactions | success | 146 |
| 6 | relay.yml | Relay phone first input and file task | success | 199 |
| 6 | relay.yml | Relay full chain (443) | success | 82 |
| 6 | host-certs.yml | Host certificates (Pebble DNS-01) | success | 49 |
| 6 | vendor-tests.yml | Pinned DSH vendor unit tests | success | 424 |

