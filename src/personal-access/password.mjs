import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const N = 131_072;
const R = 8;
const P = 1;
const MAXMEM = 192 * 1024 * 1024;
const SALT_BYTES = 32;
const KEY_BYTES = 64;
const HEX_SALT = /^[a-f0-9]{64}$/;
const HEX_KEY = /^[a-f0-9]{128}$/;
const DUMMY_SALT = Buffer.alloc(SALT_BYTES, 0x5a);
const DUMMY_KEY = Buffer.alloc(KEY_BYTES, 0xa5);

export function validPassword(value) {
  return typeof value === 'string' && [...value].length >= 15 && [...value].length <= 128;
}

export function normalizeUsername(value) {
  if (typeof value !== 'string') return null;
  const display = value.trim().normalize('NFKC');
  if ([...display].length < 3 || [...display].length > 64 ||
      !/^[\p{L}\p{N}_.-]+$/u.test(display)) return null;
  return { display, canonical: display.toLocaleLowerCase('en-US') };
}

export function validPasswordRecord(record) {
  return record !== null && typeof record === 'object' && !Array.isArray(record) &&
    record.algorithm === 'scrypt' && record.N === N && record.r === R && record.p === P &&
    record.maxmem === MAXMEM && HEX_SALT.test(record.salt ?? '') && HEX_KEY.test(record.hash ?? '');
}

export async function hashPassword(password, salt = randomBytes(SALT_BYTES)) {
  if (!validPassword(password)) throw new TypeError('invalid password');
  const key = await scrypt(password, salt, KEY_BYTES, { N, r: R, p: P, maxmem: MAXMEM });
  return { algorithm: 'scrypt', N, r: R, p: P, maxmem: MAXMEM,
    salt: salt.toString('hex'), hash: key.toString('hex') };
}

export async function verifyPassword(password, record) {
  const selected = validPasswordRecord(record) ? record : null;
  const salt = selected ? Buffer.from(selected.salt, 'hex') : DUMMY_SALT;
  const expected = selected ? Buffer.from(selected.hash, 'hex') : DUMMY_KEY;
  const key = await scrypt(typeof password === 'string' ? password : '', salt, KEY_BYTES,
    { N, r: R, p: P, maxmem: MAXMEM });
  return timingSafeEqual(key, expected);
}
