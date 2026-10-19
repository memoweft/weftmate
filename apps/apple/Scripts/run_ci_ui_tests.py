#!/usr/bin/env python3
"""Run existing self-contained and loopback iPhone UI tests without credentials."""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
SUITES = ["WeftMateUITests", "S1cCloudUITests", "Mode2IUITests", "Apple8UITests",
          "Apple9UITests", "Apple11UITests", "DIAG3UITests", "UPD2UITests",
          "A3TimelineUITests", "A4aApprovalUITests", "A4bResourcesUITests",
          "A4cAppearanceUITests", "IC2IconsUITests"]
FIXTURES = [("a3_fake_server.py", 18763), ("a4a_fake_server.py", 18764),
            ("a4b_fake_server.py", 18765), ("a4c_fake_server.py", 18766)]


def stop(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)


def run(command, log, timeout):
    print("Running: " + " ".join(map(str, command)), flush=True)
    with log.open("w") as stream:
        process = subprocess.Popen(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        try:
            return process.wait(timeout=timeout)
        finally:
            stop(process)
            print("\n".join(log.read_text(errors="replace").splitlines()[-60:]), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--derived-data", type=Path, required=True)
    args = parser.parse_args()
    artifacts = args.artifacts.resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    devices = json.loads(subprocess.check_output(["xcrun", "simctl", "list", "devices", "available", "-j"]))
    phones = [device for runtime, rows in devices["devices"].items() if ".iOS-" in runtime
              for device in rows if device["name"].startswith("iPhone") and device.get("isAvailable")]
    if not phones:
        raise RuntimeError("No available iPhone simulator in selected Xcode")
    device = phones[0]["udid"]
    print("iPhone simulator: " + json.dumps(phones[0]), flush=True)
    processes = []
    logs = []
    try:
        for filename, port in FIXTURES:
            stream = (artifacts / (filename + ".log")).open("w")
            logs.append(stream)
            process = subprocess.Popen([sys.executable, str(ROOT / "Tests" / filename), "--port", str(port)],
                                       cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
            processes.append(process)
            deadline = time.monotonic() + 20
            while True:
                if process.poll() is not None:
                    raise RuntimeError(filename + " exited before ready")
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=1):
                        break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError(filename + " did not start")
                    time.sleep(0.2)
        # xcodebuild boots the selected device headlessly; no Simulator.app is opened.
        command = ["xcodebuild", "-project", "WeftMate.xcodeproj", "-scheme", "WeftMatePhone",
                   "-configuration", "Debug", "-destination", "platform=iOS Simulator,id=" + device,
                   "-destination-timeout", "120", "-derivedDataPath", str(args.derived_data.resolve()),
                   "-resultBundlePath", str(artifacts / "phone.xcresult"), "-jobs", "4",
                   "-parallel-testing-enabled", "NO", "-maximum-concurrent-test-simulator-destinations", "1",
                   "-test-timeouts-enabled", "YES", "-default-test-execution-time-allowance", "180",
                   "-maximum-test-execution-time-allowance", "300", "CODE_SIGNING_ALLOWED=NO",
                   *["-only-testing:WeftMatePhoneUITests/" + suite for suite in SUITES], "test"]
        return run(command, artifacts / "phone-test.log", 2700)
    finally:
        for process in processes:
            stop(process)
        for stream in logs:
            stream.close()
        subprocess.run(["xcrun", "simctl", "shutdown", device], timeout=30, check=False)


if __name__ == "__main__":
    raise SystemExit(main())
