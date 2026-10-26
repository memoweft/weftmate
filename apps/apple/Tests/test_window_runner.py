import subprocess
import sys
import unittest
import tempfile
import json
import io
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Scripts"))
from bounded_process import run_bounded
import run_window_checks


class WindowRunnerTests(unittest.TestCase):
    def test_exit_and_captured_output(self):
        result = run_bounded([sys.executable, "-c", "print('synthetic'); raise SystemExit(7)"], stdout=subprocess.PIPE, text=True)
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout.strip(), "synthetic")

    def test_timeout_returns_control(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            run_bounded([sys.executable, "-c", "import time; time.sleep(30)"], timeout=0.1)

    def test_failed_core_does_not_boot_simulator(self):
        calls = []

        def run(command, **kwargs):
            calls.append(command)
            if command[:3] == ["xcrun", "simctl", "list"]:
                return subprocess.CompletedProcess(command, 0, json.dumps({"devices": {"synthetic-runtime": [{"udid": "synthetic-uuid", "name": "apple-1-window-test"}]}}))
            return subprocess.CompletedProcess(command, 1 if command[:2] == ["swift", "test"] else 0)

        with tempfile.TemporaryDirectory(prefix="apple-1-window-runner-") as directory:
            with patch.object(sys, "argv", ["run_window_checks.py", "--phase", "all", "--phone-id", "synthetic-uuid", "--artifacts", directory]), \
                 patch.object(run_window_checks.platform, "system", return_value="Darwin"), \
                 patch.object(run_window_checks, "diagnostics", return_value=set()), \
                 patch.object(run_window_checks, "run_bounded", side_effect=run), redirect_stdout(io.StringIO()):
                self.assertEqual(run_window_checks.main(), 1)
        self.assertFalse(any("phone-ui" in str(command) or "test" in command and "xcodebuild" in command for command in calls))


if __name__ == "__main__":
    unittest.main()
