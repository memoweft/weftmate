CREATE TABLE host_claims (
  claim_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  public_jwk TEXT NOT NULL,
  jkt TEXT NOT NULL,
  tls_spki TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  account_id TEXT REFERENCES cloud_accounts(id),
  status TEXT NOT NULL CHECK(status IN ('pending','active'))
) STRICT;
CREATE TABLE cloud_hosts (
  host_id TEXT PRIMARY KEY,
  public_jwk TEXT NOT NULL,
  jkt TEXT NOT NULL,
  tls_spki TEXT NOT NULL
) STRICT;
CREATE TABLE host_memberships (
  host_id TEXT NOT NULL REFERENCES cloud_hosts(host_id),
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id),
  role TEXT NOT NULL DEFAULT 'member',
  claim_id TEXT NOT NULL REFERENCES host_claims(claim_id),
  PRIMARY KEY(host_id,account_id)
) STRICT;
CREATE TABLE cloud_revocations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id),
  host_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('epoch','device')),
  epoch INTEGER,
  device_id TEXT,
  jkt TEXT,
  request_id TEXT UNIQUE
) STRICT;
CREATE TABLE host_proof_replays (jti TEXT PRIMARY KEY, expires_at INTEGER NOT NULL) STRICT;
CREATE TRIGGER account_epoch_revocation AFTER UPDATE OF auth_epoch ON cloud_accounts
WHEN NEW.auth_epoch > OLD.auth_epoch
BEGIN
  INSERT INTO cloud_revocations(account_id,kind,epoch) VALUES(NEW.id,'epoch',NEW.auth_epoch);
END;
