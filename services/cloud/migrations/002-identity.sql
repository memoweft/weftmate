CREATE TABLE cloud_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  auth_epoch INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER immutable_cloud_account_id BEFORE UPDATE OF id ON cloud_accounts
BEGIN SELECT RAISE(ABORT, 'cloud account id is immutable'); END;
CREATE TABLE cloud_devices (
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id),
  fingerprint TEXT NOT NULL,
  device_id TEXT NOT NULL,
  public_jwk TEXT,
  confirmed_at INTEGER NOT NULL,
  PRIMARY KEY(account_id, fingerprint)
) STRICT;
CREATE TABLE email_challenges (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id),
  purpose TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0,
  auth_epoch INTEGER NOT NULL,
  context TEXT NOT NULL
) STRICT;
CREATE TABLE failure_limits (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL
) STRICT;
CREATE TABLE oidc_records (
  model TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed INTEGER,
  grant_id TEXT,
  account_id TEXT,
  uid TEXT,
  user_code TEXT,
  PRIMARY KEY(model, id)
) STRICT;
CREATE INDEX oidc_grant ON oidc_records(grant_id);
CREATE INDEX oidc_account ON oidc_records(account_id);
CREATE INDEX oidc_uid ON oidc_records(model, uid);
CREATE INDEX oidc_user_code ON oidc_records(model, user_code);
CREATE TABLE grant_bindings (
  grant_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id),
  fingerprint TEXT NOT NULL,
  device_id TEXT NOT NULL,
  auth_epoch INTEGER NOT NULL
) STRICT;
CREATE TABLE interaction_forms (
  uid TEXT PRIMARY KEY,
  csrf_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
