CREATE TABLE removed_computers (
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  host_id TEXT NOT NULL,
  name TEXT NOT NULL,
  removed_at INTEGER NOT NULL,
  PRIMARY KEY(account_id,host_id)
) STRICT;
CREATE TABLE removed_computer_tasks (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  host_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
