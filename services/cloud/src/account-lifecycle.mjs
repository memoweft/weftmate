import { calculateJwkThumbprint } from 'jose';
import { CloudError, transaction, verifyPassword } from './security.mjs';

const fields = (body, names) => {
  if (Object.keys(body).sort().join(',') !== names.sort().join(',')) throw new CloudError(400, 'INVALID_REQUEST');
};

export function accountLifecycle({ database: db, accounts, relay }) {
  async function revokeDevices(account, devices, currentFingerprint) {
    const revoked = await Promise.all(devices.map(async d => ({ ...d,
      jkt: d.public_jwk ? await calculateJwkThumbprint(JSON.parse(d.public_jwk)) : null })));
    if (accounts.get(account.id)?.auth_epoch !== account.auth_epoch) throw new CloudError(401, 'UNAUTHORIZED');
    if (!db.prepare('SELECT 1 FROM cloud_devices WHERE account_id=? AND fingerprint=?').get(account.id, currentFingerprint))
      throw new CloudError(401, 'UNAUTHORIZED');
    transaction(db, () => {
      for (const d of revoked) {
        const grants = db.prepare('SELECT grant_id FROM grant_bindings WHERE account_id=? AND fingerprint=?').all(account.id, d.fingerprint);
        for (const g of grants) {
          db.prepare("DELETE FROM oidc_records WHERE grant_id=? OR (model='Grant' AND id=?)").run(g.grant_id, g.grant_id);
          db.prepare('DELETE FROM grant_bindings WHERE grant_id=?').run(g.grant_id);
        }
        // Pending confirmations and provider interactions must not restore a logged-out key.
        db.prepare("DELETE FROM email_challenges WHERE account_id=? AND purpose='device' AND json_extract(context,'$.device.fingerprint')=?").run(account.id, d.fingerprint);
        db.prepare('DELETE FROM interaction_forms WHERE uid IN (SELECT uid FROM oidc_records WHERE account_id=? AND json_extract(payload,\'$.params.wm_device_id\')=?)').run(account.id, d.device_id);
        db.prepare("DELETE FROM oidc_records WHERE account_id=? AND (json_extract(payload,'$.params.wm_device_id')=? OR model='Session')").run(account.id, d.device_id);
        db.prepare('DELETE FROM device_host_links WHERE account_id=? AND fingerprint=?').run(account.id, d.fingerprint);
        db.prepare('DELETE FROM cloud_devices WHERE account_id=? AND fingerprint=?').run(account.id, d.fingerprint);
        // Legacy keyless cloud logins cannot hold host content sessions. A broad
        // deviceId event would also revoke a different key on the current device.
        if (d.jkt) {
          db.prepare("UPDATE host_device_status SET status='revoked' WHERE account_id=? AND device_id=? AND jkt=?").run(account.id, d.device_id, d.jkt);
          db.prepare('INSERT INTO cloud_revocations(account_id,kind,device_id,jkt) VALUES(?,?,?,?)').run(account.id, 'device', d.device_id, d.jkt);
        }
      }
    });
    return revoked.length;
  }
  return {
    async remove(body, source, account, token) {
      fields(body, ['password']);
      const limits = accounts.check(account.email, source);
      if (!await verifyPassword(body.password, JSON.parse(account.password))) {
        accounts.limiter.fail(limits); throw new CloudError(401, 'INVALID_CREDENTIALS');
      }
      const current = accounts.get(account.id);
      if (!current?.active || current.auth_epoch !== account.auth_epoch || current.password !== account.password)
        throw new CloudError(401, 'UNAUTHORIZED');
      if (!db.prepare('SELECT 1 FROM cloud_devices WHERE account_id=? AND fingerprint=?').get(account.id, token.device_fingerprint))
        throw new CloudError(401, 'UNAUTHORIZED');
      const emails = [account.email, ...db.prepare('SELECT email FROM email_challenges WHERE account_id=?').all(account.id).map(r => r.email)];
      const hosts = db.prepare("SELECT host_id FROM host_memberships WHERE account_id=? AND role='owner'").all(account.id);
      for (const h of hosts) await relay.cleanupDns(h.host_id);
      if (accounts.get(account.id)?.password !== account.password || accounts.get(account.id)?.auth_epoch !== account.auth_epoch)
        throw new CloudError(401, 'UNAUTHORIZED');
      if (!db.prepare('SELECT 1 FROM cloud_devices WHERE account_id=? AND fingerprint=?').get(account.id, token.device_fingerprint))
        throw new CloudError(401, 'UNAUTHORIZED');
      transaction(db, () => {
        db.prepare("DELETE FROM interaction_forms WHERE uid IN (SELECT json_extract(context,'$.uid') FROM email_challenges WHERE account_id=?)").run(account.id);
        db.prepare("DELETE FROM oidc_records WHERE uid IN (SELECT json_extract(context,'$.uid') FROM email_challenges WHERE account_id=?) OR (model='Interaction' AND id IN (SELECT json_extract(context,'$.uid') FROM email_challenges WHERE account_id=?))").run(account.id, account.id);
        db.prepare('DELETE FROM interaction_forms WHERE uid IN (SELECT uid FROM oidc_records WHERE account_id=?)').run(account.id);
        accounts.revoke(account.id);
        for (const table of ['email_challenges','password_tickets','device_host_links','host_device_status','cloud_revocations','cloud_devices','host_memberships'])
          db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(account.id);
        for (const h of hosts) {
          // Removing an installation owner also removes every sharing membership on that installation.
          for (const table of ['device_host_links','host_device_status','host_memberships','host_relays'])
            db.prepare(`DELETE FROM ${table} WHERE host_id=?`).run(h.host_id);
          db.prepare('DELETE FROM cloud_revocations WHERE host_id=?').run(h.host_id);
          db.prepare('DELETE FROM host_claims WHERE host_id=?').run(h.host_id);
          db.prepare('DELETE FROM cloud_hosts WHERE host_id=?').run(h.host_id);
        }
        db.prepare('DELETE FROM host_claims WHERE account_id=?').run(account.id);
        db.prepare('DELETE FROM cloud_accounts WHERE id=?').run(account.id);
      });
      for (const h of hosts) relay.revoke(h.host_id);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      await accounts.mailer.deleteAccount?.(account.id, emails);
      return { deleted: true, localDataPreserved: true };
    },
    async logoutOthers(body, account, token) {
      fields(body, []);
      const devices = db.prepare('SELECT * FROM cloud_devices WHERE account_id=? AND fingerprint<>?').all(account.id, token.device_fingerprint);
      const revokedDevices = await revokeDevices(account, devices, token.device_fingerprint);
      transaction(db, () => {
        db.prepare("DELETE FROM interaction_forms WHERE uid IN (SELECT json_extract(context,'$.uid') FROM email_challenges WHERE account_id=? AND purpose='device' AND json_extract(context,'$.device.fingerprint')<>?)").run(account.id, token.device_fingerprint);
        db.prepare("DELETE FROM oidc_records WHERE uid IN (SELECT json_extract(context,'$.uid') FROM email_challenges WHERE account_id=? AND purpose='device' AND json_extract(context,'$.device.fingerprint')<>?) OR (model='Interaction' AND id IN (SELECT json_extract(context,'$.uid') FROM email_challenges WHERE account_id=? AND purpose='device' AND json_extract(context,'$.device.fingerprint')<>?))").run(account.id, token.device_fingerprint, account.id, token.device_fingerprint);
        db.prepare("DELETE FROM email_challenges WHERE account_id=? AND purpose='device' AND json_extract(context,'$.device.fingerprint')<>?").run(account.id, token.device_fingerprint);
      });
      return { loggedOut: true, revokedDevices };
    },
    async rename(body, account) {
      fields(body, ['deviceId','name']);
      if (typeof body.deviceId !== 'string' || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 128)
        throw new CloudError(400, 'INVALID_DEVICE');
      const result = db.prepare('UPDATE cloud_devices SET name=? WHERE account_id=? AND device_id=?').run(body.name.trim(), account.id, body.deviceId);
      if (!result.changes) throw new CloudError(404, 'NOT_FOUND');
      db.prepare('UPDATE cloud_hosts SET name=? WHERE host_id IN (SELECT l.host_id FROM device_host_links l JOIN cloud_devices d ON d.account_id=l.account_id AND d.fingerprint=l.fingerprint WHERE d.account_id=? AND d.device_id=?)').run(body.name.trim(), account.id, body.deviceId);
      return { renamed: true, deviceId: body.deviceId, name: body.name.trim() };
    },
  };
}
