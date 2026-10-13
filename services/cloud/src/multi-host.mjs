import { CloudError, transaction } from './security.mjs';

export const multiHostCapabilities = { offlineTasks: 1, multiHost: 1, cloudBackup: 1 };

export function computerNames(rows) {
  const counts = new Map(), used = new Set();
  return rows.map(row => {
    const name = row.name, number = (counts.get(name) ?? 0) + 1;
    counts.set(name, number);
    let displayName = number === 1 ? name : `${name} (${number})`;
    while (used.has(displayName)) displayName += ' (2)';
    used.add(displayName);
    return { ...row, ...(displayName === name ? {} : { displayName }) };
  });
}

export function createComputerActions({ database: db, authenticate, lifecycle, relay, now }) {
  return async (route, req, body) => {
    const rename = route === '/hosts/rename';
    const expected = rename ? ['hostId', 'name'] : ['hostId'];
    if (Object.keys(body).sort().join() !== expected.sort().join() || typeof body.hostId !== 'string')
      throw new CloudError(400, 'INVALID_REQUEST');
    const account = await authenticate(req, true);
    const host = db.prepare(`SELECT h.* FROM cloud_hosts h JOIN host_memberships m ON m.host_id=h.host_id
      WHERE m.account_id=? AND h.host_id=?`).get(account.id, body.hostId);
    if (!host) throw new CloudError(404, 'NOT_FOUND');
    if (rename) {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 128) throw new CloudError(400, 'INVALID_DEVICE');
      transaction(db, () => {
        db.prepare('UPDATE cloud_hosts SET name=? WHERE host_id=?').run(body.name.trim(), body.hostId);
        db.prepare(`UPDATE cloud_devices SET name=? WHERE account_id=? AND fingerprint IN
          (SELECT fingerprint FROM device_host_links WHERE account_id=? AND host_id=?)`).run(body.name.trim(), account.id, account.id, body.hostId);
      });
      return { renamed: true, hostId: body.hostId };
    }
    // Revoke the computer login family, while preserving the installation and
    // all local data. Other computers and the requesting phone stay signed in.
    db.prepare(`INSERT OR IGNORE INTO removed_computer_tasks SELECT id,account_id,host_id,fingerprint,created_at,expires_at
      FROM offline_tasks WHERE account_id=? AND host_id=? AND state IN ('waiting','claimed','received','started')`).run(account.id,body.hostId);
    await lifecycle.revokeComputer(account, req.cloudToken, body.hostId);
    transaction(db, () => {
      db.prepare('INSERT INTO removed_computers VALUES(?,?,?,?) ON CONFLICT(account_id,host_id) DO UPDATE SET name=excluded.name,removed_at=excluded.removed_at')
        .run(account.id, body.hostId, host.name, now());
      db.prepare("UPDATE offline_tasks SET state='canceled',ciphertext=NULL,claim_id=NULL WHERE host_id=? AND account_id=? AND state IN ('waiting','claimed','received','started')")
        .run(body.hostId, account.id);
      db.prepare("UPDATE host_device_status SET status='revoked' WHERE host_id=? AND account_id=?").run(body.hostId, account.id);
      db.prepare('DELETE FROM host_memberships WHERE host_id=? AND account_id=?').run(body.hostId, account.id);
    });
    if (!db.prepare('SELECT 1 FROM host_memberships WHERE host_id=?').get(body.hostId)) relay.revoke(body.hostId);
    return { removed: true, hostId: body.hostId, localDataPreserved: true, tasksCanceled: true };
  };
}
