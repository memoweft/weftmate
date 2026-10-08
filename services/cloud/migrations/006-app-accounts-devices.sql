CREATE TABLE password_tickets (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('register','reset')),
  auth_epoch INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
ALTER TABLE grant_bindings ADD COLUMN app_login INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cloud_devices ADD COLUMN name TEXT NOT NULL DEFAULT 'WeftMate device';
ALTER TABLE cloud_devices ADD COLUMN type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE cloud_devices ADD COLUMN last_seen INTEGER;
ALTER TABLE cloud_hosts ADD COLUMN name TEXT NOT NULL DEFAULT 'WeftMate computer';
ALTER TABLE cloud_hosts ADD COLUMN last_seen INTEGER;
CREATE TABLE device_host_links (
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id),
  fingerprint TEXT NOT NULL,
  host_id TEXT NOT NULL REFERENCES cloud_hosts(host_id),
  PRIMARY KEY(account_id,fingerprint)
) STRICT;
CREATE TABLE host_device_status (
  host_id TEXT NOT NULL REFERENCES cloud_hosts(host_id),
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id),
  device_id TEXT NOT NULL,
  jkt TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','trusted','denied','revoked')),
  PRIMARY KEY(host_id,account_id,device_id,jkt)
) STRICT;
