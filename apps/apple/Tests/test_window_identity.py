"""Exercise the project generator in a temporary source tree, including Windows path output."""
import runpy
import shutil
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree


class WindowIdentityProjectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="apple-1-window-project-")
        cls.root = Path(cls.temp.name)
        scripts = cls.root / "Scripts"
        scripts.mkdir()
        source = Path(__file__).resolve().parents[1] / "Scripts/generate_project.py"
        shutil.copyfile(source, scripts / source.name)
        for directory in ["UI", "iOS", "macOS", "watchOS"]:
            (cls.root / directory).mkdir()
            (cls.root / directory / "Synthetic.swift").write_text("// synthetic\n", encoding="utf-8")
        cls.generated = runpy.run_path(str(scripts / source.name))
        cls.objects = cls.generated["OBJECTS"]

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def settings(self, target, config):
        return self.objects[self.generated["ident"](target + ":config:" + config)]["buildSettings"]

    def test_isolated_phone_watch_identity_and_companion_match(self):
        for configuration in ["DebugWindowTest", "WindowTestRelease"]:
            phone = self.settings("WeftMatePhone", configuration)
            watch = self.settings("WeftMateWatch", configuration)
            self.assertEqual(phone["PRODUCT_BUNDLE_IDENTIFIER"], "com.weftmate.apple.windowtest")
            self.assertEqual(watch["PRODUCT_BUNDLE_IDENTIFIER"], "com.weftmate.apple.windowtest.watch")
            self.assertEqual(watch["INFOPLIST_KEY_WKCompanionAppBundleIdentifier"], phone["PRODUCT_BUNDLE_IDENTIFIER"])
            for settings in [phone, watch]:
                self.assertEqual(settings["INFOPLIST_KEY_CFBundleDisplayName"], "WeftMate 苹果测试")
            if configuration == "WindowTestRelease":
                self.assertEqual(phone["CODE_SIGN_ENTITLEMENTS"], "Config/WeftMatePhoneHealth.entitlements")
                self.assertEqual(watch["CODE_SIGN_ENTITLEMENTS"], "Config/WeftMateHealth.entitlements")

    def test_existing_identity_and_test_schemes(self):
        self.assertEqual(self.settings("WeftMatePhone", "Release")["PRODUCT_BUNDLE_IDENTIFIER"], "com.weftmate.apple.weftmatephone")
        scheme = ElementTree.parse(self.root / "WeftMate.xcodeproj/xcshareddata/xcschemes/WeftMateMacWindowTest.xcscheme")
        self.assertEqual(scheme.find("TestAction").get("buildConfiguration"), "DebugWindowTest")
        self.assertEqual(scheme.find("ArchiveAction").get("buildConfiguration"), "WindowTestRelease")

    def test_source_paths_and_window_ui_registration(self):
        paths = [item["path"] for item in self.objects.values() if item.get("isa") == "PBXFileReference"]
        self.assertIn("iOS/Synthetic.swift", paths)
        self.assertIn("Tests/PhoneWindowUITests.swift", paths)
        self.assertNotIn("iOS/PhoneMemoryScreenshotFixture.swift", paths)
        self.assertTrue(all("\\" not in path for path in paths))


if __name__ == "__main__":
    unittest.main()
