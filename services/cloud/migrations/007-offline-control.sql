-- Only deletion watermarks. Content, model credentials and device private keys never enter the cloud.
CREATE TABLE offline_controls (
  host_id TEXT NOT NULL REFERENCES cloud_hosts(host_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK(generation > 0),
  PRIMARY KEY(host_id, account_id)
) STRICT;
