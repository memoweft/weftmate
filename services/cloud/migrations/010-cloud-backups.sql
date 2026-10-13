-- Only opaque encrypted payloads and the minimum transfer/accounting metadata.
CREATE TABLE cloud_backup_keys (
  account_id TEXT PRIMARY KEY REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL,
  envelope TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE cloud_backups (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL,
  descriptor TEXT NOT NULL,
  total_bytes INTEGER NOT NULL CHECK(total_bytes > 0),
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 512),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  state TEXT NOT NULL CHECK(state IN ('uploading','complete'))
) STRICT;
CREATE INDEX cloud_backups_account ON cloud_backups(account_id,state,completed_at);
CREATE TABLE cloud_backup_chunks (
  backup_id TEXT NOT NULL REFERENCES cloud_backups(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  ciphertext BLOB NOT NULL,
  size INTEGER NOT NULL CHECK(size > 0),
  hash TEXT NOT NULL,
  PRIMARY KEY(backup_id,chunk_index)
) STRICT;
CREATE TABLE cloud_backup_quota (
  account_id TEXT PRIMARY KEY REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_bytes >= 0)
) STRICT;
CREATE TABLE cloud_backup_controls (
  account_id TEXT PRIMARY KEY REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0)
) STRICT;
-- Forgetting/permission withdrawal already advances this authenticated control.
-- Older snapshots must not resurrect the erased content, including an unfinished upload.
-- Generation 1 establishes an initial offline control without forgetting data.
-- A first publication above 1 already includes a local invalidation, even when
-- this computer has never issued a replica to a phone.
CREATE TRIGGER cloud_backup_forget_initial AFTER INSERT ON offline_controls
WHEN NEW.generation > 1
BEGIN
  DELETE FROM cloud_backups WHERE account_id=NEW.account_id;
  DELETE FROM cloud_backup_quota WHERE account_id=NEW.account_id;
  INSERT INTO cloud_backup_controls(account_id,generation) VALUES(NEW.account_id,1)
    ON CONFLICT(account_id) DO UPDATE SET generation=generation+1;
END;
CREATE TRIGGER cloud_backup_forget AFTER UPDATE OF generation ON offline_controls
WHEN NEW.generation > OLD.generation
BEGIN
  DELETE FROM cloud_backups WHERE account_id=NEW.account_id;
  DELETE FROM cloud_backup_quota WHERE account_id=NEW.account_id;
  INSERT INTO cloud_backup_controls(account_id,generation) VALUES(NEW.account_id,1)
    ON CONFLICT(account_id) DO UPDATE SET generation=generation+1;
END;
