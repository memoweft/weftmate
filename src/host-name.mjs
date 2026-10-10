import { hostname } from 'node:os';

/** Explicit synthetic-run override; ordinary product launches retain OS identity. */
export function hostName() {
  return process.env.WEFTMATE_TEST_HOST_NAME || hostname();
}
