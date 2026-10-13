/** Public presets contain no credentials. Servers are encrypted and verified. */
export const mailProviders = [
  { value: 'qq', label: 'QQ 邮箱', imapHost: 'imap.qq.com', smtpHost: 'smtp.qq.com', smtpPort: 465, smtpSecurity: 'tls', help: '在网页版邮箱的设置 → 账号与安全 → 第三方服务中开启邮件客户端服务，生成授权码。', helpUrl: 'https://service.mail.qq.com/detail/0/75' },
  { value: '163', label: '163 邮箱', imapHost: 'imap.163.com', smtpHost: 'smtp.163.com', smtpPort: 465, smtpSecurity: 'tls', help: '在网页版邮箱的设置中开启客户端服务，按提示获取授权码。网易的官方说明适用于 163 和 126 邮箱。', helpUrl: 'https://help.mail.126.com/faqDetail.do?code=d7a5dc8471cd0c0e8b4b8f4f8e49998b374173cfe9171305fa1ce630d7f67ac2a5feb28b66796d3b' },
  { value: '126', label: '126 邮箱', imapHost: 'imap.126.com', smtpHost: 'smtp.126.com', smtpPort: 465, smtpSecurity: 'tls', help: '在网页版邮箱的设置中开启客户端服务，按提示获取授权码。网易的官方说明适用于 163 和 126 邮箱。', helpUrl: 'https://help.mail.126.com/faqDetail.do?code=d7a5dc8471cd0c0e8b4b8f4f8e49998b374173cfe9171305fa1ce630d7f67ac2a5feb28b66796d3b' },
  { value: 'gmail', label: 'Gmail', imapHost: 'imap.gmail.com', smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecurity: 'tls', help: '先开启 Google 两步验证，再为 WeftMate 生成应用专用密码。部分工作或学校账号可能不提供此功能。', helpUrl: 'https://support.google.com/accounts/answer/185833?hl=zh-Hans' },
  { value: 'icloud', label: 'iCloud 邮箱', imapHost: 'imap.mail.me.com', smtpHost: 'smtp.mail.me.com', smtpPort: 587, smtpSecurity: 'starttls', help: '在 Apple 账户的登录与安全 → App 专用密码中生成一个密码。', helpUrl: 'https://support.apple.com/zh-cn/102654' },
  { value: 'other', label: '其它邮箱', help: '向邮箱服务商获取加密服务器地址和授权码。Outlook.com、Microsoft 365 和 Exchange 暂不支持，之后提供。' },
];
export const calendarProviders = [
  { value: 'icloud', label: 'iCloud 日历', url: 'https://caldav.icloud.com/', help: '填写 Apple 账户，在登录与安全 → App 专用密码中生成一个密码。', helpUrl: 'https://support.apple.com/zh-cn/102654' },
  { value: 'other', label: '其它日历服务器', help: '填写 Fastmail、Nextcloud、群晖等服务商提供的日历地址和应用专用密码。只支持加密地址。' },
];
const problem = (code, message) => { throw Object.assign(new Error(message), { code }); };
export function mailConfiguration(fields) {
  const provider = mailProviders.find(row => row.value === fields.provider);
  if (!provider) problem('MAIL_ADDRESS_INVALID', '请选择邮箱服务商。');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(fields.email ?? '') || /[\r\n]/.test(fields.email)) problem('MAIL_ADDRESS_INVALID', '邮箱地址不对，请检查后重试。');
  if (/@(?:outlook|hotmail|live|msn)\./i.test(fields.email)) problem('MAIL_UNSUPPORTED', '这个邮箱暂不支持，之后提供网页登录。');
  const config = { email: fields.email.trim(), imapHost: provider.imapHost, imapPort: 993, smtpHost: provider.smtpHost, smtpPort: provider.smtpPort, smtpSecurity: provider.smtpSecurity };
  if (provider.value === 'other') {
    for (const key of ['imapHost','smtpHost']) if (!/^[a-zA-Z0-9.-]+$/.test(fields[key] ?? '')) problem('MAIL_ADDRESS_INVALID', '服务器地址不对，请只填写服务器名称。');
    for (const key of ['imapPort','smtpPort']) if (!/^\d+$/.test(fields[key] ?? '') || Number(fields[key]) < 1 || Number(fields[key]) > 65535 || ['25','143','110'].includes(fields[key])) problem('MAIL_ADDRESS_INVALID', '请填写加密服务器的端口，不能使用明文端口。');
    if (!['tls','starttls'].includes(fields.smtpSecurity)) problem('MAIL_ADDRESS_INVALID', '请选择加密方式。');
    Object.assign(config, { imapHost: fields.imapHost, smtpHost: fields.smtpHost, imapPort: Number(fields.imapPort), smtpPort: Number(fields.smtpPort), smtpSecurity: fields.smtpSecurity });
  }
  return config;
}
export function calendarConfiguration(fields) {
  const provider = calendarProviders.find(row => row.value === fields.provider);
  if (!provider) problem('CALENDAR_ADDRESS_INVALID', '请选择日历服务商。');
  return { kind: 'caldav', url: encryptedUrl(provider.value === 'other' ? fields.url : provider.url), username: fields.username, timeZone: fields.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone };
}
export function encryptedUrl(input) {
  let url; try { url = new URL(input); } catch { problem('CALENDAR_ADDRESS_INVALID', '日历地址不对，请填写完整的加密地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) problem('CALENDAR_ADDRESS_INVALID', '请填写以 https:// 开头的日历地址，账号与授权码请分开填写。');
  return url.href;
}
