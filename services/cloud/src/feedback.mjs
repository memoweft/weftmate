import { CloudError } from './security.mjs';

// Plain text only. Never evaluate templates, render HTML, or log submitted text.
export const cleanFeedbackText = value => String(value ?? '').replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  .replace(/</g, '＜').replace(/>/g, '＞').replace(/@/g, '＠');

export function createFeedback({ config, limiter, fetch: request = globalThis.fetch }) {
  return async (account, body) => {
    if (!body || typeof body.title !== 'string' || typeof body.body !== 'string' ||
        !body.title.trim() || !body.body.trim() || /\n/.test(body.title) || body.title.length > 120)
      throw new CloudError(400, 'FEEDBACK_INVALID');
    if (Buffer.byteLength(body.body, 'utf8') > 60000) throw new CloudError(413, 'FEEDBACK_TOO_LARGE');
    // Refuse a changed payload rather than silently altering the approved preview.
    if (cleanFeedbackText(body.title) !== body.title || cleanFeedbackText(body.body) !== body.body)
      throw new CloudError(400, 'FEEDBACK_UNSAFE_TEXT');
    if (!config.feedbackRepository || !config.feedbackToken) throw new CloudError(503, 'FEEDBACK_NOT_CONFIGURED');
    const keys = limiter.keys(account.id, account.id, 'feedback');
    limiter.check(keys); limiter.fail(keys, true);
    let response;
    try {
      response = await request(`https://api.github.com/repos/${config.feedbackRepository}/issues`, {
        method: 'POST', headers: { authorization: `Bearer ${config.feedbackToken}`, accept: 'application/vnd.github+json',
          'content-type': 'application/json', 'x-github-api-version': '2022-11-28', 'user-agent': 'WeftMate-feedback' },
        body: JSON.stringify({ title: body.title, body: body.body }), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new CloudError(502, 'FEEDBACK_NETWORK_FAILED'); }
    if (!response.ok) throw new CloudError(502, `FEEDBACK_GITHUB_${response.status}`);
    let result;
    try { result = await response.json(); } catch { throw new CloudError(502, 'FEEDBACK_INVALID_RECEIPT'); }
    if (!Number.isSafeInteger(result.number) || result.number < 1) throw new CloudError(502, 'FEEDBACK_INVALID_RECEIPT');
    return { number: result.number };
  };
}
