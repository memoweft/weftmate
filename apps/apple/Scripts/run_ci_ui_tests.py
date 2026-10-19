#!/usr/bin/env python3
"""Run existing iPhone tests with isolated local fixtures, without repository secrets."""
import argparse
import json
import os
from pathlib import Path
import plistlib
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
# Each batch starts fresh services. All cloud/mail/model traffic stays in the fixture.
HOST_BATCHES = [
    ("a5_cloud_fixture.mjs", "WEFTMATE_A5_DRIVER", ["A5ParityUITests", "A6SettingsUITests", "A7SessionMenuUITests", "A8ConversationFlowUITests", "A9PolishUITests"]),
    ("a11_fixture.mjs", "WEFTMATE_A11_DRIVER", ["A11ProjectsUITests"]),
    ("a13_fixture.mjs", "WEFTMATE_A13_DRIVER", ["A13ConsistencyUITests"]),
    ("a14_fixture.mjs", "WEFTMATE_A14_DRIVER", ["A14OfflineUITests"]),
    ("a15_fixture.mjs", "WEFTMATE_A15_DRIVER", ["A15UXUITests"]),
    ("a16_fixture.mjs", "WEFTMATE_A16_DRIVER", ["A16ChatUITests"]),
    ("a17_states_fixture.mjs", "WEFTMATE_A17_DRIVER", ["A17StatesUITests"]),
]


def stop(process):
    # A fixture may have spawned a cloud process before its own failure.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
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


def start_node(filename, artifacts, processes, logs, extra_args=(), environment=None):
    log = artifacts / (filename + "-" + str(len(logs)) + ".log")
    stream = log.open("w")
    logs.append(stream)
    process = subprocess.Popen(["node", str(ROOT / "Tests" / filename), *extra_args],
                               cwd=ROOT.parents[1], env={**os.environ, **(environment or {})},
                               stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
    processes.append(process)
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        for line in log.read_text(errors="replace").splitlines():
            try:
                config = json.loads(line)
            except ValueError:
                continue
            if isinstance(config, dict) and ("driver" in config or "origin" in config):
                return config
        if process.poll() is not None:
            raise RuntimeError(filename + " exited before ready; see fixture log")
        time.sleep(0.2)
    raise TimeoutError(filename + " did not become ready")


def test_run(base, payload, path, suites, environment, artifacts, name):
    data = plistlib.loads(payload)
    targets = ([target for config in data["TestConfigurations"] for target in config.get("TestTargets", [])]
               if "TestConfigurations" in data else [v for k, v in data.items() if not k.startswith("__")])
    for target in targets:
        target.setdefault("EnvironmentVariables", {}).update(environment)
    path.write_bytes(plistlib.dumps(data))
    path.chmod(0o600)
    command = [*base, "-xctestrun", str(path), "-resultBundlePath", str(artifacts / (name + ".xcresult")),
               *["-only-testing:WeftMatePhoneUITests/" + suite for suite in suites], "test-without-building"]
    started = time.monotonic()
    try:
        code = run(command, artifacts / (name + ".log"), 2700)
    finally:
        path.unlink(missing_ok=True)
    bundle = artifacts / (name + ".xcresult")
    if bundle.exists():
        run(["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(bundle)],
            artifacts / (name + "-summary.json"), 60)
    return {"batch": name, "exitCode": code, "seconds": round(time.monotonic() - started, 1)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--derived-data", type=Path, required=True)
    parser.add_argument("--group", choices=["local", "host", "cloud", "features"], default="local")
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
    results = []
    try:
        # Build all test sources once before starting any local services.
        base = ["xcodebuild", "-destination", "platform=iOS Simulator,id=" + device,
                "-destination-timeout", "120", "-parallel-testing-enabled", "NO",
                "-maximum-concurrent-test-simulator-destinations", "1",
                "-test-timeouts-enabled", "YES", "-default-test-execution-time-allowance", "180",
                "-maximum-test-execution-time-allowance", "300"]
        code = run([*base, "-project", "WeftMate.xcodeproj", "-scheme", "WeftMatePhone",
                    "-configuration", "Debug", "-derivedDataPath", str(args.derived_data.resolve()),
                    "-jobs", "4", "CODE_SIGNING_ALLOWED=NO", "build-for-testing"],
                   artifacts / "build-for-testing.log", 1200)
        if code:
            return code
        source = next((args.derived_data.resolve() / "Build/Products").glob("*.xctestrun"))
        payload = source.read_bytes()
        private_run = source.parent / "ci-fixture.xctestrun"
        for filename, port in (FIXTURES if args.group == "local" else []):
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
        batches = []
        if args.group == "local":
            batches = [("local", SUITES, lambda: {})]
        elif args.group == "host":
            for filename, key, suites in HOST_BATCHES:
                def setup(filename=filename, key=key):
                    config = start_node(filename, artifacts, processes, logs)
                    return {key: config["driver"], "WEFTMATE_A17_STATE": "empty", "WEFTMATE_A17_THEME": "light"}
                batches.append((filename.removesuffix(".mjs"), suites, setup))
        elif args.group == "cloud":
            for filename, key, suites in [
                ("apple2_cloud_fixture.mjs", "WEFTMATE_APPLE2_DRIVER", ["APPLE2LoginUITests"]),
                ("health1_cloud_fixture.mjs", "WEFTMATE_APPLE2_DRIVER", ["HEALTH1UITests"]),
                ("lg2_cloud_fixture.mjs", "WEFTMATE_LG2_DRIVER", ["LG2AccountUITests"]),
                ("apple2_cloud_fixture.mjs", "WEFTMATE_APPLE6_DRIVER", ["Apple6UITests/testLegacyNoComputerEntry", "Apple6UITests/testAStandaloneLight", "Apple6UITests/testBStandaloneDark"]),
            ]:
                def setup(filename=filename, key=key):
                    config = start_node(filename, artifacts, processes, logs,
                                        extra_args=["--apple6-nohost"] if key == "WEFTMATE_APPLE6_DRIVER" else [],
                                        environment={"WEFTMATE_HEALTH1_FIXTURE": "1",
                                                     "WEFTMATE_APPLE6_SIMULATOR": device,
                                                     "WEFTMATE_APPLE6_SHOTS": str(artifacts / "apple6-shots")})
                    return {key: config["driver"]}
                batches.append((filename.removesuffix(".mjs") + "-" + key, suites, setup))
        else:
            def feature_setup():
                health = start_node("health4_host_fixture.mjs", artifacts, processes, logs)["origin"]
                contract = start_node("apple3_host_fixture.mjs", artifacts, processes, logs)["origin"]
                driver = start_node("apple2_cloud_fixture.mjs", artifacts, processes, logs,
                                    extra_args=["--apple6-nohost"], environment={
                                        "WEFTMATE_APPLE6_SIMULATOR": device,
                                        "WEFTMATE_APPLE6_SHOTS": str(artifacts / "apple6-shots")})["driver"]
                return {"WEFTMATE_HEALTH4_ORIGIN": health, "WEFTMATE_APPLE3_ORIGIN": contract,
                        "WEFTMATE_APPLE5_ORIGIN": health, "WEFTMATE_APPLE5_USERNAME": "health4_synthetic",
                        "WEFTMATE_APPLE5_PASSWORD": "synthetic-test-only", "WEFTMATE_APPLE6_DRIVER": driver}
            batches = [("features", ["HEALTH4UITests", "Apple3UITests", "Apple4UITests", "Apple5UITests",
                                     "Apple5AddendumUITests", "Apple5FixUITests", "Apple6UITests/testCPresentationLightAndDark"], feature_setup)]
        for name, suites, setup in batches:
            try:
                environment = setup()
                results.append(test_run(base, payload, private_run, suites, environment, artifacts, name))
            except (RuntimeError, TimeoutError, subprocess.TimeoutExpired) as error:
                print(str(error), flush=True)
                results.append({"batch": name, "exitCode": 1, "error": str(error)})
            finally:
                for process in processes:
                    stop(process)
                processes.clear()
                (artifacts / "batches.json").write_text(json.dumps(results, indent=2) + "\n")
        return int(any(row["exitCode"] for row in results))
    finally:
        for process in processes:
            stop(process)
        for stream in logs:
            stream.close()
        subprocess.run(["xcrun", "simctl", "shutdown", device], timeout=30, check=False)


if __name__ == "__main__":
    raise SystemExit(main())
