"""Test-only sitecustomize: phase times, no source text, no behavior changes."""
import functools
import json
import os
import time

from memoweft.integrations.hermes.batch_adapter import HermesBatchAdapterProcessor


def instrument(name):
    original = getattr(HermesBatchAdapterProcessor, name)
    @functools.wraps(original)
    def measured(*args, **kwargs):
        start = time.time_ns()
        try:
            return original(*args, **kwargs)
        finally:
            with open(os.environ["MF1_CORE_PHASES"], "a", encoding="utf-8") as output:
                output.write(json.dumps({"phase": name, "startEpochMs": start / 1e6,
                                         "endEpochMs": time.time_ns() / 1e6}) + "\n")
    setattr(HermesBatchAdapterProcessor, name, measured)


for method in ("_dispatch_once", "_compile_checked", "_apply_atomically"):
    instrument(method)
