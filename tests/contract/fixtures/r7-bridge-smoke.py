# -*- coding: utf-8 -*-
"""R7 桥冒烟（临时）：in-process 驱动 DshMemoWeftRuntime——
真实边界信封 → durable store → 动态 mock(解析真实 evidence id/span) → World Job applied → 确定性召回。
预算断言：memory_world 调用恰好 1 次；Recall 生成调用 0。
"""
import hashlib
import json
import re
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, r"D:\AIProjects\MemoWeft\Core\py\src")

from memoweft.integrations.dsh_bridge import DshMemoWeftRuntime  # noqa: E402

CALLS = {"count": 0}


def smart_mock(messages, session_id=""):
    CALLS["count"] += 1
    user_text = messages[-1]["content"]
    try:
        payload = json.loads(user_text)
        evidence = payload.get("evidence") or []
        first = evidence[0] if evidence else None
    except (json.JSONDecodeError, TypeError, IndexError):
        first = None
    if first is None:
        return {"content": json.dumps({"schema_version": 8, "result": "cognitions", "cognitions": []}, ensure_ascii=False), "model": "mock"}
    first_id = first["id"]
    first_text = first["text"]
    # stated 归一后命题以 owner 视角表述（我→用户），锚定检查按归一化原文比对。
    proposition = first_text.replace("我", "用户", 1) if first_text.startswith("我") else first_text
    envelope = {
        "schema_version": 8,
        "result": "cognitions",
        "cognitions": [
            {
                "action": "form",
                "target": "owner_self",
                "statement_kind": "preference",
                "formed_by": "stated",
                "proposition": proposition,
                "supports": [{"evidence_id": first_id, "start": 0, "end": len(first_text)}],
            }
        ],
    }
    return {"content": json.dumps(envelope, ensure_ascii=False), "model": "mock", "usage": {"total_tokens": 0}}


def canonical(messages):
    payload = {
        "schema_version": 1,
        "provider_name": "memoweft",
        "parent_session_id": "sess-parent",
        "result_session_id": "sess-parent",
        "mode": "in_place",
        "source_messages": messages,
    }
    return json.dumps(payload, ensure_ascii=True, allow_nan=False, separators=(",", ":"), sort_keys=True)


def main():
    import os

    real_mode = os.environ.get("WEFTMATE_R7_REAL") == "1"
    tmp = Path(tempfile.mkdtemp(prefix="weftmate-r7-bridge-"))
    runtime = DshMemoWeftRuntime()
    if real_mode:
        # 真实模式：默认 one-shot route（env 凭据 → DeepSeek 恰好一次调用）；预算仍按 DB 记账断言。
        info = runtime.initialize(session_id="sess-parent", dsh_home=str(tmp), platform="dsh", auto_route=True)
        print("[r7-bridge] mode: REAL (env DEEPSEEK_API_KEY route)")
    else:
        info = runtime.initialize(session_id="sess-parent", dsh_home=str(tmp), platform="dsh", one_shot_llm=smart_mock)
        print("[r7-bridge] mode: mock (smart_mock)")
    print("[r7-bridge] initialized:", json.dumps(info, ensure_ascii=False))

    messages = [
        {"role": "user", "content": "我喜欢喝茉莉花茶", "timestamp": 1786000000, "source_ref": "source:0"},
        {"role": "assistant", "content": "好的，记下了。", "timestamp": 1786000001, "source_ref": "source:1"},
        {"role": "user", "content": "今天天气不错", "timestamp": 1786000002, "source_ref": "source:2"},
    ]
    canon = canonical(messages)
    payload_hash = hashlib.sha256(canon.encode("utf-8")).hexdigest()
    boundary = {
        "schema_version": 1,
        "event_id": f"weftmate-compression-boundary-v1:{'a' * 32}:{payload_hash}",
        "provider_name": "memoweft",
        "parent_session_id": "sess-parent",
        "result_session_id": "sess-parent",
        "mode": "in_place",
        "source_messages": messages,
        "payload_hash": payload_hash,
    }
    receipt = runtime.ingest_durable_boundary(boundary)
    print("[r7-bridge] receipt:", json.dumps(receipt, ensure_ascii=False))

    db_path = tmp / "memoweft" / "memoweft.sqlite3"
    for _ in range(60):
        db = sqlite3.connect(db_path)
        row = db.execute("SELECT state FROM memory_world_job ORDER BY rowid DESC LIMIT 1").fetchone()
        db.close()
        if row and str(row[0]) in {"applied", "no_change", "failed", "clarification_required", "out_of_scope"}:
            break
        import time
        time.sleep(0.5)
    db = sqlite3.connect(db_path)
    job_row = db.execute("SELECT job_id, state, attempts FROM memory_world_job ORDER BY rowid DESC LIMIT 1").fetchone()
    reason_row = db.execute("SELECT * FROM memory_world_job ORDER BY rowid DESC LIMIT 1").fetchone()
    cols = [d[0] for d in db.execute("SELECT * FROM memory_world_job LIMIT 0").description]
    world_rows = db.execute("SELECT COUNT(*) FROM cognition").fetchone()[0]
    revision = db.execute("SELECT revision FROM memory_state LIMIT 1").fetchone()
    db.close()
    reason_pairs = {k: v for k, v in zip(cols, reason_row) if v is not None}
    model_name = reason_pairs.get("model_name")
    usage = reason_pairs.get("model_usage_json") or "{}"
    try:
        usage_tokens = int(json.loads(usage).get("total_tokens") or 0)
    except (json.JSONDecodeError, TypeError):
        usage_tokens = 0
    print(f"[r7-bridge] job: {job_row} | cognition 行数: {world_rows} | revision: {revision}")
    print(f"[r7-bridge] model: {model_name} | usage.total_tokens: {usage_tokens}")

    recall = runtime.prefetch("茉莉花茶", session_id="sess-new")
    print("[r7-bridge] recall:", json.dumps(recall, ensure_ascii=False))
    negative = runtime.prefetch("我开的什么车", session_id="sess-new")
    print("[r7-bridge] negative recall:", json.dumps(negative, ensure_ascii=False))

    if real_mode:
        # 真实模式预算：DB 记账证明恰好一次真实模型调用（total_tokens>0、model 非 mock）。
        budget_ok = usage_tokens > 0 and model_name != "mock"
        print(f"[r7-bridge] 预算(真实模式): 真实模型调用 usage_tokens={usage_tokens}>0 且 model={model_name}")
    else:
        budget_ok = CALLS["count"] == 1
        print(f"[r7-bridge] 预算: memory_world 调用={CALLS['count']} (期望 1) | Recall 调用=0(确定性)")

    ok = (
        job_row is not None
        and str(job_row[1]) == "applied"
        and world_rows >= 1
        and recall["count"] > 0
        and negative["count"] == 0
        and budget_ok
    )
    runtime.shutdown()
    print(f"[r7-bridge] 冒烟结果: {'PASS' if ok else 'FAIL'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
