"""Offline distribution probe, including a real subprocess RPC v2 exchange."""
import importlib.metadata
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import ctypes

root, mode = Path(sys.argv[1]).resolve(), sys.argv[2]
lock = json.loads((root / "runtime-lock.json").read_text())
assert sys.version.split()[0] == lock["python"]["version"]
assert sys.flags.isolated and sys.dont_write_bytecode
assert all(Path(p).is_relative_to(root) for p in sys.path)
import memoweft, sqlite3, ssl, httpx, regex
for item in lock["dependencies"]:
    if item["layer"] == "base" or mode == "full":
        assert importlib.metadata.version(item["name"]) == item["version"]

def deny_network(*args, **kwargs):
    raise AssertionError("offline payload attempted a network connection")

socket.socket.connect = deny_network
socket.create_connection = deny_network
os.environ["MEMOWEFT_SEMANTIC_CACHE_DIR"] = str(root / "models")
if mode == "full":
    import numpy, onnxruntime, tokenizers
    from memoweft.semantic.model import E5Encoder
    vector = E5Encoder(root / "models", threading.Event()).encode(["Synthetic person likes jasmine tea."])
    assert vector.shape == (1, 384) and numpy.isfinite(vector).all()
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetModuleHandleW.restype = ctypes.c_void_p
    kernel.GetModuleHandleW.argtypes = [ctypes.c_wchar_p]
    kernel.GetModuleFileNameW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint32]
    for name in ("msvcp140.dll", "msvcp140_1.dll", "vcruntime140.dll", "vcruntime140_1.dll"):
        handle = kernel.GetModuleHandleW(name)
        assert handle, name
        path = ctypes.create_unicode_buffer(32768)
        assert kernel.GetModuleFileNameW(handle, path, len(path))
        assert Path(path.value).resolve() == root / "python" / name, name

# Run the exact Core module in a separate managed interpreter. Install the
# network guard before run_module so a missing model cannot download silently.
code = "import socket,runpy; socket.socket.connect=lambda *a,**k: (_ for _ in ()).throw(RuntimeError('offline RPC network attempt')); runpy.run_module('memoweft.integrations.dsh_bridge',run_name='__main__')"
with tempfile.TemporaryDirectory(prefix="memory-runtime-probe-") as home:
    requests = [("capabilities", {}), ("initialize", {"session_id": "synthetic-session", "dsh_home": home, "platform": "windows-package-probe", "subject_id": "synthetic-subject", "auto_route": False}), ("health", {}), ("shutdown", {})]
    frames = [{"protocol": lock["protocol"]["name"], "protocol_version": 2, "schema_version": 1, "request_id": str(i), "method": method, "params": params} for i, (method, params) in enumerate(requests)]
    p = subprocess.run([sys.executable, "-B", "-c", code], input="".join(json.dumps(x)+"\n" for x in frames), text=True, capture_output=True, timeout=60, cwd=home)
    assert p.returncode == 0, p.stderr
    replies = [json.loads(line) for line in p.stdout.splitlines()]
    assert len(replies) == len(frames)
    for request, response in zip(frames, replies):
        assert response["request_id"] == request["request_id"] and response["ok"] is True, response
        assert response["protocol_version"] == 2 and response["schema_version"] == 1
    assert Path(home, "memoweft/memoweft.sqlite3").is_file()
print(json.dumps({"isolated": True, "bytecodeDisabled": True, "offlineImports": True, "rpc": [x[0] for x in requests], "encodingDimensions": 384 if mode == "full" else None, "appLocalCrt": mode == "full"}))
