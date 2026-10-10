/** Providers only wake a trusted device. Fetch all content/decisions from its host. */
export class PushProvider {
  get id() { throw new Error('PushProvider.id must be implemented'); }
  async register(_registration) { throw new Error('PushProvider.register must be implemented'); }
  async revoke(_registration) { throw new Error('PushProvider.revoke must be implemented'); }
  async send(_registration, _payload) { throw new Error('PushProvider.send must be implemented'); }
}
export class NoopPushProvider extends PushProvider {
  get id() { return 'none'; }
  async register() { return { configured: false, accepted: false, reason: 'PUSH_NOT_CONFIGURED' }; }
  async revoke() { return { configured: false, accepted: false, reason: 'PUSH_NOT_CONFIGURED' }; }
  async send(_registration, payload) { pushPayload(payload); return { configured: false, accepted: false, reason: 'PUSH_NOT_CONFIGURED' }; }
}
export function pushPayload(value) {
  if (!value || Object.keys(value).length !== 2 || typeof value.eventId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(value.eventId) || typeof value.type !== 'string' ||
      !/^[a-z]+(?:\.[a-z]+)+$/.test(value.type)) throw new TypeError('Invalid push payload');
  return { eventId: value.eventId, type: value.type };
}
export function pushRegistration(value) {
  if (!value || Array.isArray(value) || Object.keys(value).some(key => !['platform','provider','token'].includes(key)) ||
      !['android','ios','macos','watchos','windows'].includes(value.platform) ||
      typeof value.provider !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(value.provider) ||
      !(value.token === null || typeof value.token === 'string' && value.token.length >= 1 && value.token.length <= 4096) ||
      (value.provider === 'none') !== (value.token === null)) throw new TypeError('Invalid push registration');
  return { platform: value.platform, provider: value.provider, token: value.token };
}
export const noPush = new NoopPushProvider();
