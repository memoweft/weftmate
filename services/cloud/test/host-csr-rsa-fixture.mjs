import { createHash, checkPrimeSync, createPrivateKey } from 'node:crypto';

// Public synthetic test data, never a production key. Derive the same 2048-bit
// RSA key from a published seed; keep all private components in memory only.
const bytes = value => {
  const hex = value.toString(16);
  return Buffer.from(hex.padStart(Math.ceil(hex.length / 2) * 2, '0'), 'hex');
};
const base64 = value => bytes(value).toString('base64url');
function inverse(value, modulus) {
  let [current, next, remainder, rest] = [0n, 1n, modulus, value];
  while (rest) {
    const quotient = remainder / rest;
    [current, next] = [next, current - quotient * next];
    [remainder, rest] = [rest, remainder - quotient * rest];
  }
  if (remainder !== 1n) throw new Error('Synthetic RSA components are not coprime');
  return (current % modulus + modulus) % modulus;
}
export function seededRsa(seed = 'weftmate-csr-492') {
  const exponent = 65537n;
  function prime(label) {
    const hex = [0, 1].map(index => createHash('sha512').update(`${seed}:${label}:${index}`).digest('hex')).join('');
    let value = BigInt(`0x${hex}`) | (3n << 1022n) | 1n;
    while ((value - 1n) % exponent === 0n || !checkPrimeSync(bytes(value))) value += 2n;
    return value;
  }
  const p = prime('p'), q = prime('q'), modulus = p * q;
  const privateExponent = inverse(exponent, (p - 1n) * (q - 1n));
  const jwk = { kty: 'RSA', n: base64(modulus), e: base64(exponent), d: base64(privateExponent),
    p: base64(p), q: base64(q), dp: base64(privateExponent % (p - 1n)),
    dq: base64(privateExponent % (q - 1n)), qi: base64(inverse(q, p)) };
  createPrivateKey({key:jwk,format:'jwk'});
  return jwk;
}
