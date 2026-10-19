import json
from pathlib import Path
import tempfile
import unittest

from write_ci_summary import markdown, state_report, ui_report


class SummaryTests(unittest.TestCase):
    def test_xctest_totals_and_duplicate_assertions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "batches.json").write_text(json.dumps([{"batch": "local", "exitCode": 65}]))
            (root / "local-summary.json").write_text(json.dumps(dict(
                passedTests=8, failedTests=26, skippedTests=4, totalTestCount=38,
                devicesAndConfigurations=[dict(passedTests=8, failedTests=26, skippedTests=4)],
                testFailures=[{"testIdentifierString": "Example/testFailure()"}] * 2)))
            report = ui_report(root, "local", "failure")
        self.assertEqual((report["passed"], report["failed"], report["skipped"]), (8, 26, 4))
        self.assertEqual(report["failures"], ["Example/testFailure()"])
        self.assertEqual(report["blocked"], [])

    def test_preparation_failure_is_unmeasured_not_a_skip(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "batches.json").write_text(json.dumps([
                {"batch": "a14", "exitCode": 1, "tests": ["A14OfflineUITests/testOffline"]}]))
            report = ui_report(root, "host-modern", "failure")
        self.assertEqual((report["passed"], report["failed"], report["skipped"]), (0, 0, 0))
        self.assertEqual(report["blocked"], ["A14OfflineUITests/testOffline"])
        self.assertIn("A14OfflineUITests/testOffline", markdown([report]))

    def test_missing_and_partial_results_stay_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = ui_report(root, "cloud", "skipped")
            self.assertIn("No batch results", report["problems"][0])
            (root / "batches.json").write_text(json.dumps([
                {"batch": "one", "exitCode": 124, "timedOut": True}]))
            (root / "one-summary.json").write_text(json.dumps(dict(
                passedTests=1, failedTests=0, skippedTests=0, totalTestCount=2)))
            report = ui_report(root, "cloud", "failure")
        self.assertEqual(len(report["problems"]), 3)
        text = markdown([report], missing=["local"], gates=("success", "success"))
        self.assertIn("Missing report: local", text)
        self.assertIn("remaining tests are unmeasured", text)

    def test_state_failure_and_unrun_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state/run"
            state.mkdir(parents=True)
            (state / "results.json").write_text(json.dumps([
                {"check": "AppleAdoptionStateChecks", "compileExit": 0, "runExit": -5},
                {"check": "AppleSendStateChecks", "compileExit": 1}]))
            report = state_report(root, "failure")
        self.assertEqual((report["passed"], report["failed"], report["skipped"]), (0, 2, 0))
        self.assertEqual(len(report["blocked"]), 20)
        self.assertEqual(report["failures"], ["AppleAdoptionStateChecks", "AppleSendStateChecks"])


if __name__ == "__main__":
    unittest.main()
