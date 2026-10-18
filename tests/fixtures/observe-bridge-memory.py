"""Opt-in numeric side observation of the real bridge; preserve every outcome."""
import ctypes
import gc
import json
import os
import tracemalloc

try:
    if os.environ.get("WEFTMATE_BRIDGE_MEMORY_SAMPLE"):
        from memoweft.integrations.dsh_bridge.protocol_v2 import DshRpcV2Server

        original = DshRpcV2Server.handle
        reads = 0
        tracemalloc.start(1)

        def observed(self, request):
            global reads
            try:
                return original(self, request)
            finally:
                try:
                    if request.get("method") == "query_evidence":
                        reads += 1
                        if reads in (80, 320):
                            gc.collect()
                            heap, peak = tracemalloc.get_traced_memory()
                            private = working_set = None
                            if os.name == "nt":
                                class Counters(ctypes.Structure):
                                    _fields_ = [("cb", ctypes.c_ulong), ("faults", ctypes.c_ulong)] + [
                                        (name, ctypes.c_size_t) for name in (
                                            "peak_ws", "ws", "peak_paged", "paged", "peak_nonpaged",
                                            "nonpaged", "commit", "peak_commit", "private")]
                                counters = Counters()
                                counters.cb = ctypes.sizeof(counters)
                                if ctypes.windll.psapi.GetProcessMemoryInfo(
                                    ctypes.c_void_p(-1), ctypes.byref(counters), counters.cb
                                ):
                                    private, working_set = counters.private, counters.ws
                            with open(os.environ["WEFTMATE_BRIDGE_MEMORY_SAMPLE"], "a", encoding="utf-8") as output:
                                output.write(json.dumps(dict(reads=reads, heap=heap, peak=peak,
                                    private=private, working_set=working_set)) + "\n")
                except BaseException:
                    pass

        DshRpcV2Server.handle = observed
except BaseException:
    pass
