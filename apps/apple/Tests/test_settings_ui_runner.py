"""Validate native result counts and the Mac's mandatory simulator cooldown."""
import io
import json
from pathlib import Path
import plistlib
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Scripts"))
import run_ci_ui_tests as runner


class SettingsUIRunnerTests(unittest.TestCase):
    def result(self, summary):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "native.xcresult").mkdir()

            def run(command, log, timeout):
                if command[:2] == ["xcrun", "xcresulttool"] and summary is not None:
                    log.write_text(json.dumps(summary))
                return 0

            with patch.object(runner, "run", side_effect=run):
                return runner.test_run(["xcodebuild"], plistlib.dumps({"Tests": {}}),
                    root / "private.xctestrun", ["IOSUISettingsUITests/testSettingsSystemAndAppearanceAreReachableInBothThemes"],
                    {}, root, "native", strict=True)

    def test_zero_skipped_failed_or_unknown_is_not_native_acceptance(self):
        for counts in [dict(passedTests=0, failedTests=0, skippedTests=0),
                       dict(passedTests=1, failedTests=0, skippedTests=1),
                       dict(passedTests=1, failedTests=1, skippedTests=0), None]:
            with self.subTest(counts=counts):
                self.assertEqual(self.result(counts)["exitCode"], 1)

    def test_exact_nonzero_native_count_is_accepted(self):
        result = self.result(dict(passedTests=1, failedTests=0, skippedTests=0))
        self.assertEqual(result["exitCode"], 0)
        self.assertEqual(result["expectedTests"], 1)

    def snapshot(self, gpu=False, available=True):
        return {"user": {"available": available, "files": {}},
                "system": {"available": True, "files": {"gpuRestart.ips": [1, 1]} if gpu else {}}}

    def test_clean_batch_shuts_down_all_and_rests_three_minutes(self):
        waits = []
        with patch.object(runner, "diagnostic_snapshot", return_value=self.snapshot()), \
             patch.object(runner.subprocess, "run") as shutdown, \
             patch.object(runner.time, "sleep", side_effect=waits.append), redirect_stdout(io.StringIO()):
            result = runner.finish_settings_batch(self.snapshot())
        self.assertEqual(shutdown.call_args.args[0], ["xcrun", "simctl", "shutdown", "all"])
        self.assertEqual(sum(waits), 180)
        self.assertEqual(result["newGPU"], [])
        self.assertTrue(result["available"])

    def test_gpu_report_arriving_during_cooldown_extends_it_to_ten_minutes(self):
        waits, scans = [], 0

        def reports():
            nonlocal scans
            scans += 1
            return self.snapshot(gpu=scans >= 3)

        with patch.object(runner, "diagnostic_snapshot", side_effect=reports), \
             patch.object(runner.subprocess, "run"), \
             patch.object(runner.time, "sleep", side_effect=waits.append), redirect_stdout(io.StringIO()):
            result = runner.finish_settings_batch(self.snapshot())
        self.assertEqual(sum(waits), 600)
        self.assertEqual(result["newGPU"], ["gpuRestart.ips"])
        self.assertEqual(result["cooldownSeconds"], 600)

    def test_unreadable_diagnostic_inventory_stays_unknown(self):
        waits = []
        with patch.object(runner, "diagnostic_snapshot", return_value=self.snapshot(available=False)), \
             patch.object(runner.subprocess, "run"), \
             patch.object(runner.time, "sleep", side_effect=waits.append), redirect_stdout(io.StringIO()):
            result = runner.finish_settings_batch(self.snapshot())
        self.assertFalse(result["available"])
        self.assertEqual(sum(waits), 600)


if __name__ == "__main__":
    unittest.main()
