#!/usr/bin/env python3
"""Run LG2 with one simulator, actual cloud main/file-mail, and a temporary isolated host."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--xctestrun", type=Path, required=True)
parser.add_argument("--simulator", required=True)
parser.add_argument("--result", type=Path, required=True)
parser.add_argument("--evidence", type=Path, required=True)
parser.add_argument("--phase", choices=["all", "account", "lifecycle"], default="all")
args = parser.parse_args()
if args.phase == "all":
    for phase in ["account", "lifecycle"]:
        command = [os.sys.executable, __file__, "--xctestrun", str(args.xctestrun), "--simulator", args.simulator,
                   "--result", str(args.result) + "." + phase + ".xcresult", "--evidence", str(args.evidence), "--phase", phase]
        subprocess.run(command, check=True)
    validation = {"uiPassed": 2, "uiFailed": 0, "uiSkipped": 0, "realCloudMain": True,
                  "fileMail": True, "isolatedHost": True, "freshCloudPerPhase": True, "simulatorsAtOnce": 1,
                  "steps": ["login error", "bundled terms", "registration", "device confirmation", "automatic login",
                            "computer directory", "QR pin", "pending approval", "desktop approval", "connection", "saved login",
                            "logout", "password recovery", "new password login", "rename", "remove", "logout others", "email change", "delete"]}
    (args.evidence / "validation.json").write_text(json.dumps(validation, indent=2) + "\n")
    raise SystemExit(0)
def run(*command):
    return subprocess.run(command, check=True, text=True, capture_output=True).stdout
fixture = subprocess.Popen(["node", "apps/apple/Tests/lg2_cloud_fixture.mjs"], cwd=ROOT,
    stdout=subprocess.PIPE, text=True, env=os.environ | {"TMPDIR": "/private/tmp"})
metadata = None
try:
    metadata = json.loads(fixture.stdout.readline())
    config = plistlib.loads(args.xctestrun.read_bytes())
    def inject(value):
        if isinstance(value, dict):
            if "TestBundlePath" in value:
                value.setdefault("EnvironmentVariables", {})["WEFTMATE_LG2_DRIVER"] = metadata["driver"]
            for child in value.values(): inject(child)
        elif isinstance(value, list):
            for child in value: inject(child)
    inject(config)
    with tempfile.NamedTemporaryFile(suffix=".xctestrun", dir=args.xctestrun.parent) as configured:
        configured.write(plistlib.dumps(config)); configured.flush()
        run("xcrun", "simctl", "shutdown", "all")
        run("xcrun", "simctl", "boot", args.simulator)
        run("xcrun", "simctl", "bootstatus", args.simulator, "-b")
        command = ["xcodebuild", "test-without-building", "-xctestrun", configured.name,
            "-destination", "platform=iOS Simulator,id=" + args.simulator, "-jobs", "2",
            "-only-testing:WeftMatePhoneUITests/LG2AccountUITests/" + ("testRealRegistrationApprovalConnectionRecoveryErrorAndLogout" if args.phase == "account" else "testRealAccountLifecycleOnFreshCloud"), "-parallel-testing-enabled", "NO",
            "-maximum-concurrent-test-simulator-destinations", "1", "-resultBundlePath", str(args.result)]
        test = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in test.stdout:
            # XCTest activity names otherwise include a prefix of typeText input, even secure fields.
            print(re.sub(r"Type '.*?' into", "Type <redacted> into", line), end="", flush=True)
        status = test.wait()
        run("xcrun", "simctl", "shutdown", "all")
        if status != 0: raise subprocess.CalledProcessError(status, command)
    summary = json.loads(run("xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(args.result)))
    assert summary["passedTests"] == 1 and summary["failedTests"] == 0 and summary["skippedTests"] == 0
    args.evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as exported:
        run("xcrun", "xcresulttool", "export", "attachments", "--path", str(args.result), "--output-path", exported)
        for test in json.loads((Path(exported) / "manifest.json").read_text()):
            for attachment in test["attachments"]:
                name = attachment["suggestedHumanReadableName"].split("_0_")[0]
                if name.startswith("ios-"):
                    shutil.copyfile(Path(exported) / attachment["exportedFileName"], args.evidence / (name + ".png"))
    (args.evidence / ("validation-" + args.phase + ".json")).write_text(json.dumps({"uiPassed": 1, "uiFailed": 0, "uiSkipped": 0,
        "realCloudMain": True, "fileMail": True, "isolatedHost": True, "simulatorsAtOnce": 1,
        "phase": args.phase,
        "steps": (["login error", "bundled terms", "registration", "device confirmation", "automatic login",
                   "computer directory", "QR pin", "pending approval", "desktop approval", "connection", "saved login",
                   "logout", "password recovery", "new password login"] if args.phase == "account" else
                  ["registration", "automatic login", "computer directory", "rename", "remove", "logout others", "email change", "delete"])}, indent=2) + "\n")
finally:
    subprocess.run(["xcrun", "simctl", "shutdown", "all"], check=False, capture_output=True)
    fixture.terminate()
    try: fixture.wait(timeout=20)
    except subprocess.TimeoutExpired: fixture.kill(); fixture.wait()
    if metadata: shutil.rmtree(metadata["root"], ignore_errors=True)
