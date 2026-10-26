#!/usr/bin/env python3
"""Bounded Mac validation for the isolated iPhone candidate. Evidence stays outside source."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import time

from run_ci_ui_tests import start_node, stop
from run_state_checks import CHECKS

ROOT = Path(__file__).resolve().parents[1]
SCHEME = "WeftMatePhoneWindowTest"
TEST_TARGET = SCHEME + "UITests"
LIMITS = ["-jobs", "4", "-parallel-testing-enabled", "NO",
          "-maximum-concurrent-test-simulator-destinations", "1"]


def diagnostics():
    root = Path.home() / "Library/Logs/DiagnosticReports"
    try:
        files = {str(p.relative_to(root)): [p.stat().st_mtime_ns, p.stat().st_size]
                 for p in root.rglob("*") if p.is_file() and
                 (p.name.startswith("WeftMate") or "gpuRestart" in p.name)}
        return {"available": True, "files": files}
    except OSError as error:
        return {"available": False, "error": type(error).__name__}


class Evidence:
    def __init__(self, directory, phase):
        directory.mkdir(parents=True, exist_ok=True)
        self.path = Path(tempfile.mkdtemp(prefix=phase + "-", dir=directory.resolve()))
        self.path.chmod(0o700)
        self.rows = []
        self.meta = {"phase": phase, "startedUTC": datetime.now(timezone.utc).isoformat(),
                     "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                     "dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT)),
                     "diagnosticsBefore": diagnostics(), "commands": self.rows,
                     "physicalSigning": "pending", "iphoneAcceptance": "pending",
                     "realMemoWeftRoundTrip": "pending"}
        self.save()
        print("Evidence: " + str(self.path), flush=True)

    def save(self):
        (self.path / "results.json").write_text(json.dumps(self.meta, indent=2) + "\n", encoding="utf-8")

    def run(self, name, command, timeout=1800, environment=None, allow_failure=False):
        log = self.path / (name + ".log")
        started = time.monotonic()
        row = {"name": name, "command": list(map(str, command)), "timeoutSeconds": timeout}
        self.rows.append(row); self.save()
        print("Running " + name, flush=True)
        try:
            with log.open("w") as stream:
                process = subprocess.Popen(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT,
                                           env={**os.environ, **(environment or {})}, start_new_session=True)
                try:
                    code = process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    code = 124; row["timedOut"] = True
                finally:
                    stop(process)
            row["exitCode"] = code
        except OSError as error:
            row.update(exitCode=127, error=type(error).__name__)
            code = 127
        finally:
            row["seconds"] = round(time.monotonic() - started, 2)
            self.save()
            if log.exists():
                print("\n".join(log.read_text(errors="replace").splitlines()[-25:]), flush=True)
        if code and not allow_failure:
            raise RuntimeError(name + " failed, exit " + str(code))
        return code


def xcode(destination, derived):
    return ["xcodebuild", *LIMITS, "-destination", destination, "-destination-timeout", "120",
            "-derivedDataPath", str(derived)]


def ui(evidence, device):
    if not (ROOT / "Tests/PhoneWindowUITests.swift").exists():
        raise RuntimeError("Integrate APPLE-1's memory-route UI suite and regenerate the project before final UI validation")
    # The caller selects the actual UUID; never pick or launch an arbitrary device.
    devices = json.loads(subprocess.check_output(["xcrun", "simctl", "list", "devices", "available", "-j"]))
    phones = [row for runtime, rows in devices["devices"].items() if ".iOS-" in runtime
              for row in rows if row.get("isAvailable") and row["name"].startswith("iPhone")]
    if not any(row["udid"] == device for row in phones):
        raise RuntimeError("--device must be an available iPhone simulator UUID")
    evidence.meta["simulator"] = next(row for row in phones if row["udid"] == device)
    evidence.save()
    derived = evidence.path / "DerivedData"
    base = xcode("platform=iOS Simulator,id=" + device, derived)
    evidence.run("build-for-testing", [*base, "-project", "WeftMate.xcodeproj", "-scheme", SCHEME,
                 "-configuration", "Debug", "CODE_SIGNING_ALLOWED=NO", "build-for-testing"])
    runs = list((derived / "Build/Products").glob("*.xctestrun"))
    if len(runs) != 1:
        raise RuntimeError("Expected one candidate xctestrun")
    processes, logs = [], []
    run = runs[0].with_name("window-fixture.xctestrun")
    try:
        config = start_node("phone_window_model_server.mjs", evidence.path, processes, logs)
        payload = plistlib.loads(runs[0].read_bytes())
        targets = ([t for c in payload["TestConfigurations"] for t in c.get("TestTargets", [])]
                   if "TestConfigurations" in payload else [v for k, v in payload.items() if not k.startswith("__")])
        for target in targets:
            target.setdefault("EnvironmentVariables", {})["WEFTMATE_PHONE_WINDOW_MODEL_URL"] = config["origin"] + "/v1"
        run.write_bytes(plistlib.dumps(payload)); run.chmod(0o600)
        selectors = ["-only-testing:" + TEST_TARGET + "/PhoneWindowInstallUITests",
                     "-only-testing:" + TEST_TARGET + "/PhoneWindowUITests"]
        evidence.meta["testSelectors"] = selectors
        code = evidence.run("window-ui", [*base, "-xctestrun", str(run), "-resultBundlePath",
                            str(evidence.path / "window.xcresult"), "-test-timeouts-enabled", "YES",
                            "-default-test-execution-time-allowance", "120",
                            "-maximum-test-execution-time-allowance", "300", *selectors,
                            "test-without-building"], allow_failure=True)
        summary_code = evidence.run("ui-summary", ["xcrun", "xcresulttool", "get", "test-results", "summary",
                                   "--path", str(evidence.path / "window.xcresult")], timeout=60, allow_failure=True)
        if summary_code:
            raise RuntimeError("UI counts unavailable; inspect xcresult")
        summary = json.loads((evidence.path / "ui-summary.log").read_text())
        counts = {key: summary[key] for key in ["totalTestCount", "passedTests", "failedTests", "skippedTests"]}
        evidence.meta["testCounts"] = counts; evidence.save()
        if counts["totalTestCount"] < 3 or counts["totalTestCount"] != counts["passedTests"]:
            raise RuntimeError("Expected memory-route and both install tests, all passing with no skips")
        if code:
            raise RuntimeError("window-ui failed, exit " + str(code))
    finally:
        for process in processes:
            stop(process)
        for stream in logs:
            stream.close()
        run.unlink(missing_ok=True)
        evidence.run("shutdown", ["xcrun", "simctl", "shutdown", "all"], timeout=60, allow_failure=True)
        after = diagnostics()
        before = evidence.meta["diagnosticsBefore"]
        new_gpu = (after["available"] and before["available"] and any(
            "gpuRestart" in name and before["files"].get(name) != value for name, value in after["files"].items()))
        seconds = 600 if new_gpu else 180
        evidence.meta["cooldownSeconds"] = seconds; evidence.save()
        for remaining in range(seconds, 0, -30):
            print("Simulator cooldown: " + str(remaining) + "s", flush=True)
            time.sleep(min(30, remaining))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=["preflight", "core", "state", "build", "ui"], required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--device", help="Actual iPhone simulator UUID, required for UI.")
    parser.add_argument("--check", action="append", choices=list(CHECKS))
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("Run this validation on the Mac; Windows can run test_window_project.py")
    if args.phase == "ui" and not args.device:
        parser.error("UI needs --device <actual UUID>")
    if args.phase == "state" and not args.check:
        parser.error("Select each integrated state check with --check")
    evidence = Evidence(args.artifacts, args.phase)
    code = 1
    try:
        if args.phase == "preflight":
            for name, command in [
                ("xcode", ["xcodebuild", "-version"]), ("swift", ["swift", "--version"]),
                ("sdks", ["xcodebuild", "-showsdks"]), ("devices", ["xcrun", "devicectl", "list", "devices"]),
                ("simulators", ["xcrun", "simctl", "list", "devices", "available", "-j"]),
                ("sessions", ["pgrep", "-fl", "codex"])]:
                evidence.run(name, command, timeout=60, allow_failure=name in ["sessions", "devices"])
        elif args.phase == "core":
            evidence.run("core", ["swift", "test", "--package-path", "Packages/WeftMateCore", "--scratch-path",
                         str(evidence.path / "CoreBuild"), "--jobs", "2"], timeout=1200)
        elif args.phase == "state":
            for name in args.check:
                evidence.run(name, [sys.executable, "Scripts/run_state_checks.py", "--artifacts", str(evidence.path / "state"),
                             "--core-build", str(evidence.path / "CoreBuild"), "--check", name], timeout=1200)
        elif args.phase == "build":
            for scheme, destination in [(SCHEME, "generic/platform=iOS"), ("WeftMatePhone", "generic/platform=iOS"),
                                        ("WeftMateMac", "platform=macOS"), ("WeftMateWatch", "generic/platform=watchOS")]:
                evidence.run(scheme, [*xcode(destination, evidence.path / scheme), "-project", "WeftMate.xcodeproj",
                             "-scheme", scheme, "-configuration", "Debug", "CODE_SIGNING_ALLOWED=NO", "build"])
        else:
            ui(evidence, args.device)
        code = 0
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        code = 1; evidence.meta["error"] = str(error); print(str(error), file=sys.stderr)
    finally:
        evidence.meta["exitCode"] = code
        after = diagnostics(); evidence.meta["diagnosticsAfter"] = after
        before = evidence.meta["diagnosticsBefore"]
        evidence.meta["newDiagnostics"] = ([name for name, value in after["files"].items()
            if before["files"].get(name) != value] if before["available"] and after["available"] else None)
        evidence.save()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
