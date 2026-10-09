"""Extract timings/failure checkpoints from explicitly named synthetic databases."""
import json
from contextlib import ExitStack
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile

results = []
for raw in sys.argv[1:]:
    root = Path(raw).resolve()
    if not root.name.startswith(("weftmate-mf1-", "weftmate-m2f-", "weftmate-m2-exit-")):
        raise ValueError("only MF-1 synthetic roots are accepted")
    for accounts in (root / "accounts", root / "profile" / "personal-access" / "accounts"):
        if not accounts.is_dir():
            continue
        for account in accounts.iterdir():
            db_path = account / "memory-home" / "memoweft" / "memoweft.sqlite3"
            if not db_path.is_file():
                continue
            with ExitStack() as cleanup:
                db = sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True)
                cleanup.callback(db.close)
                recovery = None
                try:
                    db.execute("SELECT count(*) FROM memory_world_job").fetchone()
                except sqlite3.OperationalError as error:
                    if "readonly" not in str(error):
                        raise
                    # An intentionally stopped fixture can leave a hot journal.
                    # Recover only a temporary copy; preserve the failed original.
                    db.close()
                    copied = Path(cleanup.enter_context(tempfile.TemporaryDirectory(prefix="weftmate-mf1-sqlite-read-"))).resolve()
                    assert copied.parent == Path(tempfile.gettempdir()).resolve()
                    target = copied / db_path.name
                    for suffix in ("", "-journal", "-wal", "-shm"):
                        source = Path(str(db_path) + suffix)
                        if source.exists():
                            shutil.copyfile(source, Path(str(target) + suffix))
                    db = sqlite3.connect(target)
                    cleanup.callback(db.close)
                    recovery = "copied_sqlite_recovery; original and journal preserved"
                db.row_factory = sqlite3.Row
                jobs = []
                for row in db.execute("SELECT job_id, parent_session_id, boundary_event_id, evidence_ids_json, state, attempts, created_at, claimed_at, model_dispatch_started_at, model_completed_at, completed_at, model_result_json, world_result_json FROM memory_world_job ORDER BY created_at, rowid"):
                    item = dict(row)
                    item["sources"] = [r[0] for evidence_id in json.loads(item.pop("evidence_ids_json")) for r in db.execute("SELECT raw_content FROM evidence WHERE id=?", (evidence_id,))]
                    for key in ("model_result_json", "world_result_json"):
                        item[key.removesuffix("_json")] = json.loads(item.pop(key) or "{}")
                    jobs.append(item)
                results.append({"root": str(root), "account": account.name, "recovery": recovery, "jobs": jobs})
print(json.dumps(results, ensure_ascii=False, indent=2))
