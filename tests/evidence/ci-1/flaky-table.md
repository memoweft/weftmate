# CI-1 failure survey

Snapshot: 2026-10-12T07:48:59.029Z; 80 most recent ci.yml runs (including cancellations and in-progress runs). Read-only gh run list / view --log-failed; counts are distinct runs, not log duplicates.

Historical failures are observations, not proof of flakiness. Cancelled runs without a TAP failure are not counted as assertions. A >60-minute cancellation is a suspected hang only. Non-unit failing steps are listed separately. Logs are cached locally; public diagnostic excerpts are redacted.

| Check | Successful samples | Job median / p95 / max (s) | Required median / p95 / max (s) |
|---|---:|---|---|
| test (ubuntu-latest) | 51 | 829 / 871 / 925 | 722 / 761 / 764 |
| test (windows-latest) | 32 | 2467 / 2638 / 2804 | 2167 / 2349 / 2480 |

| Check | File | Failed test / step | Type | Runs | Run IDs |
|---|---|---|---|---:|---|
| test (windows-latest) | tests/bl-29-rework.test.ts | BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s | timeout | 3 | 38197888969, 38169300516, 38154299146 |
| test (windows-latest) | tests/bl-29-rework.test.ts | BL-29b M4/S1 real Electron and mobile synchronize settings and regain foreground under 200ms transport | timeout | 2 | 38207958670, 38169292412 |
| test (windows-latest) | workflow | cancelled after >60 minutes (suspected hang; not proven) | hang-suspected | 2 | 38138830162, 38137017047 |
| test (windows-latest) | tests/personal-tool-approvals.test.ts | 22000+ step-heavy history approves the exact current source using only its bounded turn range | assertion | 1 | 38207958670 |
| test (windows-latest) | tests/bl-29-wait.test.ts | BL-29 empty main chat wait wakes when another device starts its first task | assertion | 1 | 38211140036 |
| test (ubuntu-latest) | tests/bl-29-rework.test.ts | BL-29b M1 real Electron empty main keeps eight immediate errors within old changes budget | assertion | 1 | 38138830162 |
| test (windows-latest) | tests/bl-29-rework.test.ts | BL-29b M4/S1 real Electron and mobile synchronize settings and regain foreground under 200ms transport | assertion | 1 | 38147975598 |
| test (ubuntu-latest) | tests/bl-29-rework.test.ts | BL-29b M4/S1 real Electron and mobile synchronize settings and regain foreground under 200ms transport | assertion | 1 | 38138830162 |
| test (windows-latest) | tests/bl-29-rework.test.ts | BL-29b M5 host close revokes empty account waits before closing sockets | assertion | 1 | 38184048714 |
| test (windows-latest) | tests/bl-29-rework.test.ts | BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s | assertion | 1 | 38147975598 |
| test (ubuntu-latest) | tests/bl-29-rework.test.ts | BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s | timeout | 1 | 38138830162 |
| test (windows-latest) | tests/bl-29-account-changes.test.ts | BL-29c N1 an unrelated account commit cannot wake this account subscriber | assertion | 1 | 38162995493 |
| test (ubuntu-latest) | tests/bl-29-account-changes.test.ts | BL-29c N1/N4 public model projection is scoped, domain keyed and covers account display name/revision | assertion | 1 | 38202675097 |
| test (ubuntu-latest) | workflow | cancelled after >60 minutes (suspected hang; not proven) | hang-suspected | 1 | 38147975598 |
| test (windows-latest) | tests/personal-desktop-motion.test.ts | desktop motion respects live reduced-motion changes, keyboard, immediate layout and long lists | assertion | 1 | 38207958670 |

Retrieval errors: 0. Full metadata, diagnostic examples and run URLs: flaky-table.json.
