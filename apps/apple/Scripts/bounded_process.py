"""Bound Apple checks and reap only the process group started by this invocation."""
import os
import signal
import subprocess


def run_bounded(command, *, timeout=1200, check=False, **kwargs):
    environment = dict(kwargs.pop("env", os.environ))
    owns_group = os.name == "posix" and environment.get("WEFTMATE_TEST_PROCESS_GROUP") != "1"
    environment["WEFTMATE_TEST_PROCESS_GROUP"] = "1"
    process = subprocess.Popen(command, env=environment, start_new_session=owns_group, **kwargs)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
        result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
        if check:
            result.check_returncode()
        return result
    finally:
        if owns_group:
            for sig in [signal.SIGTERM, signal.SIGKILL]:
                try:
                    os.killpg(process.pid, sig)
                except ProcessLookupError:
                    break
                if sig == signal.SIGTERM:
                    # Reap the group leader before escalating. Darwin reports
                    # EPERM for a process group containing only its zombie.
                    try:
                        process.wait(timeout=0.2)
                    except subprocess.TimeoutExpired:
                        pass
        elif process.poll() is None:
            process.kill()
        process.wait()
