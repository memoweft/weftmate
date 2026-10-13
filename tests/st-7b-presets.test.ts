import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mailProviders, mailConfiguration, calendarConfiguration, encryptedUrl } from '../src/personal-connectors/service-presets.mjs';
import { builtinConnectors } from '../src/personal-connectors/builtins.mjs';
import { connectorCallSummary } from '../src/plugins/personal-connectors.mjs';
import { connectorSettings } from '../src/personal-connectors/access.mjs';

test('mail presets use verified encrypted receiving and sending with official credential help', () => {
  const expected = {qq:['imap.qq.com','smtp.qq.com',465,'tls'],'163':['imap.163.com','smtp.163.com',465,'tls'],'126':['imap.126.com','smtp.126.com',465,'tls'],gmail:['imap.gmail.com','smtp.gmail.com',465,'tls'],icloud:['imap.mail.me.com','smtp.mail.me.com',587,'starttls']};
  for (const [provider, parameters] of Object.entries(expected)) {
    const config=mailConfiguration({provider,email:'owner@synthetic.invalid'});
    assert.deepEqual([config.imapHost,config.smtpHost,config.smtpPort,config.smtpSecurity],parameters);assert.equal(config.imapPort,993);
    assert.match(mailProviders.find(row=>row.value===provider).helpUrl,/^https:\/\//);
  }
  assert.throws(()=>mailConfiguration({provider:'qq',email:'bad-address'}),/邮箱地址/);
  assert.throws(()=>mailConfiguration({provider:'other',email:'owner@synthetic.invalid',imapHost:'localhost',smtpHost:'localhost',imapPort:'143',smtpPort:'25',smtpSecurity:'tls'}),/明文/);
  assert.throws(()=>mailConfiguration({provider:'qq',email:'synthetic@outlook.com'}),/暂不支持/);
});
test('builtin secrets are vault fields; subscription links never appear in configuration', () => {
  const items=builtinConnectors();assert.deepEqual(items.map(row=>row.id),['mail','calendar','calendar-ics','local-clock']);
  for(const item of items.slice(0,3))assert.ok(item.fields.some(field=>field.secret&&field.required));
  const subscription=items.find(item=>item.id==='calendar-ics').configure({timeZone:'Asia/Shanghai'},{ICS_URL:'https://synthetic.invalid/secret-calendar-code'});
  assert.ok(!JSON.stringify(subscription).includes('secret-calendar-code'));
  assert.equal(calendarConfiguration({provider:'icloud',username:'synthetic',timeZone:'Asia/Shanghai'}).url,'https://caldav.icloud.com/');
  assert.throws(()=>encryptedUrl('http://synthetic.invalid/calendar'),/https/);assert.throws(()=>encryptedUrl('https://user:secret@synthetic.invalid/calendar'),/账号/);
});
test('calendar drafts inherit account timezone and approval summaries show recipients and event facts', async () => {
  let operation;
  const context={connectors:{test:async(_owner,input)=>{operation=input;return {ok:true};}},authenticate:()=>{},accountState:()=>({}),usage:{settings:()=>({timeZone:'America/New_York'})}};
  await connectorSettings(context,{}, {ownerId:'synthetic',device:{authKind:'desktop'}},{action:'test',builtinId:'calendar',fields:{provider:'icloud',username:'synthetic',timeZone:'UTC'},credentials:{AUTH_CODE:'synthetic-code'}});
  assert.equal(operation.fields.timeZone,'America/New_York');
  const mail=connectorCallSummary({builtinId:'mail',connectorName:'邮箱',rawName:'mail_reply',displayName:'回复邮件'},{to:['friend@synthetic.invalid'],subject:'合成主题',body:'批准的正文'});
  for(const part of ['回复邮件','friend@synthetic.invalid','合成主题','批准的正文'])assert.ok(mail.includes(part));
  assert.ok(!connectorCallSummary({builtinId:'mail',connectorName:'邮箱',rawName:'mail_reply',displayName:'回复邮件'},{to:['friend@synthetic.invalid'],subject:'合成主题',body:'你好，\n这是回复'}).includes('\n'));
  const calendar=connectorCallSummary({builtinId:'calendar',connectorName:'日历',rawName:'calendar_create',displayName:'新建日程'},{title:'合成会议',start:'2026-10-15T13:00',end:'2026-10-15T14:00',calendarName:'工作日历'});
  for(const part of ['合成会议','13:00','14:00','工作日历'])assert.ok(calendar.includes(part));
  assert.ok(!calendar.includes('T13:00'));assert.ok(!calendar.includes('13:00:00'));
  assert.doesNotThrow(()=>connectorCallSummary({connectorName:'自定义',rawName:'mail_send'},{to:'another schema'}));
});
