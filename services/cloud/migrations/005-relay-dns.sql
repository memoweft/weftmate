-- RecordIds created by our provider, so cleanup never deletes pre-existing TXT.
CREATE TABLE relay_dns_records (
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  record_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (name, value)
) STRICT;
