#!/usr/bin/env python3
"""Compile and run the standalone Swift state checks with isolated build/data paths."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
APP_MODEL = ["OfflineChatModel", "A14TestSupport", "CloudBrowser", "CloudLoginModel", "AppleAppModel", "ConversationSendState", "ConversationAdoptionState", "ConversationAttachmentState", "TaskWorkspaceModel"]
CHECKS = {
    "AppleUX23StateChecks": APP_MODEL,
    "AppleSettingsSummaryChecks": APP_MODEL,
    "AppleContractStateChecks": APP_MODEL,
    "AppleAdoptionStateChecks": APP_MODEL,
    "AppleDraftStateChecks": APP_MODEL,
    "AppleSendStateChecks": APP_MODEL,
    "AppleTaskEntryChecks": APP_MODEL,
    "AppleTimelineStateChecks": APP_MODEL,
    "MemoryWorkspaceStateChecks": ["MemoryWorkspaceModel"],
    "MessageMarkdownChecks": ["MessageMarkdown"],
    "DesignTokenChecks": ["WeaveTheme", "WeftIcon"],
    "ToolProgressChecks": ["ToolProgressModel"],
    "TaskDirectoryChecks": ["TaskDirectoryModel"],
    "TaskInteractionChecks": ["TaskInteractionModel"],
    "TaskWorkspaceChecks": ["TaskWorkspaceModel"],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--core-build", type=Path, help="Reuse an isolated SwiftPM scratch directory.")
    parser.add_argument("--check", choices=list(CHECKS), action="append", help="Run only a related state check; omit for CI full state suite.")
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="apple-state-", dir=args.artifacts.resolve()))
    scratch = (args.core_build or run / "CoreBuild").resolve()
    build = ["swift", "build", "--package-path", str(ROOT / "Packages/WeftMateCore"),
             "--scratch-path", str(scratch), "--jobs", "2"]
    with (run / "core-build.log").open("w") as log:
        subprocess.run(build, stdout=log, stderr=subprocess.STDOUT, check=True)
    products = Path(subprocess.check_output(build + ["--show-bin-path"], text=True).strip())
    objects = sorted((products / "WeftMateCore.build").glob("*.swift.o")) + sorted((products / "JOSESwift.build").glob("*.swift.o"))
    results = []
    print(f"Artifacts: {run}", flush=True)
    for name, models in CHECKS.items():
        if args.check and name not in args.check:
            continue
        executable = run / name
        sources = [ROOT / "UI" / (model + ".swift") for model in models]
        if models == APP_MODEL:
            sources.append(ROOT / "Tests/TaskProgressUIFixture.swift")
            sources.append(ROOT / "Tests/AppleContractUIFixture.swift")
        if name == "AppleUX23StateChecks":
            sources.append(ROOT / "UI/AccountUsageModel.swift")
        if name == "AppleSettingsSummaryChecks":
            sources += [ROOT / "UI/AppleSettingsModel.swift", ROOT / "UI/WeaveTheme.swift", ROOT / "UI/WeftIcon.swift", ROOT.parent.parent / "design/tokens/generated/apple/DesignTokens.swift"]
        if name == "AppleTimelineStateChecks":
            sources.append(ROOT / "UI/ConversationResourcesModel.swift")
        if name == "DesignTokenChecks":
            sources.append(ROOT.parent.parent / "design/tokens/generated/apple/DesignTokens.swift")
        sources.append(ROOT / "Tests" / (name + ".swift"))
        compile_command = ["swiftc", "-swift-version", "6", "-D", "DEBUG", "-parse-as-library",
                           "-I", str(products / "Modules"), *map(str, sources),
                           *map(str, objects), "-o", str(executable)]
        start = time.monotonic()
        with (run / (name + "-compile.log")).open("w") as log:
            compiled = subprocess.run(compile_command, stdout=log, stderr=subprocess.STDOUT)
        row = {"check": name, "compileCommand": compile_command, "compileExit": compiled.returncode}
        if compiled.returncode == 0:
            data = run / (name + "-data")
            data.mkdir(mode=0o700)
            command = [str(executable), str(data)]
            with (run / (name + ".log")).open("w") as log:
                tested = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT,
                                        env={**os.environ, "TMPDIR": str(data) + "/"})
            row.update(runCommand=command, runExit=tested.returncode)
        row["seconds"] = round(time.monotonic() - start, 2)
        results.append(row)
        (run / "results.json").write_text(json.dumps(results, indent=2) + "\n")
        passed = row["compileExit"] == 0 and row.get("runExit") == 0
        print(f"{'PASS' if passed else 'FAIL'} {name} ({row['seconds']}s)", flush=True)
    return int(any(row["compileExit"] != 0 or row.get("runExit") != 0 for row in results))


if __name__ == "__main__":
    raise SystemExit(main())
