-- One public commitment per account. Only enrolled devices hold key material.
CREATE TABLE account_data_keys (
  account_id TEXT PRIMARY KEY REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL CHECK(length(key_id) = 43)
) STRICT;
