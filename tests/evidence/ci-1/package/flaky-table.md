# CI-1 failure survey

Snapshot: 2026-10-12T08:09:45.771Z; 80 most recent windows-package.yml runs (including cancellations and in-progress runs). Read-only gh run list / view --log-failed; counts are distinct runs, not log duplicates.

Historical failures are observations, not proof of flakiness. Cancelled runs without a TAP failure are not counted as assertions. A >60-minute cancellation is a suspected hang only. Non-unit failing steps are listed separately. Logs are cached locally; public diagnostic excerpts are redacted.

| Check | Successful samples | Job median / p95 / max (s) | Required median / p95 / max (s) |
|---|---:|---|---|
| Windows package and startup smoke | 61 | 440 / 656 / 830 | null / null / null |

| Check | File | Failed test / step | Type | Runs | Run IDs |
|---|---|---|---|---:|---|
| Windows package and startup smoke | tests/helpers/migration-host.mjs | electronApplication.firstWindow: Timeout 30000ms exceeded while waiting for event "window" | timeout | 1 | 38211140040 |
| Windows package and startup smoke | scripts/nightly/installed-smoke.mjs | locator.waitFor: Timeout 15000ms exceeded. | timeout | 1 | 38183876238 |

Retrieval errors: 0. Full metadata, diagnostic examples and run URLs: flaky-table.json.
