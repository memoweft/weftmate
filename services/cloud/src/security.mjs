import { randomBytes, scrypt as callback, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(callback);
// Same cost as the personal host, with independent cloud salts and records.
export const PASSWORD_PARAMS = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
export const validPassword = (value) =>
  typeof value === 'string' && [...value].length >= 8 && [...value].length <= 128;
export function normalizeEmail(value) {
  if (typeof value !== 'string') throw new CloudError(400, 'INVALID_EMAIL');
  const email = value.trim().normalize('NFKC').toLowerCase();
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(email) ||
    email.split('@')[0].length > 64 ||
    email.includes('..')
  )
    throw new CloudError(400, 'INVALID_EMAIL');
  return email;
}
export class CloudError extends Error {
  constructor(status, code, retryAfter) {
    super(code);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
export const digest = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');
export const equalDigest = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function hashPassword(password) {
  if (!validPassword(password)) throw new CloudError(400, 'INVALID_PASSWORD');
  const salt = randomBytes(32).toString('hex');
  const key = await scrypt(password, Buffer.from(salt, 'hex'), 64, PASSWORD_PARAMS);
  return { algorithm: 'scrypt', ...PASSWORD_PARAMS, salt, hash: key.toString('hex') };
}
export async function verifyPassword(password, record) {
  const valid =
    record?.algorithm === 'scrypt' &&
    Object.entries(PASSWORD_PARAMS).every(([k, v]) => record[k] === v) &&
    /^[a-f0-9]{64}$/.test(record.salt ?? '') &&
    /^[a-f0-9]{128}$/.test(record.hash ?? '');
  const salt = valid ? Buffer.from(record.salt, 'hex') : Buffer.alloc(32, 0x5a);
  const key = await scrypt(validPassword(password) ? password : '', salt, 64, PASSWORD_PARAMS);
  return (
    timingSafeEqual(key, valid ? Buffer.from(record.hash, 'hex') : Buffer.alloc(64, 0xa5)) && valid
  );
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export class FailureLimiter {
  constructor(db, secret, now = Date.now) {
    this.db = db;
    this.secret = secret;
    this.now = now;
  }
  keys(account, source, kind = 'failure') {
    return [
      `${kind}:account:${digest(this.secret, account)}`,
      `${kind}:source:${digest(this.secret, source)}`,
    ];
  }
  check(keys) {
    this.db.prepare('DELETE FROM failure_limits WHERE window_start<=? AND blocked_until<=?').run(this.now() - 3600000, this.now());
    const until = Math.max(
      0,
      ...keys.map(
        (key) =>
          this.db.prepare('SELECT blocked_until FROM failure_limits WHERE key=?').get(key)
            ?.blocked_until ?? 0,
      ),
    );
    if (until > this.now())
      throw new CloudError(429, 'RATE_LIMITED', Math.ceil((until - this.now()) / 1000));
  }
  fail(keys, delivery = false) {
    for (const key of keys) {
      const old = this.db.prepare('SELECT * FROM failure_limits WHERE key=?').get(key);
      const fresh = !old || this.now() - old.window_start >= 3600000;
      const failures = fresh ? 1 : old.failures + 1;
      const delay =
        failures < 5
          ? 0
          : delivery
            ? 600000
            : Math.min(3600000, 1000 * 2 ** Math.min(failures - 5, 12));
      this.db
        .prepare(
          `INSERT INTO failure_limits VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET
        failures=excluded.failures,window_start=excluded.window_start,blocked_until=excluded.blocked_until`,
        )
        .run(key, failures, fresh ? this.now() : old.window_start, this.now() + delay);
    }
  }
}
