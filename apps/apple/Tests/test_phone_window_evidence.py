"""The diagnostic collector must distinguish measured zero from unavailable."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Scripts"))
from run_phone_window_checks import diagnostics


class DiagnosticEvidenceTests(unittest.TestCase):
    def test_absent_directory_is_unknown(self):
        with tempfile.TemporaryDirectory(prefix="apple-window-evidence-") as directory:
            result = diagnostics(Path(directory) / "absent")
            self.assertFalse(result["available"])
            self.assertNotIn("files", result)

    def test_collects_only_relevant_reports_including_nested_reports(self):
        with tempfile.TemporaryDirectory(prefix="apple-window-evidence-") as directory:
            root = Path(directory)
            self.assertEqual(diagnostics(root), {"available": True, "files": {}})
            (root / "nested").mkdir()
            (root / "nested/WeftMatePhone-synthetic.ips").write_text("synthetic")
            (root / "gpuRestart-synthetic.ips").write_text("synthetic gpu")
            (root / "OtherApp.ips").write_text("not relevant")
            result = diagnostics(root)
            self.assertTrue(result["available"])
            self.assertEqual(set(result["files"]), {"nested/WeftMatePhone-synthetic.ips", "gpuRestart-synthetic.ips"})


if __name__ == "__main__":
    unittest.main()
