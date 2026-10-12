# CI-1 failure survey

Cohort selected: 2026-10-12T07:46:55.474Z; history captured: 2026-10-12T09:01:44.627Z. 80 most recent ci.yml runs at cohort selection (including cancellations), with every run attempt retained. Read-only gh run list / view --attempt --log-failed; counts are distinct run/attempt pairs, not log duplicates. Successful reruns do not erase earlier failures.

Historical failures are observations, not proof of flakiness. Cancelled runs without a TAP failure are not counted as assertions. A >60-minute cancellation is a suspected hang only. Non-unit failing steps are listed separately. Logs are cached locally; public diagnostic excerpts are redacted.

| Check | Successful samples | Job median / p95 / max (s) | Required median / p95 / max (s) |
|---|---:|---|---|
| test (ubuntu-latest) | 60 | 833 / 871 / 925 | 723 / 761 / 764 |
| test (windows-latest) | 33 | 2463 / 2638 / 2804 | 2150 / 2349 / 2480 |

| Check | File | Failed test / step | Type | Attempts | Run ID / attempt |
|---|---|---|---|---:|---|
| test (windows-latest) | tests/bl-29-rework.test.ts | BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s | timeout | 5 | 38219055464/1, 38197888969/1, 38197888969/2, 38169300516/1, 38154299146/1 |
| test (windows-latest) | tests/bl-29-rework.test.ts | BL-29b M4/S1 real Electron and mobile synchronize settings and regain foreground under 200ms transport | timeout | 4 | 38211892427/1, 38207958670/1, 38169292412/1, 38163003827/1 |
| test (windows-latest) | workflow | cancelled after >60 minutes (suspected hang; not proven) | hang-suspected | 3 | 38172542464/1, 38138830162/1, 38137017047/1 |
| test (windows-latest) | tests/bl-29-account-changes.test.ts | BL-29c N1 an unrelated account commit cannot wake this account subscriber | assertion | 2 | 38198356416/1, 38162995493/1 |
| test (windows-latest) | tests/personal-desktop-motion.test.ts | desktop motion respects live reduced-motion changes, keyboard, immediate layout and long lists | assertion | 2 | 38207958670/1, 38197888969/1 |
| test (windows-latest) | tests/personal-tool-approvals.test.ts | 22000+ step-heavy history approves the exact current source using only its bounded turn range | assertion | 1 | 38207958670/1 |
| test (windows-latest) | tests/bl-29-wait.test.ts | BL-29 empty main chat wait wakes when another device starts its first task | assertion | 1 | 38211140036/1 |
| test (ubuntu-latest) | tests/bl-29-rework.test.ts | BL-29b M1 real Electron empty main keeps eight immediate errors within old changes budget | assertion | 1 | 38138830162/1 |
| test (windows-latest) | tests/bl-29-rework.test.ts | BL-29b M3/S2 native dispose removes listeners and wait reauthorization prevents logout leakage | assertion | 1 | 38186916036/1 |
| test (windows-latest) | tests/bl-29-rework.test.ts | BL-29b M4/S1 real Electron and mobile synchronize settings and regain foreground under 200ms transport | process-exit | 1 | 38147975598/1 |
| test (ubuntu-latest) | tests/bl-29-rework.test.ts | BL-29b M4/S1 real Electron and mobile synchronize settings and regain foreground under 200ms transport | timeout | 1 | 38138830162/1 |
| test (windows-latest) | tests/bl-29-rework.test.ts | BL-29b M5 host close revokes empty account waits before closing sockets | assertion | 1 | 38184048714/1 |
| test (windows-latest) | tests/bl-29-rework.test.ts | BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s | process-exit | 1 | 38147975598/1 |
| test (ubuntu-latest) | tests/bl-29-rework.test.ts | BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s | timeout | 1 | 38138830162/1 |
| test (ubuntu-latest) | tests/bl-29-account-changes.test.ts | BL-29c N1/N4 public model projection is scoped, domain keyed and covers account display name/revision | assertion | 1 | 38202675097/1 |
| test (windows-latest) | tests/bl-29-account-changes.test.ts | BL-29c N1/N4 public model projection is scoped, domain keyed and covers account display name/revision | assertion | 1 | 38198356416/1 |
| test (ubuntu-latest) | workflow | cancelled after >60 minutes (suspected hang; not proven) | hang-suspected | 1 | 38147975598/1 |
| test (windows-latest) | tests/rob-1-electron.test.ts | real Windows Electron survives first-run and legacy-upgrade interruption at every credential commit phase | process-exit | 1 | 38211892427/1 |
| test (windows-latest) | tests/rob-1-electron.test.ts | real Windows Electron survives first-run and legacy-upgrade interruption at every credential commit phase | assertion | 1 | 38136926541/1 |

Retrieval errors: 0. Full metadata, diagnostic examples and run URLs: flaky-table.json.
