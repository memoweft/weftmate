#!/usr/bin/env python3
"""One headless simulator batch for IOS-UI-2, with bounded Xcode/fixture processes."""
import argparse
import json
from pathlib import Path
import plistlib
import shutil
import subprocess

from run_ci_ui_tests import run, start_node, stop
from run_phone_window_checks import diagnostics

ROOT = Path(__file__).resolve().parents[1]
LIMITS = ["-jobs", "4", "-parallel-testing-enabled", "NO",
          "-maximum-concurrent-test-simulator-destinations", "1"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True, help="The one selected iPhone simulator UDID")
    parser.add_argument("--derived-data", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    artifacts = args.artifacts.resolve()
    if artifacts.is_relative_to(ROOT.parents[1]):
        parser.error("Keep simulator evidence outside the repository")
    artifacts.mkdir(parents=True, exist_ok=True)
    artifacts.chmod(0o700)
    before = diagnostics()
    processes, logs = [], []
    private_run = None
    base = ["xcodebuild", *LIMITS, "-destination", "platform=iOS Simulator,id=" + args.device,
            "-destination-timeout", "120", "-test-timeouts-enabled", "YES",
            "-default-test-execution-time-allowance", "180",
            "-maximum-test-execution-time-allowance", "300"]
    bundle = artifacts / "chat.xcresult"
    code = 1
    missing_screens = None
    try:
        build_code = run([*base, "-project", "WeftMate.xcodeproj", "-scheme", "WeftMatePhoneWindowTest",
                    "-configuration", "Debug", "-derivedDataPath", str(args.derived_data.resolve()),
                    "CODE_SIGNING_ALLOWED=NO", "build-for-testing"], artifacts / "build.log", 1800)
        if build_code:
            code = build_code
            return code
        products = args.derived_data.resolve() / "Build/Products"
        source = next(products.glob("WeftMatePhoneWindowTest_*.xctestrun"))
        payload = plistlib.loads(source.read_bytes())
        config = start_node("apple3_host_fixture.mjs", artifacts, processes, logs)
        targets = ([target for item in payload["TestConfigurations"] for target in item.get("TestTargets", [])]
                   if "TestConfigurations" in payload else [value for key, value in payload.items() if not key.startswith("__")])
        for target in targets:
            target.setdefault("EnvironmentVariables", {})["WEFTMATE_APPLE3_ORIGIN"] = config["origin"]
        private_run = products / "ios-ui-2-private.xctestrun"
        private_run.write_bytes(plistlib.dumps(payload)); private_run.chmod(0o600)
        subprocess.run(["xcrun", "simctl", "boot", args.device], timeout=30, check=False, capture_output=True)
        subprocess.run(["xcrun", "simctl", "bootstatus", args.device, "-b"], timeout=180, check=True,
                       stdout=subprocess.DEVNULL)
        code = run([*base, "-xctestrun", str(private_run), "-resultBundlePath", str(bundle),
                    "-only-testing:WeftMatePhoneWindowTestUITests/IOSUIShellUITests",
                    "-only-testing:WeftMatePhoneWindowTestUITests/IOSUIChatUITests",
                    "test-without-building"], artifacts / "ui.log", 2400)
        if bundle.exists():
            run(["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(bundle)],
                artifacts / "summary.json", 60)
            run(["xcrun", "xcresulttool", "export", "attachments", "--path", str(bundle),
                 "--output-path", str(artifacts / "screens")], artifacts / "export.log", 60)
            manifest = artifacts / "screens/manifest.json"
            named = artifacts / "screens/named"
            named.mkdir(exist_ok=True)
            pages = ["chat", "conversations", "search", "history", "work", "projects", "resources", "task"]
            names = {page + "-" + theme for page in pages for theme in ["light", "dark"]}
            if manifest.exists():
                for item in json.loads(manifest.read_text()):
                    for attachment in item.get("attachments", []):
                        name = attachment["suggestedHumanReadableName"].split("_0_")[0]
                        if name in names:
                            shutil.copyfile(artifacts / "screens" / attachment["exportedFileName"], named / (name + ".png"))
            comparisons = []
            for name in sorted(names):
                native = named / (name + ".png")
                reference = ROOT.parents[1] / "design/ios/screens" / (name + ".png")
                comparisons.append("<h2>" + name + "</h2><div class='pair'><figure><figcaption>本人定稿</figcaption><img src='" + reference.as_uri() + "'></figure><figure><figcaption>原生模拟器</figcaption>" +
                                   ("<img src='" + native.as_uri() + "'>" if native.exists() else "<p>未取得截图，待查</p>") + "</figure></div>")
            missing_screens = sorted(name for name in names if not (named / (name + ".png")).exists())
            (artifacts / "comparison.html").write_text("<!doctype html><meta charset='utf-8'><style>body{font-family:system-ui}.pair{display:flex;gap:24px}figure{margin:0;width:393px}img{width:100%}</style>" + "".join(comparisons))
        return code
    finally:
        for process in processes:
            stop(process)
        for stream in logs:
            stream.close()
        if private_run is not None:
            private_run.unlink(missing_ok=True)
        # A failed build never boots a simulator.
        if private_run is not None:
            subprocess.run(["xcrun", "simctl", "shutdown", "all"], timeout=30, check=False)
        after = diagnostics()
        known = before.get("available") and after.get("available")
        changed = [name for name, signature in after.get("files", {}).items()
                   if signature != before.get("files", {}).get(name)] if known else None
        (artifacts / "result.json").write_text(json.dumps({
            "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
            "exitCode": 1 if changed or missing_screens else code, "uiExitCode": code, "device": args.device, "diagnosticsMeasured": bool(known),
            "newDiagnosticReports": changed, "nativeScreensCompared": False,
            "missingScreens": missing_screens,
        }, ensure_ascii=False, indent=2) + "\n")
        if changed and any("gpuRestart" in name for name in changed):
            print("New gpuRestart report: stop here; wait ten minutes before another simulator batch.")
        if changed or missing_screens:
            raise SystemExit(1)


if __name__ == "__main__":
    raise SystemExit(main())
