import { randomUUID, randomInt, randomBytes } from 'node:crypto';
import { calculateJwkThumbprint, importJWK } from 'jose';
import {
  CloudError,
  normalizeEmail,
  hashPassword,
  verifyPassword,
  digest,
  equalDigest,
  FailureLimiter,
  transaction,
} from './security.mjs';
import { challengeMail, passwordChangedMail, emailChangedMail } from './mail-templates.mjs';

export class Accounts {
  constructor(database, mailer, secret, { now = Date.now, logger } = {}) {
    this.db = database;
    this.mailer = mailer;
    this.secret = secret;
    this.now = now;
    this.logger = logger;
    this.limiter = new FailureLimiter(database, secret, now);
  }
  get(id) {
    return this.db.prepare('SELECT * FROM cloud_accounts WHERE id=?').get(id);
  }
  byEmail(email) {
    return this.db.prepare('SELECT * FROM cloud_accounts WHERE email=?').get(email);
  }
  public(account) {
    return { cloudAccountId: account.id, email: account.email, auth_epoch: account.auth_epoch };
  }
  check(email, source) {
    const keys = this.limiter.keys(email, source);
    this.limiter.check(keys);
    return keys;
  }
  delivery(email, source) {
    const keys = this.limiter.keys(email, source, 'delivery');
    this.limiter.check(keys);
    this.limiter.fail(keys, true);
  }
  async sendChallenge(account, purpose, email, context = {}) {
    const id = randomUUID();
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    this.db
      .prepare(
        'INSERT INTO email_challenges(id,account_id,purpose,email,code_hash,expires_at,auth_epoch,context) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        account.id,
        purpose,
        email,
        digest(this.secret, `${id}:${code}`),
        this.now() + 600000,
        account.auth_epoch,
        JSON.stringify(context),
      );
    try {
      await this.sendMail(account, {
        to: email,
        ...challengeMail(purpose.replace('app-', ''), code, context.device?.deviceId),
      });
    } catch {
      this.db.prepare('UPDATE email_challenges SET consumed=1 WHERE id=?').run(id);
      throw new CloudError(503, 'MAIL_UNAVAILABLE');
    }
    return { challengeId: id, expiresIn: 600 };
  }
  async register({ email: input, password }, source) {
    const email = normalizeEmail(input);
    this.check(email, source);
    this.delivery(email, source);
    if (this.byEmail(email)) throw new CloudError(409, 'EMAIL_IN_USE');
    const record = await hashPassword(password);
    const account = { id: randomUUID(), email, auth_epoch: 0 };
    try {
      this.db
        .prepare('INSERT INTO cloud_accounts(id,email,password,created_at) VALUES(?,?,?,?)')
        .run(account.id, email, JSON.stringify(record), this.now());
    } catch (error) {
      if (error.code?.startsWith('ERR_SQLITE')) throw new CloudError(409, 'EMAIL_IN_USE');
      throw error;
    }
    return this.sendChallenge(account, 'register', email);
  }
  async sendMail(account, message) {
    if (!this.get(account.id)) throw new CloudError(401, 'UNAUTHORIZED');
    const result = await this.mailer.send({ ...message, accountId: account.id });
    if (!this.get(account.id)) {
      await this.mailer.deleteAccount?.(account.id, [message.to]);
      throw new CloudError(401, 'UNAUTHORIZED');
    }
    return result;
  }
  async requestPassword(body, purpose, source) {
    const email = normalizeEmail(body.email);
    this.check(email, source);
    this.delivery(email, source);
    let account = this.byEmail(email);
    if (purpose === 'register') {
      if (account?.active) throw new CloudError(409, 'EMAIL_IN_USE');
      if (!account) {
        // No usable password exists until the mailbox has been verified.
        this.db.prepare('INSERT INTO cloud_accounts(id,email,password,created_at) VALUES(?,?,?,?)')
          .run(randomUUID(), email, 'null', this.now());
        account = this.byEmail(email);
      }
    } else if (!account?.active) return { challengeId: randomUUID(), expiresIn: 600 };
    return this.sendChallenge(account, `app-${purpose}`, email);
  }
  verifyPasswordCode(body, purpose, source) {
    const { account } = this.readChallenge(body.challengeId, `app-${purpose}`, source, body.code);
    const passwordTicket = randomBytes(32).toString('base64url');
    transaction(this.db, () => {
      this.consume(body.challengeId);
      this.db.prepare('INSERT INTO password_tickets VALUES(?,?,?,?,?)')
        .run(digest(this.secret, passwordTicket), account.id, purpose, account.auth_epoch, this.now() + 600000);
    });
    return { passwordTicket, expiresIn: 600 };
  }
  passwordTicket(token, purpose, source) {
    const ticket = typeof token === 'string' ? this.db.prepare('SELECT * FROM password_tickets WHERE token_hash=?')
      .get(digest(this.secret, token)) : undefined;
    const account = ticket && this.get(ticket.account_id);
    const keys = this.check(account?.email ?? 'password-ticket', source);
    if (!ticket || ticket.purpose !== purpose || ticket.expires_at <= this.now() ||
        !account || account.auth_epoch !== ticket.auth_epoch || Boolean(account.active) !== (purpose === 'reset')) {
      this.limiter.fail(keys);
      throw new CloudError(400, 'PASSWORD_TICKET_INVALID');
    }
    return { ticket, account };
  }
  async completePassword(body, purpose, source) {
    this.passwordTicket(body.passwordTicket, purpose, source);
    const record = await hashPassword(body.password);
    const { ticket, account } = this.passwordTicket(body.passwordTicket, purpose, source);
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM password_tickets WHERE token_hash=?').run(ticket.token_hash);
      this.db.prepare('UPDATE cloud_accounts SET password=?,active=1,auth_epoch=auth_epoch+1 WHERE id=?')
        .run(JSON.stringify(record), account.id);
      this.revoke(account.id);
    });
    return purpose === 'register' ? { account: this.public(this.get(account.id)), verified: true } : this.passwordNotification(account);
  }
  async changePassword(body, source, account) {
    const keys = this.check(account.email, source);
    if (!await verifyPassword(body.currentPassword, JSON.parse(account.password))) {
      this.limiter.fail(keys);
      throw new CloudError(401, 'INVALID_CREDENTIALS');
    }
    const record = await hashPassword(body.password);
    const current = this.get(account.id);
    if (!current?.active || current.auth_epoch !== account.auth_epoch || current.password !== account.password)
      throw new CloudError(401, 'UNAUTHORIZED');
    transaction(this.db, () => {
      this.db.prepare('UPDATE cloud_accounts SET password=?,auth_epoch=auth_epoch+1 WHERE id=?')
        .run(JSON.stringify(record), account.id);
      this.revoke(account.id);
    });
    return this.passwordNotification(account);
  }
  async passwordNotification(account) {
    let notificationAccepted = true;
    try { await this.sendMail(account, { to: account.email, ...passwordChangedMail() }); }
    catch {
      notificationAccepted = false;
      this.logger?.error('mail.notification_failed', { code: 'MAIL_UNAVAILABLE' });
    }
    return { passwordChanged: true, notificationAccepted };
  }
  async requestCode({ email: input }, purpose, source) {
    const email = normalizeEmail(input);
    this.check(email, source);
    this.delivery(email, source);
    const account = this.byEmail(email);
    if (!account || (purpose === 'register' ? account.active : !account.active))
      return { challengeId: randomUUID(), expiresIn: 600 };
    return this.sendChallenge(account, purpose, email);
  }
  readChallenge(id, purpose, source, code, uid) {
    const challenge =
      typeof id === 'string'
        ? this.db.prepare('SELECT * FROM email_challenges WHERE id=?').get(id)
        : undefined;
    const account = challenge ? this.get(challenge.account_id) : undefined;
    const keys = this.check(account?.email ?? `challenge:${id}`, source);
    const context = challenge ? JSON.parse(challenge.context) : {};
    if (
      !challenge ||
      challenge.purpose !== purpose ||
      challenge.consumed ||
      challenge.expires_at <= this.now() ||
      challenge.attempts >= 5 ||
      !account ||
      challenge.auth_epoch !== account.auth_epoch ||
      (uid && context.uid !== uid)
    ) {
      this.limiter.fail(keys);
      throw new CloudError(400, 'CHALLENGE_INVALID');
    }
    if (
      typeof code !== 'string' ||
      !/^\d{6}$/.test(code) ||
      !equalDigest(challenge.code_hash, digest(this.secret, `${id}:${code}`))
    ) {
      this.db.prepare('UPDATE email_challenges SET attempts=attempts+1 WHERE id=?').run(id);
      this.limiter.fail(keys);
      throw new CloudError(400, 'CODE_INVALID');
    }
    return { challenge, account, context };
  }
  consume(id) {
    const result = this.db
      .prepare('UPDATE email_challenges SET consumed=1 WHERE id=? AND consumed=0')
      .run(id);
    if (!result.changes) throw new CloudError(400, 'CHALLENGE_INVALID');
  }
  activate(body) {
    return transaction(this.db, () => {
      this.consume(body.challengeId);
      this.db.prepare('UPDATE cloud_accounts SET active=1 WHERE id=?').run(body.account.id);
      return { account: this.public(this.get(body.account.id)), verified: true };
    });
  }
  verifyRegistration(body, source) {
    const checked = this.readChallenge(body.challengeId, 'register', source, body.code);
    return this.activate({ ...body, account: checked.account });
  }
  async device({ deviceId, publicJwk }) {
    if (typeof deviceId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(deviceId))
      throw new CloudError(400, 'INVALID_DEVICE');
    let jwk = null;
    let fingerprint = `id:${deviceId}`;
    if (publicJwk !== undefined) {
      if (
        !publicJwk ||
        typeof publicJwk !== 'object' ||
        !['RSA', 'EC', 'OKP'].includes(publicJwk.kty) ||
        ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'].some((key) => key in publicJwk)
      )
        throw new CloudError(400, 'INVALID_DEVICE_KEY');
      try {
        const alg = publicJwk.kty === 'RSA' ? 'RS256' : publicJwk.kty === 'EC' ? 'ES256' : 'EdDSA';
        await importJWK(publicJwk, alg);
        const { kty, crv, n, e, x, y } = publicJwk;
        jwk = Object.fromEntries(
          Object.entries({ kty, crv, n, e, x, y }).filter(([, v]) => v !== undefined),
        );
        fingerprint = `key:${await calculateJwkThumbprint(jwk)}`;
      } catch {
        throw new CloudError(400, 'INVALID_DEVICE_KEY');
      }
    }
    // Changing either identifier or public key requires a new confirmation.
    return {
      deviceId,
      publicJwk: jwk,
      fingerprint: digest(this.secret, `${deviceId}:${fingerprint}`),
    };
  }
  async login(body, source, uid) {
    const email = normalizeEmail(body.email);
    const keys = this.check(email, source);
    const snapshot = this.byEmail(email);
    if (!(await verifyPassword(body.password, snapshot ? JSON.parse(snapshot.password) : null))) {
      this.limiter.fail(keys);
      throw new CloudError(401, 'INVALID_CREDENTIALS');
    }
    const account = this.get(snapshot.id);
    if (account.auth_epoch !== snapshot.auth_epoch || account.password !== snapshot.password)
      throw new CloudError(401, 'INVALID_CREDENTIALS');
    if (!account.active) {
      this.limiter.fail(keys);
      throw new CloudError(403, 'EMAIL_NOT_VERIFIED');
    }
    const device = await this.device(body);
    const name = body.deviceName ?? 'WeftMate device';
    const type = body.deviceType ?? 'unknown';
    if (typeof name !== 'string' || !name.trim() || name.length > 128 ||
        !['windows','macos','android','ios','web','unknown'].includes(type)) throw new CloudError(400, 'INVALID_DEVICE');
    Object.assign(device, { name: name.trim(), type });
    if (
      !this.db
        .prepare('SELECT 1 FROM cloud_devices WHERE account_id=? AND fingerprint=?')
        .get(account.id, device.fingerprint)
    ) {
      this.delivery(email, source);
      return {
        confirmationRequired: true,
        ...(await this.sendChallenge(account, 'device', email, { uid, device })),
      };
    }
    this.db.prepare('UPDATE cloud_devices SET name=?,type=?,last_seen=? WHERE account_id=? AND fingerprint=?')
      .run(device.name, device.type, this.now(), account.id, device.fingerprint);
    return { account, device };
  }
  confirmDevice(body, source, uid) {
    const result = this.readChallenge(body.challengeId, 'device', source, body.code, uid);
    transaction(this.db, () => {
      this.consume(body.challengeId);
      const device = result.context.device;
      this.db
        .prepare('INSERT OR IGNORE INTO cloud_devices(account_id,fingerprint,device_id,public_jwk,confirmed_at,name,type,last_seen) VALUES(?,?,?,?,?,?,?,?)')
        .run(
          result.account.id,
          device.fingerprint,
          device.deviceId,
          device.publicJwk ? JSON.stringify(device.publicJwk) : null,
          this.now(),
          device.name, device.type, this.now(),
        );
    });
    return { account: result.account, device: result.context.device };
  }
  revoke(accountId) {
    this.db
      .prepare(
        "DELETE FROM oidc_records WHERE account_id=? OR grant_id IN (SELECT grant_id FROM grant_bindings WHERE account_id=?) OR (model='Grant' AND id IN (SELECT grant_id FROM grant_bindings WHERE account_id=?))",
      )
      .run(accountId, accountId, accountId);
    this.db.prepare('DELETE FROM grant_bindings WHERE account_id=?').run(accountId);
    this.db.prepare('UPDATE email_challenges SET consumed=1 WHERE account_id=?').run(accountId);
    this.db.prepare('DELETE FROM password_tickets WHERE account_id=?').run(accountId);
  }
  async reset(body, source) {
    // Derivation is async: recheck the challenge and epoch immediately before committing.
    this.readChallenge(body.challengeId, 'reset', source, body.code);
    const record = await hashPassword(body.password);
    const { account } = this.readChallenge(body.challengeId, 'reset', source, body.code);
    transaction(this.db, () => {
      this.consume(body.challengeId);
      this.db
        .prepare('UPDATE cloud_accounts SET password=?,auth_epoch=auth_epoch+1 WHERE id=?')
        .run(JSON.stringify(record), account.id);
      this.revoke(account.id);
    });
    // Reset stays committed even when the notification provider is unavailable.
    let notificationAccepted = true;
    try {
      await this.sendMail(account, { to: account.email, ...passwordChangedMail() });
    } catch {
      notificationAccepted = false;
      this.logger?.error('mail.notification_failed', { code: 'MAIL_UNAVAILABLE' });
    }
    return { passwordChanged: true, notificationAccepted };
  }
  async requestEmail(body, source, account, legacy = false) {
    if (Object.keys(body).sort().join(',') !== (legacy ? 'email,password' : 'email')) throw new CloudError(400, 'INVALID_REQUEST');
    const keys = this.check(account.email, source);
    if (legacy) {
      if (!await verifyPassword(body.password, JSON.parse(account.password))) {
        this.limiter.fail(keys); throw new CloudError(401, 'INVALID_CREDENTIALS');
      }
      if (this.get(account.id)?.auth_epoch !== account.auth_epoch) throw new CloudError(401, 'UNAUTHORIZED');
    }
    const email = normalizeEmail(body.email);
    if (this.byEmail(email)) throw new CloudError(409, 'EMAIL_IN_USE');
    this.delivery(account.email, source);
    return this.sendChallenge(account, 'email', email);
  }
  async confirmEmail(body, source, authenticated) {
    if (Object.keys(body).sort().join(',') !== 'challengeId,code') throw new CloudError(400, 'INVALID_REQUEST');
    const { challenge, account } = this.readChallenge(body.challengeId, 'email', source, body.code);
    if (account.id !== authenticated.id) throw new CloudError(403, 'FORBIDDEN');
    if (account.auth_epoch !== authenticated.auth_epoch) throw new CloudError(401, 'UNAUTHORIZED');
    if (this.byEmail(challenge.email)) throw new CloudError(409, 'EMAIL_IN_USE');
    transaction(this.db, () => {
      this.consume(body.challengeId);
      this.db
        .prepare('UPDATE cloud_accounts SET email=?,auth_epoch=auth_epoch+1 WHERE id=?')
        .run(challenge.email, account.id);
      // Challenges sent to the previous mailbox must lose authority immediately.
      this.revoke(account.id);
    });
    let notificationAccepted = true;
    try { await this.sendMail(account, { to: account.email, ...emailChangedMail() }); }
    catch { notificationAccepted = false; this.logger?.error('mail.notification_failed', { code: 'MAIL_UNAVAILABLE' }); }
    const current = this.get(account.id);
    if (!current) throw new CloudError(401, 'UNAUTHORIZED');
    return { account: this.public(current), notificationAccepted };
  }
}
