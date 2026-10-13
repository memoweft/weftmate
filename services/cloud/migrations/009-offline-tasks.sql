-- Encrypted device messages only; no conversation, project or task text.
CREATE TABLE offline_tasks (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  host_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  device_id TEXT NOT NULL,
  jkt TEXT NOT NULL,
  generation INTEGER NOT NULL,
  ciphertext TEXT,
  ciphertext_hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('waiting','claimed','received','started','completed','failed','expired','canceled')),
  claim_id TEXT,
  lease_until INTEGER,
  receipt_id TEXT,
  FOREIGN KEY(host_id,account_id) REFERENCES host_memberships(host_id,account_id) ON DELETE CASCADE,
  FOREIGN KEY(account_id,fingerprint) REFERENCES cloud_devices(account_id,fingerprint) ON DELETE CASCADE
) STRICT;
CREATE INDEX offline_tasks_host ON offline_tasks(host_id,seq);
CREATE TRIGGER offline_tasks_purge_generation AFTER UPDATE OF generation ON offline_controls
BEGIN
  DELETE FROM offline_tasks WHERE host_id=NEW.host_id AND account_id=NEW.account_id AND generation<NEW.generation;
END;
CREATE TRIGGER offline_tasks_purge_device AFTER UPDATE OF status ON host_device_status
WHEN NEW.status IN ('revoked','denied')
BEGIN
  DELETE FROM offline_tasks WHERE host_id=NEW.host_id AND account_id=NEW.account_id AND device_id=NEW.device_id AND jkt=NEW.jkt;
END;
