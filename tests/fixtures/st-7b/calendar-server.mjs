import { createServer } from 'node:https';
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Generated disposable test certificate and key. Product code has no certificate bypass.
export async function calendarTlsFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'st-7b-calendar-'));
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const der = (tag, ...parts) => {
    const content = Buffer.concat(parts.map(part => Buffer.isBuffer(part) ? part : Buffer.from(part)));
    const length = content.length;
    return Buffer.concat([Buffer.from([tag]), length < 128 ? Buffer.from([length]) : length < 256 ? Buffer.from([0x81, length]) : Buffer.from([0x82, length >> 8, length & 255]), content]);
  };
  const seq = (...parts) => der(0x30, ...parts), oid = hex => der(6, Buffer.from(hex, 'hex'));
  const algorithm = seq(oid('2a8648ce3d040302'));
  const name = seq(der(0x31, seq(oid('550403'), der(0x0c, 'localhost'))));
  const basic = seq(oid('551d13'), der(1, Buffer.from([255])), der(4, seq(der(1, Buffer.from([255])))));
  const san = seq(oid('551d11'), der(4, seq(der(0x82, 'localhost'), der(0x87, Buffer.from([127, 0, 0, 1])))));
  const tbs = seq(der(0xa0, der(2, Buffer.from([2]))), der(2, Buffer.from([1])), algorithm, name,
    seq(der(0x18, '20200101000000Z'), der(0x18, '20400101000000Z')), name,
    createPublicKey(privateKey).export({ type: 'spki', format: 'der' }), der(0xa3, seq(basic, san)));
  const certificate = seq(tbs, algorithm, der(3, Buffer.from([0]), sign('sha256', tbs, privateKey)));
  const cert = '-----BEGIN CERTIFICATE-----\n' + certificate.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const certificatePath = join(directory, 'calendar-cert.pem'), keyPath = join(directory, 'calendar-key.pem');
  await writeFile(certificatePath, cert); await writeFile(keyPath, key);
  return { directory, certificatePath, certPath: certificatePath, keyPath, cert, key, async close() { await rm(directory, { recursive: true, force: true }); } };
}
export function calendarIcs(events) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Synthetic ST-7b//ZH', ...events, 'END:VCALENDAR', ''].join('\r\n');
}
export function calendarEvent(uid, start, end, extra = []) {
  return ['BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261013T000000Z', `DTSTART${start}`, `DTEND${end}`, ...(extra.some(line => line.startsWith('SUMMARY:')) ? [] : [`SUMMARY:合成日程 ${uid}`]), ...extra, 'END:VEVENT'];
}
export const calendarSubscription = calendarIcs([
  ...calendarEvent('single', ';TZID=Asia/Shanghai:20261015T140000', ';TZID=Asia/Shanghai:20261015T150000', ['LOCATION:合成会议室', 'DESCRIPTION:合成说明']),
  ...calendarEvent('daily', ';TZID=Asia/Shanghai:20261013T090000', ';TZID=Asia/Shanghai:20261013T100000', ['RRULE:FREQ=DAILY;COUNT=5', 'EXDATE;TZID=Asia/Shanghai:20261014T090000']),
  ...calendarEvent('daily', ';TZID=Asia/Shanghai:20261015T110000', ';TZID=Asia/Shanghai:20261015T120000', ['RECURRENCE-ID;TZID=Asia/Shanghai:20261015T090000', 'SUMMARY:合成改期']),
  ...calendarEvent('dst', ';TZID=America/New_York:20261031T090000', ';TZID=America/New_York:20261031T100000', ['RRULE:FREQ=DAILY;COUNT=3']),
  ...calendarEvent('cancelled', ':20261015T040000Z', ':20261015T050000Z', ['STATUS:CANCELLED']),
  ...calendarEvent('transparent', ':20261015T080000Z', ':20261015T090000Z', ['TRANSP:TRANSPARENT']),
]);
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const response = (href, props) => `<d:response><d:href>${escape(href)}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const xml = rows => `<?xml version="1.0" encoding="UTF-8"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${rows.join('')}</d:multistatus>`;

/** Synthetic HTTPS calendar server; random port, memory-only fictional accounts and events. */
export async function createCalendarFixture(options = {}) {
  const ownTls = !options.tls;
  const tls = options.tls || await calendarTlsFixture();
  const cert = tls.cert || await readFile(tls.certificatePath), key = tls.key || await readFile(tls.keyPath);
  const username = 'calendar-user', password = 'synthetic-calendar-pass';
  const authorization = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const events = new Map();
  events.set('/calendars/home/single.ics', { data: calendarIcs(calendarEvent('single', ';TZID=Asia/Shanghai:20261015T140000', ';TZID=Asia/Shanghai:20261015T150000', ['LOCATION:合成会议室', 'DESCRIPTION:合成说明'])), etag: '"1"' });
  events.set('/calendars/home/repeating.ics', { data: calendarSubscription, etag: '"2"' });
  const requests = [], mutations = [];
  let generation = 2;
  const server = createServer({ cert, key }, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString(), path = req.url.split('?')[0];
    requests.push({ method: req.method, path, body, ifMatch: req.headers['if-match'], ifNoneMatch: req.headers['if-none-match'] });
    if (path === '/subscription.ics') { res.writeHead(200, { 'content-type': 'text/calendar' }); res.end(options.subscription || calendarSubscription); return; }
    if (path === '/bad.ics') { res.writeHead(200); res.end('fictional invalid calendar'); return; }
    if (path === '/insecure-redirect') { res.writeHead(302, { location: 'http://127.0.0.1:1/forbidden' }); res.end(); return; }
    if (req.headers.authorization !== authorization) { res.writeHead(401); res.end(); return; }
    if (path === '/.well-known/caldav') { res.writeHead(301, { location: '/dav/' }); res.end(); return; }
    if (req.method === 'PROPFIND') {
      const rows = [];
      if (body.includes('current-user-principal')) rows.push(response(path, '<d:current-user-principal><d:href>/principals/user/</d:href></d:current-user-principal>'));
      else if (body.includes('calendar-home-set')) rows.push(response('/principals/user/', '<c:calendar-home-set><d:href>/calendars/</d:href></c:calendar-home-set>'));
      else if (body.includes('supported-report-set')) rows.push(response(path, '<d:supported-report-set><d:supported-report><d:report><c:calendar-query/></d:report></d:supported-report></d:supported-report-set>'));
      else rows.push(response('/calendars/home/', '<d:displayname>合成工作日历</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>'));
      res.writeHead(207, { 'content-type': 'application/xml' }); res.end(xml(rows)); return;
    }
    if (req.method === 'REPORT') {
      const rows = [...events.entries()].map(([href, item]) => response(href, `<d:getetag>${escape(item.etag)}</d:getetag>${body.includes('calendar-data') ? `<c:calendar-data>${escape(item.data)}</c:calendar-data>` : ''}`));
      res.writeHead(207, { 'content-type': 'application/xml' }); res.end(xml(rows)); return;
    }
    if (req.method === 'PUT' || req.method === 'DELETE') {
      const old = events.get(path);
      if (old && req.headers['if-match'] !== old.etag || !old && req.method === 'DELETE' || old && req.headers['if-none-match'] === '*') { res.writeHead(412); res.end(); return; }
      if (req.method === 'PUT') { const etag = `"${++generation}"`; events.set(path, { data: body, etag }); mutations.push({ method: 'PUT', path, data: body }); res.writeHead(old ? 204 : 201, { etag }); }
      else { events.delete(path); mutations.push({ method: 'DELETE', path }); res.writeHead(204); }
      res.end(); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `https://127.0.0.1:${server.address().port}`;
  return { baseUrl, url: baseUrl + '/dav/', subscriptionUrl: baseUrl + '/subscription.ics', username, password, events, requests, mutations,
    certificatePath: tls.certificatePath, certPath: tls.certificatePath, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (ownTls) await tls.close(); } };
}
