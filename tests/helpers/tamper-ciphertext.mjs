export function tamperCiphertext(ciphertext) {
  const bytes = Buffer.from(ciphertext, 'base64url');
  if (!bytes.length) throw Error('Expected a nonempty synthetic ciphertext');
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  return bytes.toString('base64url');
}
