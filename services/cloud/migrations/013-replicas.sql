CREATE TABLE opaque_credentials (
 account_id TEXT PRIMARY KEY REFERENCES cloud_accounts(id) ON DELETE CASCADE,
 record TEXT NOT NULL, version INTEGER NOT NULL, wrapped_key TEXT
) STRICT;
CREATE TABLE replica_heads (
 account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
 host_id TEXT NOT NULL REFERENCES cloud_hosts(host_id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, operation TEXT NOT NULL, key_id TEXT NOT NULL, box TEXT NOT NULL,
 PRIMARY KEY(account_id,host_id)
) STRICT;
CREATE TABLE replica_objects (
 account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
 host_id TEXT NOT NULL REFERENCES cloud_hosts(host_id) ON DELETE CASCADE,
 id TEXT NOT NULL, box TEXT NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL,
 retired_at INTEGER,
 PRIMARY KEY(account_id,host_id,id)
) STRICT;
CREATE TABLE replica_refs (
 account_id TEXT NOT NULL, host_id TEXT NOT NULL, id TEXT NOT NULL,
 PRIMARY KEY(account_id,host_id,id),
 FOREIGN KEY(account_id,host_id) REFERENCES replica_heads(account_id,host_id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,host_id,id) REFERENCES replica_objects(account_id,host_id,id) ON DELETE CASCADE
) STRICT;
