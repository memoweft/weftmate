CREATE TABLE push_registrations (
  account_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  platform TEXT NOT NULL,
  provider TEXT NOT NULL,
  token TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(account_id, fingerprint),
  FOREIGN KEY(account_id, fingerprint) REFERENCES cloud_devices(account_id, fingerprint) ON DELETE CASCADE
) STRICT;
