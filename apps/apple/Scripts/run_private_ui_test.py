#!/usr/bin/env python3
"""Run the real UI regression using AppleAcceptance's private fixture JSON.

Credentials and artifacts remain outside the source tree. Passwords are injected
through a 0600 xctestrun file, never command arguments, and redacted from console
and text logs. Result bundles can contain test data and stay in a 0700 directory.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import plistlib
import stat
import subprocess
import uuid
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scheme", choices=["WeftMateMac", "WeftMatePhone"], required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--development-proxy-port", type=int)
    parser.add_argument("--test", choices=["full", "navigation-layout"], default="full")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source_root = root.parents[1]
    credentials_path = args.credentials.resolve()
    artifacts = args.artifacts.resolve()
    for private_path in [credentials_path, artifacts]:
        if private_path.is_relative_to(source_root):
            parser.error("Credentials and private artifacts must be outside the source tree.")

    def load_credentials(path, required):
        try:
            metadata = path.stat()
            if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_uid != os.getuid():
                parser.error("Private credential files must be regular files owned by this user, with mode 0600.")
            payload = json.loads(path.read_text())
        except (OSError, ValueError):
            parser.error("The private credential JSON could not be read.")
        if not isinstance(payload, dict) or any(not isinstance(payload.get(key), str) or not payload[key] for key in required):
            parser.error("The credential JSON is missing required nonempty fields: " + ", ".join(required))
        if urlparse(payload["server"]).scheme != "https":
            parser.error("The real UI fixture must use HTTPS.")
        return payload

    credentials = load_credentials(credentials_path, ["server", "username", "password", "conversationID", "marker"])
    second_path = Path(str(credentials_path) + ".second-account.json")
    second = load_credentials(second_path, ["server", "username", "password"]) if second_path.exists() else None
    if second and second["server"] != credentials["server"]:
        parser.error("Both isolated accounts must use the same server origin.")
    if args.development_proxy_port is not None:
        if not 1024 <= args.development_proxy_port <= 65535:
            parser.error("Development proxy port must be between 1024 and 65535.")
        origin = urlparse(credentials["server"])
        if origin.hostname != "home.weftmate.com" or origin.port != 8443:
            parser.error("The development relay only supports the existing home.weftmate.com:8443 origin.")

    artifacts.mkdir(parents=True, exist_ok=True, mode=0o700)
    if stat.S_IMODE(artifacts.stat().st_mode) != 0o700:
        parser.error("The private artifacts directory must have mode 0700.")
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    run_dir = artifacts / (args.scheme + "-RealUI-" + run_id)
    run_dir.mkdir(mode=0o700)
    derived = run_dir / "DerivedData"
    result_bundle = run_dir / "RealUITests.xcresult"
    environment = {
        "WEFTMATE_E2E_SERVER": credentials["server"],
        "WEFTMATE_E2E_USERNAME": credentials["username"],
        "WEFTMATE_E2E_PASSWORD": credentials["password"],
        "WEFTMATE_E2E_CONVERSATION_ID": credentials["conversationID"],
        "WEFTMATE_E2E_MARKER": credentials["marker"],
        "WEFTMATE_E2E_NAMESPACE": "real-ui-" + uuid.uuid4().hex,
    }
    if credentials.get("conversationTitle"):
        environment["WEFTMATE_E2E_CONVERSATION_TITLE"] = credentials["conversationTitle"]
    if second:
        environment["WEFTMATE_E2E_SECOND_USERNAME"] = second["username"]
        environment["WEFTMATE_E2E_SECOND_PASSWORD"] = second["password"]
    if args.development_proxy_port is not None:
        environment["WEFTMATE_E2E_DEVELOPMENT_PROXY_PORT"] = str(args.development_proxy_port)
    secrets = [credentials["password"]] + ([second["password"]] if second else [])

    def run(command, log_name):
        with (run_dir / log_name).open("x") as log:
            process = subprocess.Popen(command, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in process.stdout:
                for secret in secrets:
                    line = line.replace(secret, "[REDACTED]")
                print(line, end="", flush=True)
                log.write(line)
            code = process.wait()
        if code:
            raise SystemExit(code)

    print("Private UI validation directory: " + str(run_dir), flush=True)
    run(["xcodebuild", "-project", str(root / "WeftMate.xcodeproj"), "-scheme", args.scheme,
         "-configuration", "Debug", "-destination", args.destination, "-derivedDataPath", str(derived),
         "build-for-testing"], "build-for-testing.log")
    xctestruns = sorted((derived / "Build/Products").glob("*.xctestrun"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not xctestruns:
        raise SystemExit("No xctestrun file was produced.")
    payload = plistlib.loads(xctestruns[0].read_bytes())
    if "TestConfigurations" in payload:
        test_targets = [target for config in payload["TestConfigurations"] for target in config.get("TestTargets", [])]
    else:
        test_targets = [value for key, value in payload.items() if not key.startswith("__") and isinstance(value, dict)]
    for target in test_targets:
        target.setdefault("EnvironmentVariables", {}).update(environment)
    # Keep __TESTROOT__ resolving to the products directory.
    private_run = xctestruns[0].parent / (args.scheme + "-private.xctestrun")
    with private_run.open("xb") as output:
        os.chmod(private_run, 0o600)
        output.write(plistlib.dumps(payload))
    (run_dir / "run.json").write_text(json.dumps({
        "scheme": args.scheme, "destination": args.destination,
        "test": args.test,
        "developmentProxyPort": args.development_proxy_port,
        "secondAccountAvailable": second is not None,
        "resultBundle": str(result_bundle), "namespace": environment["WEFTMATE_E2E_NAMESPACE"],
    }, indent=2) + chr(10))
    test_name = "testRealLoginAndConversationRead" if args.test == "full" else "testRealConversationNavigationLayout"
    run(["xcodebuild", "test-without-building", "-xctestrun", str(private_run), "-destination", args.destination,
         "-resultBundlePath", str(result_bundle), "-parallel-testing-enabled", "NO",
         "-only-testing:" + args.scheme + "UITests/WeftMateUITests/" + test_name], "test.log")


if __name__ == "__main__":
    main()
