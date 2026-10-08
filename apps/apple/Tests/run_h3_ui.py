#!/usr/bin/env python3
"""Run H3 on one dedicated simulator; verify the real isolated H2 store and export synthetic screenshots.

Build WeftMatePhone for testing first. xctestrun/result bundles stay under ignored Build/.
The host uses an ephemeral private root, a synthetic account and no model/DSH runtime.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--xctestrun", type=Path, required=True)
parser.add_argument("--simulator", required=True)
parser.add_argument("--result", type=Path, required=True)
parser.add_argument("--evidence", type=Path, required=True)
args = parser.parse_args()

def run(*command):
    return subprocess.run(command, check=True, text=True, capture_output=True).stdout

host = subprocess.Popen(["node", str(ROOT / "apps/apple/Tests/h3-isolated-host.mjs")],
                        cwd=ROOT, stdout=subprocess.PIPE, text=True, env=os.environ | {"TMPDIR": "/private/tmp"})
try:
    metadata = json.loads(host.stdout.readline())
    config = plistlib.loads(args.xctestrun.read_bytes())
    def inject(value):
        if isinstance(value, dict):
            if "TestBundlePath" in value:
                value.setdefault("EnvironmentVariables", {})["WEFTMATE_H3_HOST"] = metadata["origin"]
            for child in value.values():
                inject(child)
        elif isinstance(value, list):
            for child in value:
                inject(child)
    inject(config)
    # Keep __TESTROOT__ references relative to the existing built products.
    with tempfile.NamedTemporaryFile(suffix=".xctestrun", dir=args.xctestrun.parent) as configured:
        configured.write(plistlib.dumps(config)); configured.flush()
        run("xcrun", "simctl", "boot", args.simulator)
        run("xcrun", "simctl", "bootstatus", args.simulator, "-b")
        result = subprocess.run(["xcodebuild", "test-without-building", "-xctestrun", configured.name,
            "-destination", "platform=iOS Simulator,id=" + args.simulator,
            "-only-testing:WeftMatePhoneUITests/WeftMateUITests/testH3HealthKitCalculationUploadAndHealthPage",
            "-parallel-testing-enabled", "NO", "-maximum-concurrent-test-simulator-destinations", "1",
            "-resultBundlePath", str(args.result)])
        # Shut down immediately after UI testing, before exporting or inspecting evidence.
        run("xcrun", "simctl", "shutdown", "all")
        result.check_returncode()
    tests = json.loads(run("xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(args.result)))
    assert tests["passedTests"] == 1 and tests["failedTests"] == 0 and tests["skippedTests"] == 0
    files = list(Path(metadata["root"]).rglob("daily-summaries.json"))
    assert len(files) == 1
    rows = json.loads(files[0].read_text())["summaries"]
    assert len(rows) == 30
    assert all(not row.get("delivery") for row in rows)
    for row in rows:
        summary = row["summary"]
        assert summary["derived"]["algorithmVersion"] == "weftmate-h3-v1"
        assert summary["cloudModelAllowed"] is False and row["evidence"]["permissions"]["allow_cloud_read"] is False
        assert not {"samples", "observations", "intervals"}.intersection(summary)
        assert len(json.dumps(summary).encode()) <= 12 * 1024
    latest = max(rows, key=lambda row: row["summary"]["date"])["summary"]
    assert all(latest["derived"].get(key) for key in ["recovery", "load", "sleep"])
    assert any(hour.get("stress") for hour in latest["hourly"])
    args.evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as exported:
        run("xcrun", "xcresulttool", "export", "attachments", "--path", str(args.result), "--output-path", exported)
        for test in json.loads((Path(exported) / "manifest.json").read_text()):
            for attachment in test["attachments"]:
                name = attachment["suggestedHumanReadableName"].split("_0_")[0] + ".png"
                shutil.copyfile(Path(exported) / attachment["exportedFileName"], args.evidence / name)
    (args.evidence / "validation.json").write_text(json.dumps({
        "uiPassed": 1, "uiFailed": 0, "uiSkipped": 0, "hostSummaryCount": len(rows),
        "allCloudDenied": True, "algorithmVersion": "weftmate-h3-v1",
        "maximumSummaryBytes": max(len(json.dumps(row["summary"]).encode()) for row in rows),
        "recovery": latest["derived"]["recovery"]["value"], "loadRatio": latest["derived"]["load"].get("ratio"),
        "sleepMinutes": latest["sleep"]["totalMinutes"], "coreDelivered": False,
    }, indent=2) + "\n")
finally:
    subprocess.run(["xcrun", "simctl", "shutdown", "all"], check=False, capture_output=True)
    host.terminate(); host.wait(timeout=20)
