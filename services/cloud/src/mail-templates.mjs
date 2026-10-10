import { mailTokens as t } from './mail-tokens.mjs';

export const MAIL_MARK_PATH = '/assets/mail/weftmate-mark.png';
export const MAIL_MARK_URL = `https://api.weftmate.com${MAIL_MARK_PATH}`;

const purposes = {
  register: {
    subject: '验证 WeftMate 邮箱', title: '验证你的邮箱',
    preview: '完成邮箱验证，开始使用 WeftMate。',
    body: '欢迎使用 WeftMate。在注册页面输入下面的验证码，完成邮箱验证。',
  },
  reset: {
    subject: '找回 WeftMate 密码', title: '设置新的密码',
    preview: '确认是你在找回密码，再设置新密码。',
    body: '你正在找回 WeftMate 密码。在找回密码页面输入下面的验证码，再设置新密码。',
  },
  device: {
    subject: '确认 WeftMate 新设备登录', title: '确认新设备登录',
    preview: '确认这台新设备是你在登录。',
    body: '一台新设备正在登录你的 WeftMate 云账号。如果是你，在这台设备的登录页面输入下面的验证码。',
  },
  email: {
    subject: '验证 WeftMate 新邮箱', title: '验证你的新邮箱',
    preview: '完成验证，将这个邮箱用于 WeftMate 登录。',
    body: '你正在更换 WeftMate 账号邮箱。在更换邮箱页面输入下面的验证码，确认使用这个新邮箱。',
  },
};

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

// Literal token snapshot: cloud deploys independently of the desktop source tree.
// Regenerate with services/cloud/scripts/build-mail-assets.mjs when tokens change.
function card({ subject, title, preview, paragraphs, code, footnotes }) {
  const p = (value, small = false) => `<p class="${small ? 'mail-muted' : 'mail-body'}" style="margin:0 0 ${t.space[12]};color:${small ? t.light['ink-muted'] : t.light['ink-secondary']};font-size:${t.fontSize[small ? 13 : 15]};line-height:${t.lineHeight['1_65']};overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(value)}</p>`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title>
<style>
@media (prefers-color-scheme: dark) {
  .mail-canvas { background-color:${t.dark.canvas} !important; }
  .mail-card { background-color:${t.dark.surface} !important; border-color:${t.dark.line} !important; }
  .mail-ink { color:${t.dark.ink} !important; }
  .mail-body { color:${t.dark['ink-secondary']} !important; }
  .mail-muted { color:${t.dark['ink-muted']} !important; }
  .mail-rule { border-color:${t.dark.line} !important; }
}
@media screen and (max-width:480px) {
  .mail-outer { padding:${t.space[16]} !important; }
  .mail-content { padding:${t.space[24]} !important; }
}
</style></head>
<body class="mail-canvas" style="margin:0;padding:0;background-color:${t.light.canvas};color:${t.light.ink};font-family:${t.fontFamily.body.replaceAll('"', "'")};-webkit-text-size-adjust:100%;">
<div class="mail-preview" aria-hidden="true" style="display:none!important;visibility:hidden;opacity:0;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;mso-hide:all;">${escapeHtml(preview)}${'&#8204;&nbsp;'.repeat(100)}</div>
<table role="presentation" class="mail-canvas" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${t.light.canvas}" style="width:100%;background-color:${t.light.canvas};border-collapse:collapse;"><tr><td class="mail-outer" align="center" style="padding:${t.space[32]} ${t.space[24]};">
<!--[if mso]><table role="presentation" width="560" border="0" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
<table role="presentation" class="mail-card" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${t.light.surface}" style="width:100%;max-width:560px;table-layout:fixed;background-color:${t.light.surface};border:1px solid ${t.light.line};border-radius:${t.radius[16]};border-spacing:0;"><tr><td class="mail-content" style="padding:${t.space[36]};">
<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-spacing:0;margin:0 0 ${t.space[28]};"><tr><td width="56" height="56" bgcolor="#ffffff" style="width:56px;height:56px;border-radius:${t.radius[12]};background-color:#ffffff;">
<img src="${MAIL_MARK_URL}" width="56" height="56" alt="WeftMate" style="display:block;width:56px;height:56px;border:0;border-radius:${t.radius[12]};color:${t.light.ink};font-size:${t.fontSize[10]};"></td></tr></table>
<h1 class="mail-ink" style="margin:0 0 ${t.space[16]};color:${t.light.ink};font-size:${t.fontSize[27]};font-weight:600;line-height:${t.lineHeight['1_25']};">${escapeHtml(title)}</h1>
${paragraphs.map(value => p(value)).join('\n')}
${code === undefined ? '' : `<p class="mail-ink mail-code" dir="ltr" aria-label="验证码" style="margin:${t.space[28]} 0 ${t.space[32]};color:${t.light.ink};font-size:${t.fontSize[36]};font-weight:400;font-variant-numeric:tabular-nums;line-height:${t.lineHeight['1_25']};letter-spacing:${t.space[4]};white-space:nowrap;">${escapeHtml(code)}</p>`}
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:${code === undefined ? t.space[28] : '0'} 0 ${t.space[20]};"><tr><td class="mail-rule" style="border-top:1px solid ${t.light.line};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table>
${footnotes.map(value => p(value, true)).join('\n')}
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

export function challengeMail(purpose, code, deviceId) {
  if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) throw new TypeError('Mail code must be six digits');
  if (!Object.hasOwn(purposes, purpose)) throw new TypeError('Unknown mail purpose');
  const copy = purposes[purpose];
  const device = purpose === 'device' ? [
    `设备标识：${deviceId}`,
    '确认只授权云账号登录，内容权限须另行配对。',
  ] : [];
  const footnotes = ['10 分钟内有效，只能使用一次。', '如果不是你发起，请忽略此邮件。'];
  return {
    subject: copy.subject,
    // Preserve the existing plain-text line layout and fixture extraction regex.
    text: `${copy.subject}\n验证码：${code}\n${footnotes[0]}\n${device.length ? `${device.join('\n')}\n` : ''}${footnotes[1]}`,
    html: card({ ...copy, paragraphs: [copy.body, ...device], code, footnotes }),
  };
}

export function passwordChangedMail() {
  const copy = {
    subject: 'WeftMate 密码已更改', title: '你的密码已更改',
    preview: '密码更改已完成，原有云账号登录已退出。',
    paragraphs: ['你的 WeftMate 云账号密码已更改。原有云账号登录已退出，请用新密码重新登录。'],
    footnotes: ['如果不是你操作，请立即在 WeftMate 登录页面找回密码，设置新密码。', '本机密码和内容密钥不受影响。'],
  };
  return { subject: copy.subject, text: [...copy.paragraphs, ...copy.footnotes].join('\n'), html: card(copy) };
}

export function emailChangedMail() {
  const copy = {
    subject: 'WeftMate 邮箱已更改', title: '你的邮箱已更改',
    preview: '邮箱更改已完成，下次请用新邮箱登录。',
    paragraphs: ['你的 WeftMate 账号邮箱已更改。原有云账号登录已退出，下次请用新邮箱登录。'],
    footnotes: ['如果不是你操作，请立即更改这个邮箱的密码，并检查邮箱中是否有陌生登录。', '本机的对话、记忆与应急密码不受影响。'],
  };
  return { subject: copy.subject, text: [...copy.paragraphs, ...copy.footnotes].join('\n'), html: card(copy) };
}
