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
import sys
import uuid
from urllib.parse import urlparse


def main():
    if "--describe-input-contract" in sys.argv[1:]:
        print(json.dumps({
            "mode": "input-contract-only; no credentials read, GUI, or network",
            "candidateOriginArgument": "--candidate-origin",
            "candidateOrigin": "https://home.weftmate.com:<coordinator-assigned temporary port>",
            "candidateOriginMustMatchCredentialServer": True,
            "credentialArgument": "--credentials", "credentialRequiredStrings": ["server", "username", "password"],
            "scenarioArgument": "--scenario-file", "scenarioRequiredStrings": ["sessionId (or conversationID)", "marker"],
            "markerSource": "actual candidate session/task source text; never synthesized to satisfy this harness",
            "fileMode": "user-owned 0600 JSON outside repository",
            "transport": "normal App URLSession and certificate validation; development proxy excluded in candidate mode",
            "platforms": ["WeftMatePhone", "WeftMateMac"],
        }, ensure_ascii=False, indent=2))
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scheme", choices=["WeftMateMac", "WeftMatePhone"], required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--development-proxy-port", type=int)
    parser.add_argument("--candidate-origin")
    parser.add_argument("--scenario-file", type=Path)
    parser.add_argument("--derived-data", type=Path)
    parser.add_argument("--namespace")
    parser.add_argument("--hold-ready", action="store_true")
    parser.add_argument("--approval-state", type=Path)
    parser.add_argument("--native-save-folder")
    parser.add_argument("--artifact-save-return-only", action="store_true")
    parser.add_argument("--test", choices=["full", "navigation-layout", "account-menu", "candidate-pending", "candidate-approval", "candidate-artifact"], default="full")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source_root = root.parents[1]
    credentials_path = args.credentials.resolve()
    artifacts = args.artifacts.resolve()
    for private_path in [credentials_path, artifacts]:
        if private_path.is_relative_to(source_root):
            parser.error("Credentials and private artifacts must be outside the source tree.")

    def load_credentials(path, required, check_server=True):
        try:
            metadata = path.stat()
            if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_uid != os.getuid():
                parser.error("Private credential files must be regular files owned by this user, with mode 0600.")
            payload = json.loads(path.read_text())
        except (OSError, ValueError):
            parser.error("The private credential JSON could not be read.")
        if not isinstance(payload, dict) or any(not isinstance(payload.get(key), str) or not payload[key].strip() for key in required):
            parser.error("The credential JSON is missing required nonempty fields: " + ", ".join(required))
        if check_server and urlparse(payload["server"]).scheme != "https":
            parser.error("The real UI fixture must use HTTPS.")
        return payload

    if args.candidate_origin:
        origin = urlparse(args.candidate_origin)
        try:
            port = origin.port
        except ValueError:
            parser.error("Candidate origin port is invalid.")
        if (origin.scheme != "https" or origin.hostname != "home.weftmate.com" or port is None
                or not 1024 <= port <= 65535 or port == 8443 or origin.username is not None
                or origin.password is not None or origin.query or origin.fragment or origin.path not in ("", "/")):
            parser.error("Use the explicitly handed-over home.weftmate.com HTTPS temporary port, distinct from formal 8443.")
        candidate = "https://home.weftmate.com:" + str(port)
        if args.development_proxy_port is not None:
            parser.error("Candidate acceptance uses the normal App transport; no development proxy.")
        credentials = load_credentials(credentials_path, ["server", "username", "password"])
        if credentials["server"] not in (candidate, candidate + "/"):
            parser.error("Credential server must exactly match the candidate origin; no silent rewrite.")
        if args.scenario_file is None:
            parser.error("Candidate acceptance requires the actual session/task scenario file.")
        scenario_path = args.scenario_file.resolve()
        if scenario_path.is_relative_to(source_root):
            parser.error("Scenario file must be outside the source tree.")
        scenario = load_credentials(scenario_path, ["marker"], check_server=False)
        session = scenario.get("sessionId", scenario.get("conversationID"))
        if not isinstance(session, str) or not session.strip():
            parser.error("Scenario requires the actual candidate sessionId or conversationID.")
        if "sessionId" in scenario and "conversationID" in scenario and scenario["sessionId"] != scenario["conversationID"]:
            parser.error("Scenario session identities must agree.")
        if "server" in scenario and scenario["server"] not in (candidate, candidate + "/"):
            parser.error("Scenario belongs to a different origin.")
        credentials["conversationID"] = session
        credentials["marker"] = scenario["marker"]
        if scenario.get("conversationTitle"):
            credentials["conversationTitle"] = scenario["conversationTitle"]
    else:
        if args.scenario_file is not None:
            parser.error("A candidate scenario requires an explicit candidate origin.")
        credentials = load_credentials(credentials_path, ["server", "username", "password", "conversationID", "marker"])
    second_path = Path(str(credentials_path) + ".second-account.json")
    second = load_credentials(second_path, ["server", "username", "password"]) if second_path.exists() else None
    if second:
        expected_origins = (candidate, candidate + "/") if args.candidate_origin else (credentials["server"],)
        if second["server"] not in expected_origins:
            parser.error("Both isolated accounts must use the same server origin.")
    if args.development_proxy_port is not None:
        if not 1024 <= args.development_proxy_port <= 65535:
            parser.error("Development proxy port must be between 1024 and 65535.")
        origin = urlparse(credentials["server"])
        if origin.hostname != "home.weftmate.com" or origin.port != 8443:
            parser.error("The development relay only supports the existing home.weftmate.com:8443 origin.")
    if args.test in ("candidate-pending", "candidate-approval", "candidate-artifact") and (not args.candidate_origin or args.scheme != "WeftMatePhone"):
        parser.error("Read-only candidate readiness requires the explicit candidate origin and isolated iOS scheme.")
    if args.artifact_save_return_only and args.test != "candidate-artifact":
        parser.error("Artifact save/return continuation requires the assigned artifact test.")

    artifacts.mkdir(parents=True, exist_ok=True, mode=0o700)
    if stat.S_IMODE(artifacts.stat().st_mode) != 0o700:
        parser.error("The private artifacts directory must have mode 0700.")
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    run_dir = artifacts / (args.scheme + "-RealUI-" + run_id)
    run_dir.mkdir(mode=0o700)
    derived = args.derived_data.resolve() if args.derived_data else run_dir / "DerivedData"
    result_bundle = run_dir / "RealUITests.xcresult"
    environment = {
        "WEFTMATE_E2E_SERVER": credentials["server"],
        "WEFTMATE_E2E_USERNAME": credentials["username"],
        "WEFTMATE_E2E_PASSWORD": credentials["password"],
        "WEFTMATE_E2E_CONVERSATION_ID": credentials["conversationID"],
        "WEFTMATE_E2E_MARKER": credentials["marker"],
        "WEFTMATE_E2E_NAMESPACE": args.namespace or "real-ui-" + uuid.uuid4().hex,
    }
    if credentials.get("conversationTitle"):
        environment["WEFTMATE_E2E_CONVERSATION_TITLE"] = credentials["conversationTitle"]
    if args.test in ("candidate-pending", "candidate-approval", "candidate-artifact"):
        fields = [("taskId", "WEFTMATE_E2E_TASK_ID")]
        if args.test != "candidate-artifact":
            fields += [("questionRpcId", "WEFTMATE_E2E_QUESTION_RPC_ID")]
        for key, env in fields:
            if not isinstance(scenario.get(key), str) or not scenario[key].strip():
                parser.error("Candidate readiness scenario is missing field: " + key)
            environment[env] = scenario[key]
        if args.hold_ready:
            environment["WEFTMATE_E2E_HOLD_RELEASE_FILE"] = str(run_dir / "release-readonly-observer")
        if args.test == "candidate-approval":
            if args.approval_state is None:
                parser.error("Approval requires the actual same-task readback state.")
            state = json.loads(args.approval_state.read_text())
            waiting = [row for row in state.get("approvals", []) if row.get("status") == "pending" and row.get("sameRootSource") is True]
            if state.get("scopeMatched") is not True or state.get("questionStatus") not in ("answered", "resolved") or len(waiting) != 1:
                parser.error("The information answer and unique same-source approval must be actually observed.")
            environment["WEFTMATE_E2E_EXPECTED_APPROVAL_ID"] = waiting[0]["id"]
            environment["WEFTMATE_E2E_APPROVAL_TOOL_NAME"] = waiting[0]["toolName"]
        if args.test == "candidate-artifact":
            for key, env in [("artifactId", "WEFTMATE_E2E_ARTIFACT_ID"), ("artifactCommandId", "WEFTMATE_E2E_ARTIFACT_COMMAND_ID"),
                             ("fileName", "WEFTMATE_E2E_ARTIFACT_FILE_NAME"), ("sha256", "WEFTMATE_E2E_ARTIFACT_EXPECTED_SHA256")]:
                if not isinstance(scenario.get(key), str) or not scenario[key].strip():
                    parser.error("Artifact scenario is missing field: " + key)
                environment[env] = scenario[key]
            environment["WEFTMATE_E2E_ARTIFACT_EXPECTED_BYTES"] = str(scenario["size"])
            if args.native_save_folder:
                environment["WEFTMATE_E2E_NATIVE_SAVE_FOLDER"] = args.native_save_folder
            if args.artifact_save_return_only:
                environment["WEFTMATE_E2E_ARTIFACT_SAVE_RETURN_ONLY"] = "true"
    if second:
        environment["WEFTMATE_E2E_SECOND_USERNAME"] = second["username"]
        environment["WEFTMATE_E2E_SECOND_PASSWORD"] = second["password"]
    if args.development_proxy_port is not None:
        environment["WEFTMATE_E2E_DEVELOPMENT_PROXY_PORT"] = str(args.development_proxy_port)
    secrets = [credentials["username"], credentials["password"]]
    if second:
        secrets += [second["username"], second["password"]]
    if args.candidate_origin and isinstance(scenario.get("originalUserContent"), str):
        secrets += [scenario["originalUserContent"]]
    secrets = [value for value in secrets if value]

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
    xctestruns = sorted((p for p in (derived / "Build/Products").glob("*.xctestrun") if "-private" not in p.name),
                       key=lambda p: p.stat().st_mtime, reverse=True)
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
    private_run = xctestruns[0].parent / (args.scheme + "-private-" + run_id + ".xctestrun")
    with private_run.open("xb") as output:
        os.chmod(private_run, 0o600)
        output.write(plistlib.dumps(payload))
    (run_dir / "run.json").write_text(json.dumps({
        "scheme": args.scheme, "destination": args.destination,
        "test": args.test,
        "artifactSaveReturnOnly": args.artifact_save_return_only,
        "developmentProxyPort": args.development_proxy_port,
        "secondAccountAvailable": second is not None,
        "resultBundle": str(result_bundle), "namespace": environment["WEFTMATE_E2E_NAMESPACE"],
    }, indent=2) + chr(10))
    test_name = {"full": "testRealLoginAndConversationRead", "navigation-layout": "testRealConversationNavigationLayout",
                 "account-menu": "testPhoneAccountMenuReturnsToSameDraft",
                 "candidate-pending": "testCandidatePendingQuestionReadiness",
                 "candidate-approval": "testCandidateQuestionAnswerApprovalOnce",
                 "candidate-artifact": "testCandidateTextArtifactPreviewSaveAndReturnDraft"}[args.test]
    run(["xcodebuild", "test-without-building", "-xctestrun", str(private_run), "-destination", args.destination,
         "-resultBundlePath", str(result_bundle), "-parallel-testing-enabled", "NO",
         "-only-testing:" + args.scheme + "UITests/WeftMateUITests/" + test_name], "test.log")


if __name__ == "__main__":
    main()
