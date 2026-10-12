# CI-1 failure survey

Cohort selected: 2026-10-12T07:49:58.159Z; history captured: 2026-10-12T08:57:53.214Z. 80 most recent windows-package.yml runs at cohort selection (including cancellations), with every run attempt retained. Read-only gh run list / view --attempt --log-failed; counts are distinct run/attempt pairs, not log duplicates. Successful reruns do not erase earlier failures.

Historical failures are observations, not proof of flakiness. Cancelled runs without a TAP failure are not counted as assertions. A >60-minute cancellation is a suspected hang only. Non-unit failing steps are listed separately. Logs are cached locally; public diagnostic excerpts are redacted.

| Check | Successful samples | Job median / p95 / max (s) | Required median / p95 / max (s) |
|---|---:|---|---|
| Windows package and startup smoke | 61 | 440 / 656 / 830 | null / null / null |

| Check | File | Failed test / step | Type | Attempts | Run ID / attempt |
|---|---|---|---|---:|---|
| Windows package and startup smoke | scripts/nightly/installed-smoke.mjs | locator.waitFor: Timeout 15000ms exceeded. | timeout | 3 | 38200980908/1, 38183876238/1, 38154299163/1 |
| Windows package and startup smoke | tests/helpers/migration-host.mjs | electronApplication.firstWindow: Timeout 30000ms exceeded while waiting for event "window" | timeout | 2 | 38211140040/1, 38174156740/1 |

Retrieval errors: 0. Full metadata, diagnostic examples and run URLs: flaky-table.json.
