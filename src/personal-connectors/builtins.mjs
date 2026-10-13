import { join } from 'node:path';
import { mailProviders, calendarProviders, mailConfiguration, calendarConfiguration, encryptedUrl } from './service-presets.mjs';
const start = (kind, config) => ({ transport: 'stdio', command: process.execPath,
  args: [join(import.meta.dirname, 'service-server.mjs')], environment: { ELECTRON_RUN_AS_NODE: '1', WEFTMATE_CONNECTOR_KIND: kind, WEFTMATE_CONNECTOR_CONFIG: JSON.stringify(config) } });
const secret = { name: 'AUTH_CODE', label: '授权码 / 应用专用密码', secret: true, required: true };
const other = { field: 'provider', values: ['other'] };

/** ST-7b registers a stable id, user-facing fields, and an in-process config
 * factory. Secrets are supplied to the factory in memory, never in the catalog. */
export function builtinConnectors() {
  return [
    { id: 'mail', name: '邮箱', description: '让助手按需查看邮件、搜索和整理；发信、回复、转发与整理前会先问你。暂不支持附件发送及 Outlook / 微软邮箱，之后提供。', fields: [
      { name: 'provider', label: '邮箱服务商', default: 'qq', options: mailProviders.map(({value,label,help,helpUrl})=>({value,label,help,helpUrl})) },
      { name: 'email', label: '邮箱地址', type: 'email', required: true }, secret,
      { name: 'imapHost', label: '收件服务器', visibleWhen: other }, { name: 'imapPort', label: '收件端口（加密）', default: '993', type: 'number', visibleWhen: other },
      { name: 'smtpHost', label: '发件服务器', visibleWhen: other }, { name: 'smtpPort', label: '发件端口（加密）', default: '465', type: 'number', visibleWhen: other },
      { name: 'smtpSecurity', label: '发件加密方式', default: 'tls', visibleWhen: other, options: [{value:'tls',label:'直接加密'},{value:'starttls',label:'连接后加密（必须成功）'}] },
    ], configure: fields => start('mail', mailConfiguration(fields)) },
    { id: 'calendar', name: '日历', description: '让助手查询日程和空闲时间；新建、修改或删除前会先问你。重复日程可查看，暂不修改或删除。', fields: [
      { name: 'provider', label: '日历服务商', default: 'icloud', options: calendarProviders.map(({value,label,help,helpUrl})=>({value,label,help,helpUrl})) },
      { name: 'username', label: '账号', required: true }, secret, { name: 'url', label: '日历服务器地址', type: 'url', visibleWhen: other },
      { name: 'timeZone', label: '时区', hidden: true },
    ], configure: fields => start('calendar', calendarConfiguration(fields)) },
    { id: 'calendar-ics', name: '订阅日历', description: '填写日历订阅地址，让助手查看日程与空闲时间；这个日历不能修改。订阅地址保存在安全凭证库。', fields: [
      { name: 'ICS_URL', label: '订阅地址', secret: true, required: true, type: 'url' }, { name: 'timeZone', label: '时区', hidden: true },
    ], configure: (fields, credentials) => { encryptedUrl(credentials.ICS_URL); return start('calendar', {kind:'ics', timeZone:fields.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone}); } },
    { id: 'local-clock', name: '本机时间', description: '让助手读取这台电脑的时间，不联网。', fields: [],
    configure: () => ({ transport: 'stdio', command: process.execPath,
      args: [join(import.meta.dirname, 'clock-server.mjs')], environment: { ELECTRON_RUN_AS_NODE: '1' } }) }];
}
