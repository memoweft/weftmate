-- S0 creates no account/device/relay tables; those belong to reviewed S1/S2.
CREATE TABLE service_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
INSERT INTO service_metadata (key, value) VALUES ('role', 'control-plane');
