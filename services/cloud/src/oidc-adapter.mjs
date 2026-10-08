import { errors } from 'oidc-provider';
import { transaction } from './security.mjs';

export function sqliteAdapter(database, now = Date.now) {
  return class SQLiteAdapter {
    constructor(model) {
      this.model = model;
    }
    async upsert(id, payload, expiresIn) {
      const accountId = payload.accountId ?? payload.result?.login?.accountId;
      if (accountId && !database.prepare('SELECT 1 FROM cloud_accounts WHERE id=?').get(accountId))
        throw new errors.InvalidGrant('account deleted');
      // Reject a token issued by an in-flight request after reset/revocation.
      if (
        payload.grantId &&
        !database.prepare('SELECT 1 FROM grant_bindings WHERE grant_id=?').get(payload.grantId)
      ) {
        throw new errors.InvalidGrant('grant revoked');
      }
      database
        .prepare(
          `INSERT INTO oidc_records VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(model,id) DO UPDATE SET
        payload=excluded.payload,expires_at=excluded.expires_at,grant_id=excluded.grant_id,
        account_id=excluded.account_id,uid=excluded.uid,user_code=excluded.user_code`,
        )
        .run(
          this.model,
          id,
          JSON.stringify(payload),
          now() + (expiresIn ?? 3600) * 1000,
          payload.consumed ?? null,
          payload.grantId ?? null,
          payload.accountId ?? payload.result?.login?.accountId ?? null,
          payload.uid ?? null,
          payload.userCode ?? null,
        );
    }
    async find(id) {
      return this.read('id', id);
    }
    async findByUid(uid) {
      return this.read('uid', uid);
    }
    async findByUserCode(code) {
      return this.read('user_code', code);
    }
    read(column, value) {
      const row = database
        .prepare(`SELECT * FROM oidc_records WHERE model=? AND ${column}=?`)
        .get(this.model, value);
      if (!row || row.expires_at <= now()) return undefined;
      return { ...JSON.parse(row.payload), ...(row.consumed ? { consumed: row.consumed } : {}) };
    }
    async consume(id) {
      const won = transaction(database, () => {
        const result = database
          .prepare('UPDATE oidc_records SET consumed=? WHERE model=? AND id=? AND consumed IS NULL')
          .run(Math.floor(now() / 1000), this.model, id);
        if (result.changes) return true;
        const row = database
          .prepare('SELECT grant_id FROM oidc_records WHERE model=? AND id=?')
          .get(this.model, id);
        if (row?.grant_id) this.revoke(row.grant_id);
        return false;
      });
      if (!won) throw new errors.InvalidGrant('credential already consumed');
    }
    async destroy(id) {
      database.prepare('DELETE FROM oidc_records WHERE model=? AND id=?').run(this.model, id);
    }
    revoke(grantId) {
      database
        .prepare("DELETE FROM oidc_records WHERE grant_id=? OR (model='Grant' AND id=?)")
        .run(grantId, grantId);
      database.prepare('DELETE FROM grant_bindings WHERE grant_id=?').run(grantId);
    }
    async revokeByGrantId(grantId) {
      this.revoke(grantId);
    }
  };
}
