#!/usr/bin/env python3
"""APPLE-1-WINDOW Mac checks: bounded processes, isolated identity, one headless UI batch."""
import argparse
import json
from pathlib import Path
import platform
import subprocess
import tempfile
import time

from bounded_process import run_bounded

ROOT = Path(__file__).resolve().parents[1]
REPORTS = Path.home() / "Library/Logs/DiagnosticReports"


def diagnostics():
    try:
        return {p.name for p in REPORTS.iterdir()}
    except OSError:
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--phase", choices=["core", "state", "mac", "ui", "all"], default="core")
    parser.add_argument("--phone-id", help="Actual UUID of an available simulator named apple-1-window-*. Required for ui/all.")
    args = parser.parse_args()
    if platform.system() != "Darwin":
        parser.error("Run on Mac; Windows can run the project generator and Python checks.")
    if args.phase in ["ui", "all"]:
        if not args.phone_id:
            parser.error("ui/all requires --phone-id; create a simulator in the apple-1-window namespace first.")
        inventory = json.loads(run_bounded(["xcrun", "simctl", "list", "devices", "available", "--json"], stdout=subprocess.PIPE, text=True, timeout=60, check=True).stdout)
        devices = [row for rows in inventory["devices"].values() for row in rows]
        if not any(row["udid"] == args.phone_id and row["name"].startswith("apple-1-window-") for row in devices):
            parser.error("--phone-id must belong to this package's available simulator namespace.")
    args.artifacts.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="apple-1-window-", dir=args.artifacts.resolve()))
    before = diagnostics()
    results = []

    def record(name, command):
        start = time.monotonic()
        print(f"Running {name}; log: {run / (name + '.log')}", flush=True)
        try:
            with (run / (name + ".log")).open("w") as log:
                result = run_bounded(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
            row = dict(check=name, exit=result.returncode)
        except subprocess.TimeoutExpired:
            row = dict(check=name, exit=124, timedOut=True)
        row.update(seconds=round(time.monotonic()-start, 2), command=command)
        results.append(row)
        (run / "results.json").write_text(json.dumps(results, indent=2)+"\n")
        print(f"{'PASS' if row['exit'] == 0 else 'FAIL'} {name}", flush=True)
        return row["exit"] == 0

    core = str(run / "CoreBuild")
    if args.phase in ["core", "all"]:
        record("core", ["swift", "test", "--package-path", str(ROOT / "Packages/WeftMateCore"), "--scratch-path", core, "--jobs", "2"])
    if args.phase in ["state", "all"]:
        for check in ["PhoneWindowModelChecks", "PhoneStandaloneModelChecks", "PhoneReminderModelChecks", "PhoneAttachmentModelChecks", "PhoneModelServicesModelChecks"]:
            record(check, ["python3", str(ROOT / "Scripts/run_state_checks.py"), "--artifacts", str(run / "State"), "--core-build", core, "--check", check])
    common = ["xcodebuild", "-project", str(ROOT / "WeftMate.xcodeproj"), "-configuration", "WindowTest", "-derivedDataPath", str(run / "DerivedData"), "-jobs", "4", "-parallel-testing-enabled", "NO", "-maximum-concurrent-test-simulator-destinations", "1", "CODE_SIGNING_ALLOWED=NO"]
    if args.phase in ["mac", "all"]:
        record("mac-build", common + ["-scheme", "WeftMateMacWindowTest", "-destination", "platform=macOS", "build"])
    if args.phase in ["ui", "all"] and not any(row["exit"] != 0 for row in results):
        try:
            record("phone-ui", common + ["-scheme", "WeftMatePhoneWindowTest", "-destination", "platform=iOS Simulator,id="+args.phone_id,
                "-only-testing:WeftMatePhoneUITests/PhoneWindowUITests/testMemoryRoutes", "-resultBundlePath", str(run / "PhoneWindow.xcresult"), "test"])
        finally:
            record("simulator-shutdown", ["xcrun", "simctl", "shutdown", "all"])
            print("UI batch ended; cooling down for 3 minutes.", flush=True)
            time.sleep(180)
    after = diagnostics()
    new = sorted(after-before) if after is not None and before is not None else None
    gpu = [name for name in new or [] if "gpurestart" in name.lower()]
    crashes = [name for name in new or [] if name.startswith("WeftMate")]
    (run / "diagnostics.json").write_text(json.dumps(dict(newReports=new, newGPUReports=gpu if new is not None else None, newAppReports=crashes if new is not None else None), indent=2)+"\n")
    if gpu:
        print("New gpuRestart report; cooling down for 10 minutes.", flush=True)
        time.sleep(600)
    print(f"Evidence: {run}; new app reports: {crashes if new is not None else 'unavailable'}", flush=True)
    return int(any(row["exit"] != 0 for row in results) or bool(crashes) or bool(gpu))


if __name__ == "__main__":
    raise SystemExit(main())
