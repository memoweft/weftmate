CREATE TABLE host_relays (
  host_id TEXT PRIMARY KEY REFERENCES cloud_hosts(host_id),
  domain TEXT NOT NULL UNIQUE,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  rotation_id TEXT NOT NULL,
  last_seen INTEGER
) STRICT;

-- Existing S1b hosts: the original claim controls transport, not content accounts.
UPDATE host_memberships SET role='owner' WHERE rowid IN (
  SELECT min(rowid) FROM host_memberships GROUP BY host_id
);
