"""Extract timings/failure checkpoints from explicitly named synthetic databases."""
import json
from pathlib import Path
import sqlite3
import sys

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
            with sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True) as db:
                db.row_factory = sqlite3.Row
                jobs = []
                for row in db.execute("SELECT job_id, evidence_ids_json, state, attempts, created_at, claimed_at, model_dispatch_started_at, model_completed_at, completed_at, model_result_json, world_result_json FROM memory_world_job ORDER BY created_at, rowid"):
                    item = dict(row)
                    item["sources"] = [r[0] for evidence_id in json.loads(item.pop("evidence_ids_json")) for r in db.execute("SELECT raw_content FROM evidence WHERE id=?", (evidence_id,))]
                    for key in ("model_result_json", "world_result_json"):
                        item[key.removesuffix("_json")] = json.loads(item.pop(key) or "{}")
                    jobs.append(item)
                results.append({"root": str(root), "account": account.name, "jobs": jobs})
print(json.dumps(results, ensure_ascii=False, indent=2))
