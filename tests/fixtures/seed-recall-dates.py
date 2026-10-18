"""Seed only the isolated test database; no model calls or formation timestamps as dates."""
import json
import sqlite3
import sys

db = sqlite3.connect(sys.argv[1])
owner = sys.argv[2]
items = json.load(sys.stdin)
db.execute("INSERT OR IGNORE INTO memory_state(singleton,revision,snapshot_json,snapshot_hash) VALUES(1,9,'{}','synthetic')")
for item in items:
    item_id, text, occurred = item['id'], item['text'], item['occurred']
    evidence_id = 'source-' + item_id
    db.execute("INSERT INTO evidence(id,subject_id,source_kind,host_id,occurred_at,recorded_at,raw_content,summary,"
               "allow_local_read,allow_cloud_read,allow_inference) VALUES(?,?,'spoken','synthetic',?,?,?,?,1,1,1)",
               (evidence_id, owner, occurred, '2030-01-01T00:00:00Z', text, text))
    db.execute("INSERT INTO cognition(id,subject_id,content,content_type,formed_by,confidence,cred_status,created_at,updated_at) "
               "VALUES(?,?,?,'preference','stated',600,'limited',?,?)",
               (item_id, owner, text, '2038-01-01T00:00:00Z', '2038-01-01T00:00:00Z'))
    db.execute("INSERT INTO cognition_evidence(cognition_id,evidence_id,relation) VALUES(?,?,'support')", (item_id, evidence_id))
db.commit()
db.close()
