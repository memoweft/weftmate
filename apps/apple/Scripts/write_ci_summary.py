#!/usr/bin/env python3
"""Publish raw Apple baseline results, independently of the CI gating policy."""

import argparse
import json
import os
from pathlib import Path


def state_report(artifacts, outcome):
    from run_state_checks import CHECKS

    rows = [row for path in artifacts.glob("state/**/results.json")
            for row in json.loads(path.read_text())]
    failures = [row["check"] for row in rows
                if row["compileExit"] != 0 or row.get("runExit") != 0]
    missing = sorted(set(CHECKS) - {row["check"] for row in rows})
    return dict(kind="state", group="state", outcome=outcome,
                passed=len(rows) - len(failures), failed=len(failures), skipped=0,
                failures=failures, blocked=missing, problems=[])


def ui_report(artifacts, group, outcome):
    report = dict(kind="ui", group=group, outcome=outcome,
                  passed=0, failed=0, skipped=0, failures=[], blocked=[], problems=[])
    batch_path = artifacts / "batches.json"
    rows = json.loads(batch_path.read_text()) if batch_path.exists() else []
    if not rows:
        report["problems"].append("No batch results: dependency/build/simulator/fixture preparation did not complete.")
    for row in rows:
        name = row["batch"]
        path = artifacts / (name + "-summary.json")
        if not path.exists():
            report["blocked"].extend(row.get("tests", [name]))
            report["problems"].append(f"{name}: no XCTest summary (raw exit {row['exitCode']}). See batch/fixture logs.")
            continue
        summary = json.loads(path.read_text())
        # Only the top-level totals count; per-device totals repeat these tests.
        for key in ("passed", "failed", "skipped"):
            report[key] += summary[key + "Tests"]
        report["failures"].extend(failure["testIdentifierString"] for failure in summary.get("testFailures", []))
        if row.get("timedOut"):
            report["problems"].append(f"{name}: timed out; counts are partial, remaining tests are unmeasured.")
        if row["exitCode"] and not summary["failedTests"]:
            report["problems"].append(f"{name}: raw exit {row['exitCode']} despite no recorded test failures.")
        if summary["totalTestCount"] != sum(summary[key + "Tests"] for key in ("passed", "failed", "skipped")):
            report["problems"].append(f"{name}: incomplete XCTest totals; inspect xcresult.")
    report["failures"] = sorted(set(report["failures"]))
    return report


def markdown(reports, missing=(), gates=None):
    lines = ["## Apple baseline", "",
             "**Blocking:** Swift package `swift test` and unsigned iOS/watchOS/macOS builds.",
             "**Report only:** 22 state checks and every iPhone UI group; existing failures tracked in #546–#550.",
             "A green workflow confirms the blocking checks passed, not that the reported tests passed.", ""]
    if gates:
        lines += [f"Blocking job results: Swift package **{gates[0]}**; three-platform builds **{gates[1]}**.", ""]
    lines += ["| Report | Raw step outcome | Passed | Failed | Skipped | No XCTest result / not run |",
              "|---|---|---:|---:|---:|---:|"]
    for report in reports:
        lines.append(f"| {report['group']} | {report['outcome']} | {report['passed']} | {report['failed']} | {report['skipped']} | {len(report['blocked'])} |")
    ui = [report for report in reports if report["kind"] == "ui"]
    if ui:
        totals = [sum(report[key] for report in ui) for key in ("passed", "failed", "skipped")]
        lines.append(f"| **iPhone UI total (received {len(ui)}/5 groups)** | report only | **{totals[0]}** | **{totals[1]}** | **{totals[2]}** | **{sum(len(report['blocked']) for report in ui)}** |")
    lines += ["", "Skipped counts come from XCTest; missing/preparation failures are separate and never count as passes or skips."]
    for group in missing:
        lines += ["", f"**Missing report: {group}. Results unknown; inspect its job, not a zero-failure result.**"]
    for report in reports:
        lines += ["", f"### {report['group']}: failing tests ({report['failed']})", ""]
        lines += [f"- `{name}`" for name in report["failures"]] or ["None recorded."]
        if report["blocked"]:
            lines += ["", "No XCTest result / not run:", ""] + [f"- `{name}`" for name in report["blocked"]]
        if report["problems"]:
            lines += ["", "Execution/report gaps:", ""] + [f"- {problem}" for problem in report["problems"]]
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["state", "ui", "aggregate"])
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--group")
    parser.add_argument("--outcome", default="unknown")
    args = parser.parse_args()
    if args.kind == "aggregate":
        reports = [json.loads(path.read_text()) for path in sorted(args.artifacts.glob("**/report.json"))]
        missing = sorted({"state", "local", "host-legacy", "host-modern", "cloud", "features"}
                         - {report["group"] for report in reports})
        summary = markdown(reports, missing, (os.environ["CORE_RESULT"], os.environ["BUILD_RESULT"]))
    else:
        report = (state_report(args.artifacts, args.outcome) if args.kind == "state" else
                  ui_report(args.artifacts, args.group, args.outcome))
        output = args.artifacts / "report.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        summary = markdown([report])
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as stream:
            stream.write(summary)


if __name__ == "__main__":
    main()
