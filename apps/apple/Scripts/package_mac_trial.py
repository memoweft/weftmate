#!/usr/bin/env python3
"""Build and verify a local Mac trial DMG without installing over an existing app.

This produces a host-architecture Release app using Xcode's existing ad-hoc
signature. It is a local trial, not a notarized public distribution. All build,
mount, and trial-copy directories are fresh and outside the source tree.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import subprocess
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source_root = root.parents[1]
    artifacts = args.artifacts.resolve()
    if artifacts.is_relative_to(source_root):
        parser.error("Trial artifacts must be outside the source tree.")
    architecture = platform.machine()
    if platform.system() != "Darwin" or architecture not in {"x86_64", "arm64"}:
        parser.error("Run this script on the Mac that will try the app.")
    artifacts.mkdir(parents=True, exist_ok=True, mode=0o700)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    run_dir = artifacts / ("MacTrial-" + run_id)
    run_dir.mkdir(mode=0o700)
    derived = run_dir / "DerivedData"
    staging = run_dir / "DMGContents"
    staging.mkdir()
    trial = run_dir / "TrialInstall"
    trial.mkdir()
    mount = run_dir / "Mount"
    mount.mkdir()

    def run(command, log_name, check=True):
        with (run_dir / log_name).open("x") as log:
            completed = subprocess.run(command, cwd=root, stdout=log, stderr=subprocess.STDOUT, text=True)
        if check and completed.returncode:
            raise SystemExit(f"Command failed ({completed.returncode}); see {run_dir / log_name}")
        return completed.returncode

    print("Local trial directory: " + str(run_dir), flush=True)
    run(["xcodebuild", "-project", str(root / "WeftMate.xcodeproj"), "-scheme", "WeftMateMac",
         "-configuration", "Release", "-destination", f"platform=macOS,arch={architecture}",
         "-derivedDataPath", str(derived), "ARCHS=" + architecture, "ONLY_ACTIVE_ARCH=YES",
         "DEVELOPMENT_TEAM=", "CODE_SIGN_IDENTITY=-", "build"], "build-release.log")
    built = derived / "Build/Products/Release/WeftMateMac.app"
    app = staging / "WeftMateMac.app"
    run(["ditto", str(built), str(app)], "copy-app.log")
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    identifier = info["CFBundleIdentifier"]
    if identifier != "com.weftmate.apple.weftmatemac":
        raise SystemExit("Unexpected bundle identity; trial packaging stopped.")
    executable = app / "Contents/MacOS" / info["CFBundleExecutable"]
    run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)], "codesign-verify.log")
    run(["codesign", "-d", "--verbose=4", "-r-", str(app)], "codesign-details.log")
    run(["codesign", "-d", "--xml", "--entitlements", "-", str(app)], "codesign-entitlements.log")
    signed_entitlements = (run_dir / "codesign-entitlements.log").read_bytes()
    start = signed_entitlements.find(b"<?xml")
    end = signed_entitlements.find(b"</plist>", start)
    entitlements = plistlib.loads(signed_entitlements[start:end + len(b"</plist>")]) if start >= 0 and end >= 0 else {}
    if entitlements.get("com.apple.security.app-sandbox") is not True or entitlements.get("com.apple.security.network.client") is not True:
        raise SystemExit("Required sandbox/network entitlements missing.")
    run(["lipo", "-archs", str(executable)], "architecture.log")
    if (run_dir / "architecture.log").read_text().strip() != architecture:
        raise SystemExit("Unexpected executable architecture.")
    readme = """WeftMate Mac 本机试用

本包为这台 Mac 构建的原生 Release 应用，使用本地 ad-hoc 签名。
它不是已公证的公开发行版本；不提供 iPhone 或 Apple Watch 安装包。

手动安装：退出正在运行的 WeftMate，将 WeftMateMac.app 拖到你选择的文件夹。
首次试用可放在单独文件夹；替换旧版前保留旧应用。不要删除用户资料或钥匙串。
本安装包不自动安装、不自动启动、不卸载、不清空应用数据。

默认服务器为 https://home.weftmate.com:8443，使用正常 TLS 校验。
没有签名的公网分发许可或公证，不能据此声称可在其他 Mac 无提示安装。

当前草稿只保存在内存，退出应用会丢失未保存草稿。
保持 bundle ID 不等于已验证跨版本 Keychain 访问：本地 ad-hoc 签名要求随代码变化，
账户与设备身份保留需另行真实覆盖验证。原历史由同一账户从服务端读取。
"""
    (staging / "安装说明.txt").write_text(readme)
    os.symlink("/Applications", staging / "Applications")
    version, build = info["CFBundleShortVersionString"], info["CFBundleVersion"]
    dmg = run_dir / f"WeftMate-Mac-{version}-{build}-{architecture}-local.dmg"
    run(["hdiutil", "create", "-srcfolder", str(staging), "-volname", "WeftMate Mac Trial",
         "-format", "UDZO", "-ov", str(dmg)], "dmg-create.log")
    run(["hdiutil", "verify", str(dmg)], "dmg-verify.log")
    run(["hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", str(mount), str(dmg)], "dmg-attach.log")
    executable_hash = hashlib.sha256(executable.read_bytes()).hexdigest()
    try:
        mounted_app = mount / "WeftMateMac.app"
        run(["codesign", "--verify", "--deep", "--strict", str(mounted_app)], "mounted-codesign-verify.log")
        run(["ditto", str(mounted_app), str(trial / "WeftMateMac.app")], "trial-copy.log")
        run(["codesign", "--verify", "--deep", "--strict", str(trial / "WeftMateMac.app")], "trial-codesign-verify.log")
        for copy in [mounted_app, trial / "WeftMateMac.app"]:
            copied_executable = copy / "Contents/MacOS" / info["CFBundleExecutable"]
            if hashlib.sha256(copied_executable.read_bytes()).hexdigest() != executable_hash:
                raise SystemExit("Mounted or trial-copy executable differs from the built candidate.")
        if not (mount / "安装说明.txt").is_file() or not (mount / "Applications").is_symlink():
            raise SystemExit("DMG content check failed.")
    finally:
        run(["hdiutil", "detach", str(mount)], "dmg-detach.log")
    assessment = run(["spctl", "--assess", "--type", "execute", "--verbose=4", str(trial / "WeftMateMac.app")],
                     "gatekeeper-assessment.log", check=False)
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source_root, text=True).strip()
    dirty = subprocess.check_output(["git", "status", "--porcelain"], cwd=source_root, text=True).splitlines()
    manifest = {
        "sourceHead": head, "sourceWorkingTreeStatus": dirty,
        "bundleIdentifier": identifier, "version": version, "build": build,
        "architecture": architecture, "configuration": "Release",
        "signature": "ad-hoc", "notarized": False,
        "dmg": str(dmg), "dmgBytes": dmg.stat().st_size,
        "dmgSHA256": hashlib.sha256(dmg.read_bytes()).hexdigest(),
        "executableSHA256": executable_hash,
        "trialApp": str(trial / "WeftMateMac.app"),
        "dmgVerified": True, "mountedSignatureVerified": True, "trialSignatureVerified": True,
        "gatekeeperAssessmentExit": assessment,
        "defaultServer": "https://home.weftmate.com:8443",
        "launched": False, "installedOverExistingApp": False,
        "crossVersionCredentialRetentionVerified": False,
        "persistentDraftsImplemented": False,
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(manifest, indent=2, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
