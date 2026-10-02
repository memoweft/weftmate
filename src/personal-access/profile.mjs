const MAX_AVATAR_BYTES = 128 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const invalid = () => { const error = new Error('INVALID_REQUEST'); error.code = 'INVALID_REQUEST'; error.status = 400; throw error; };

export function displayName(value) {
  if (typeof value !== 'string') invalid();
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || Array.from(normalized).length > 64 || /[\u0000-\u001f\u007f]/.test(normalized)) invalid();
  return normalized;
}

export function avatarImage(value) {
  if (value === null) return null;
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 2 || !Object.hasOwn(value, 'mimeType') ||
      !Object.hasOwn(value, 'dataBase64') || !IMAGE_TYPES.has(value.mimeType) ||
      typeof value.dataBase64 !== 'string' || value.dataBase64.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.dataBase64)) invalid();
  const bytes = Buffer.from(value.dataBase64, 'base64');
  if (bytes.length < 16 || bytes.length > MAX_AVATAR_BYTES || bytes.toString('base64') !== value.dataBase64) invalid();
  const png = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  const webp = bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!(value.mimeType === 'image/png' && png || value.mimeType === 'image/jpeg' && jpeg ||
      value.mimeType === 'image/webp' && webp)) invalid();
  return { mimeType: value.mimeType, dataBase64: value.dataBase64 };
}

export function publicProfile(account) {
  return { username: account.username, displayName: account.displayName ?? account.username,
    avatar: account.avatar ?? null, profileRevision: account.profileRevision ?? 0 };
}

export function validStoredProfile(account) {
  const fields = ['displayName', 'avatar', 'profileRevision'];
  const present = fields.filter((field) => Object.hasOwn(account, field));
  if (present.length === 0) return true; // Existing v2 records remain readable.
  if (present.length !== fields.length || !Number.isSafeInteger(account.profileRevision) ||
      account.profileRevision < 0 || account.profileRevision > Number.MAX_SAFE_INTEGER - 1) return false;
  try {
    return displayName(account.displayName) === account.displayName &&
      JSON.stringify(avatarImage(account.avatar)) === JSON.stringify(account.avatar);
  } catch { return false; }
}
