#!/usr/bin/env python3
"""Run existing XCUITests with an isolated account from an untracked private JSON.

The credential file must be outside the source tree. Passwords are never argv or
console output. Private xctestrun/result bundles can contain test data and stay in
the private validation directory.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--scheme", choices=["WeftMateMac", "WeftMatePhone"], required=True)
parser.add_argument("--destination", required=True)
parser.add_argument("--credentials", type=Path, required=True)
parser.add_argument("--artifacts", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source_root = root.parents[1]
credentials_path = args.credentials.resolve()
artifacts = args.artifacts.resolve()
for private_path in [credentials_path, artifacts]:
    if private_path.is_relative_to(source_root):
        parser.error("Credentials and private artifacts must be outside the source tree.")
credentials = json.loads(credentials_path.read_text())
if not isinstance(credentials.get("username"), str) or not isinstance(credentials.get("password"), str):
    parser.error("The private JSON requires username and password strings.")
artifacts.mkdir(parents=True, exist_ok=True, mode=0o700)
derived = artifacts / (args.scheme + "-DerivedData")
command = ["xcodebuild", "-project", str(root / "WeftMate.xcodeproj"), "-scheme", args.scheme,
           "-configuration", "Debug", "-destination", args.destination, "-derivedDataPath", str(derived), "build-for-testing"]
subprocess.run(command, cwd=root, check=True)
xctestruns = sorted((p for p in (derived / "Build/Products").glob("*.xctestrun") if not p.name.endswith("-private.xctestrun")), key=lambda p: p.stat().st_mtime, reverse=True)
if not xctestruns:
    raise SystemExit("No xctestrun file was produced.")
payload = plistlib.loads(xctestruns[0].read_bytes())
environment = {"WEFTMATE_E2E_USERNAME": credentials["username"], "WEFTMATE_E2E_PASSWORD": credentials["password"]}
if credentials.get("conversationTitle"):
    environment["WEFTMATE_E2E_CONVERSATION_TITLE"] = credentials["conversationTitle"]
if credentials.get("serverURL"):
    environment["WEFTMATE_E2E_SERVER"] = credentials["serverURL"]
if "TestConfigurations" in payload:
    test_targets = [target for config in payload["TestConfigurations"] for target in config.get("TestTargets", [])]
else:
    test_targets = [value for key, value in payload.items() if not key.startswith("__") and isinstance(value, dict)]
for target in test_targets:
    target.setdefault("EnvironmentVariables", {}).update(environment)
# Preserve __TESTROOT__ resolution to the built products directory.
private_run = xctestruns[0].parent / (args.scheme + "-private.xctestrun")
private_run.write_bytes(plistlib.dumps(payload))
os.chmod(private_run, 0o600)
subprocess.run(["xcodebuild", "test-without-building", "-xctestrun", str(private_run), "-destination", args.destination,
                "-only-testing:" + args.scheme + "UITests/WeftMateUITests/testRealLoginAndConversationRead"], cwd=root, check=True)
