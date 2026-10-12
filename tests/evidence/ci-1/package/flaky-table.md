# CI-1 failure survey

Snapshot: 2026-10-12T07:50:51.995Z; 80 most recent windows-package.yml runs (including cancellations and in-progress runs). Read-only gh run list / view --log-failed; counts are distinct runs, not log duplicates.

Historical failures are observations, not proof of flakiness. Cancelled runs without a TAP failure are not counted as assertions. A >60-minute cancellation is a suspected hang only. Non-unit failing steps are listed separately. Logs are cached locally; public diagnostic excerpts are redacted.

| Check | Successful samples | Job median / p95 / max (s) | Required median / p95 / max (s) |
|---|---:|---|---|
| Windows package and startup smoke | 61 | 440 / 656 / 830 | null / null / null |

| Check | File | Failed test / step | Type | Runs | Run IDs |
|---|---|---|---|---:|---|
| Windows package and startup smoke | workflow | Build, inspect package contents and start real application | step-failure | 2 | 38211140040, 38183876238 |

Retrieval errors: 0. Full metadata, diagnostic examples and run URLs: flaky-table.json.
