"""Exercise the real project generator in a disposable source tree (stdlib only)."""
import contextlib
import io
from pathlib import Path
import runpy
import shutil
import tempfile
import unittest

GENERATOR = Path(__file__).resolve().parents[1] / "Scripts/generate_project.py"


class WindowProjectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="apple-window-project-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "Scripts").mkdir()
        shutil.copyfile(GENERATOR, self.root / "Scripts/generate_project.py")
        (self.root / "UI/Nested").mkdir(parents=True)
        (self.root / "UI/Nested/Example.swift").write_text("// synthetic\n")
        with contextlib.redirect_stdout(io.StringIO()):
            self.generated = runpy.run_path(str(self.root / "Scripts/generate_project.py"))
        self.objects = self.generated["OBJECTS"]

    def target(self, name):
        return self.objects[self.generated["ident"]("target:" + name)]

    def settings(self, name):
        configs = self.objects[self.target(name)["buildConfigurationList"]]["buildConfigurations"]
        return [self.objects[key]["buildSettings"] for key in configs]

    def test_candidate_is_phone_only_and_keeps_native_targets(self):
        candidate = self.target("WeftMatePhoneWindowTest")
        self.assertEqual(candidate["dependencies"], [])
        phases = [self.objects[key]["isa"] for key in candidate["buildPhases"]]
        self.assertNotIn("PBXCopyFilesBuildPhase", phases)
        for settings in self.settings("WeftMatePhoneWindowTest"):
            self.assertEqual(settings["PRODUCT_BUNDLE_IDENTIFIER"], "com.weftmate.apple.windowtest")
            self.assertEqual(settings["INFOPLIST_KEY_CFBundleDisplayName"], "WeftMate 苹果测试")
            self.assertEqual(settings["INFOPLIST_FILE"], "Config/PhoneWindowInfo.plist")
            self.assertNotIn("CODE_SIGN_ENTITLEMENTS", settings)
            self.assertNotIn("INFOPLIST_KEY_NSHealthShareUsageDescription", settings)
            self.assertIn("WEFTMATE_WINDOW_TEST", settings["SWIFT_ACTIVE_COMPILATION_CONDITIONS"])
        self.assertTrue(self.target("WeftMatePhone")["dependencies"])
        self.assertTrue(self.settings("WeftMatePhone")[0]["CODE_SIGN_ENTITLEMENTS"])
        self.target("WeftMateMac")
        self.target("WeftMateWatch")
        self.assertEqual(len(self.target("WeftMatePhoneWindowTestUITests")["dependencies"]), 1)

    def test_source_paths_are_portable_and_generation_is_repeatable(self):
        self.assertIn("UI/Nested/Example.swift", [o.get("path") for o in self.objects.values()])
        project = self.root / "WeftMate.xcodeproj"
        before = {p.relative_to(project): p.read_bytes() for p in project.rglob("*") if p.is_file()}
        with contextlib.redirect_stdout(io.StringIO()):
            runpy.run_path(str(self.root / "Scripts/generate_project.py"))
        after = {p.relative_to(project): p.read_bytes() for p in project.rglob("*") if p.is_file()}
        self.assertEqual(before, after)
        scheme = (project / "xcshareddata/xcschemes/WeftMatePhoneWindowTest.xcscheme").read_text(encoding="utf-8")
        self.assertIn('BlueprintName="WeftMatePhoneWindowTestUITests"', scheme)


if __name__ == "__main__":
    unittest.main()
