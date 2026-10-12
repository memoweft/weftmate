# CI-1 unchanged-code acceptance runs

Six complete workflow_dispatch CI runs on one immutable branch SHA/code tree, including the existing on-demand macOS Node gate. Job seconds include setup/cleanup. Windows span is first Windows job start to last completion, including any staggered runner availability. Max-job seconds is the longest individual Windows shard. No per-file counts are double-counted on retry; attempts remain in the JSON.

| Round | SHA | Overall | Windows 1/2/3 (s) | Windows max / span (s) | Retry recoveries |
|---|---|---|---|---|---|
| [round-1](https://github.com/memoweft/weftmate/actions/runs/38240068237) | 0ed27850 | success | 1189 / 1114 / 1187 | 1189 / 1191 | 0 |
| [round-2](https://github.com/memoweft/weftmate/actions/runs/38242324905) | 0ed27850 | success | 1135 / 1082 / 1142 | 1142 / 1142 | 0 |
| [round-3](https://github.com/memoweft/weftmate/actions/runs/38244530406) | 0ed27850 | success | 1125 / 1075 / 1224 | 1224 / 1224 | macos-latest: BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s<br>windows-latest: BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s |
| [round-4](https://github.com/memoweft/weftmate/actions/runs/38246865321) | 0ed27850 | success | 1108 / 1109 / 1019 | 1109 / 1109 | 0 |
| [round-5](https://github.com/memoweft/weftmate/actions/runs/38248916985) | 0ed27850 | success | 1173 / 1113 / 864 | 1173 / 1173 | 0 |
| [round-6](https://github.com/memoweft/weftmate/actions/runs/38251122859) | 0ed27850 | failure | 1469 / 903 / 1157 | 1469 / 1469 | 0 |

| Round | Check | Conclusion | Passed / failed / skipped |
|---|---|---|---|
| round-1 | Observed bridge (real MemoWeft Core) | success | — |
| round-1 | test (macos-latest, shard 1/1) | success | 1722 / 0 / 54 |
| round-1 | test (windows-latest, shard 1/3) | success | 599 / 0 / 14 |
| round-1 | test (ubuntu-latest, shard 1/3) | success | 594 / 0 / 19 |
| round-1 | test (ubuntu-latest, shard 3/3) | success | 637 / 0 / 17 |
| round-1 | test (windows-latest, shard 3/3) | success | 647 / 0 / 8 |
| round-1 | test (windows-latest, shard 2/3) | success | 501 / 0 / 8 |
| round-1 | test (ubuntu-latest, shard 2/3) | success | 490 / 0 / 18 |
| round-1 | Required unit tests (summary) | success | — |
| round-2 | Observed bridge (real MemoWeft Core) | success | — |
| round-2 | test (windows-latest, shard 2/3) | success | 501 / 0 / 8 |
| round-2 | test (macos-latest, shard 1/1) | success | 1722 / 0 / 54 |
| round-2 | test (ubuntu-latest, shard 1/3) | success | 594 / 0 / 19 |
| round-2 | test (ubuntu-latest, shard 2/3) | success | 490 / 0 / 18 |
| round-2 | test (windows-latest, shard 1/3) | success | 599 / 0 / 14 |
| round-2 | test (ubuntu-latest, shard 3/3) | success | 637 / 0 / 17 |
| round-2 | test (windows-latest, shard 3/3) | success | 647 / 0 / 8 |
| round-2 | Required unit tests (summary) | success | — |
| round-3 | Observed bridge (real MemoWeft Core) | success | — |
| round-3 | test (ubuntu-latest, shard 3/3) | success | 637 / 0 / 17 |
| round-3 | test (ubuntu-latest, shard 2/3) | success | 490 / 0 / 18 |
| round-3 | test (windows-latest, shard 1/3) | success | 599 / 0 / 14 |
| round-3 | test (macos-latest, shard 1/1) | success | 1722 / 0 / 54 |
| round-3 | test (ubuntu-latest, shard 1/3) | success | 594 / 0 / 19 |
| round-3 | test (windows-latest, shard 3/3) | success | 647 / 0 / 8 |
| round-3 | test (windows-latest, shard 2/3) | success | 501 / 0 / 8 |
| round-3 | Required unit tests (summary) | success | — |
| round-4 | Observed bridge (real MemoWeft Core) | success | — |
| round-4 | test (windows-latest, shard 2/3) | success | 501 / 0 / 8 |
| round-4 | test (macos-latest, shard 1/1) | success | 1722 / 0 / 54 |
| round-4 | test (ubuntu-latest, shard 1/3) | success | 594 / 0 / 19 |
| round-4 | test (windows-latest, shard 3/3) | success | 647 / 0 / 8 |
| round-4 | test (ubuntu-latest, shard 2/3) | success | 490 / 0 / 18 |
| round-4 | test (ubuntu-latest, shard 3/3) | success | 637 / 0 / 17 |
| round-4 | test (windows-latest, shard 1/3) | success | 599 / 0 / 14 |
| round-4 | Required unit tests (summary) | success | — |
| round-5 | test (windows-latest, shard 2/3) | success | 501 / 0 / 8 |
| round-5 | Observed bridge (real MemoWeft Core) | success | — |
| round-5 | test (windows-latest, shard 1/3) | success | 599 / 0 / 14 |
| round-5 | test (ubuntu-latest, shard 3/3) | success | 637 / 0 / 17 |
| round-5 | test (macos-latest, shard 1/1) | success | 1722 / 0 / 54 |
| round-5 | test (ubuntu-latest, shard 1/3) | success | 594 / 0 / 19 |
| round-5 | test (windows-latest, shard 3/3) | success | 647 / 0 / 8 |
| round-5 | test (ubuntu-latest, shard 2/3) | success | 490 / 0 / 18 |
| round-5 | Required unit tests (summary) | success | — |
| round-6 | Observed bridge (real MemoWeft Core) | success | — |
| round-6 | test (windows-latest, shard 1/3) | failure | 584 / 1 / 14 |
| round-6 | test (windows-latest, shard 3/3) | success | 647 / 0 / 8 |
| round-6 | test (windows-latest, shard 2/3) | success | 501 / 0 / 8 |
| round-6 | test (macos-latest, shard 1/1) | failure | 1721 / 1 / 54 |
| round-6 | test (ubuntu-latest, shard 3/3) | success | 637 / 0 / 17 |
| round-6 | test (ubuntu-latest, shard 2/3) | success | 490 / 0 / 18 |
| round-6 | test (ubuntu-latest, shard 1/3) | success | 594 / 0 / 19 |
| round-6 | Required unit tests (summary) | failure | — |
