const titles = {
  register: '验证 WeftMate 邮箱',
  reset: '找回 WeftMate 密码',
  device: '确认 WeftMate 新设备登录',
  email: '验证 WeftMate 新邮箱',
};
export function challengeMail(purpose, code, deviceId) {
  return {
    subject: titles[purpose],
    text: `${titles[purpose]}\n验证码：${code}\n10 分钟内有效，只能使用一次。\n${purpose === 'device' ? `设备标识：${deviceId}\n确认只授权云账号登录，内容权限须另行配对。\n` : ''}如果不是你发起，请忽略此邮件。`,
  };
}
export const passwordChangedMail = () => ({
  subject: 'WeftMate 密码已更改',
  text: '你的云账号密码已更改。原有云会话与刷新令牌已撤销。如果不是你操作，请立即找回密码。此操作不改变本地宿主密码或内容密钥。',
});
