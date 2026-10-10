import { noPush, pushRegistration, pushPayload } from '../../../src/push/provider.mjs';
import { CloudError } from './security.mjs';
export function cloudPush(database, now = Date.now) {
  return {
    async registration(accountId, fingerprint, method, body) {
      if (!['GET','PUT','DELETE'].includes(method)) throw new CloudError(405, 'METHOD_NOT_ALLOWED');
      const device = database.prepare('SELECT device_id FROM cloud_devices WHERE account_id=? AND fingerprint=?').get(accountId, fingerprint);
      if (!device) throw new CloudError(401, 'UNAUTHORIZED');
      if (method === 'PUT') {
        let value; try { value = pushRegistration(body); } catch { throw new CloudError(400, 'INVALID_REQUEST'); }
        database.prepare(`INSERT INTO push_registrations VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,fingerprint)
          DO UPDATE SET platform=excluded.platform,provider=excluded.provider,token=excluded.token,updated_at=excluded.updated_at`)
          .run(accountId, fingerprint, value.platform, value.provider, value.token, now());
      } else if (method === 'DELETE') database.prepare('DELETE FROM push_registrations WHERE account_id=? AND fingerprint=?').run(accountId, fingerprint);
      const row = database.prepare('SELECT * FROM push_registrations WHERE account_id=? AND fingerprint=?').get(accountId, fingerprint);
      return { deviceId: device.device_id, registered: !!row, platform: row?.platform ?? null,
        provider: row?.provider ?? 'none', tokenPresent: !!row?.token, ...(await noPush.register()) };
    },
    async send(accountId, payload) {
      const minimal = pushPayload(payload);
      const rows = database.prepare('SELECT * FROM push_registrations WHERE account_id=?').all(accountId);
      return Promise.all(rows.map(row => noPush.send(row, minimal)));
    }
  };
}
