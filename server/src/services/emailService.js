const env = require('../config/env');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const shell = (title, body, ctaLabel, ctaUrl) => `
<div style="font-family:Arial,Helvetica,sans-serif;background:#F5F3FF;padding:24px">
  <div style="max-width:520px;margin:auto;background:#fff;border-radius:20px;overflow:hidden">
    <div style="background:#16112B;padding:22px 24px"><span style="color:#FFB81C;font-size:24px;font-weight:800">FameVote</span>
      <div style="color:#C9BEFF;font-size:12px;margin-top:2px">Your Vote. Their Fame.</div></div>
    <div style="padding:26px 24px;color:#16112B"><h2 style="margin:0 0 12px;font-size:22px">${esc(title)}</h2><p style="line-height:1.6;margin:0 0 20px">${esc(body)}</p>
      <p style="margin:0 0 20px"><a href="${esc(ctaUrl)}" style="display:inline-block;background:#5A2DF5;color:#fff;text-decoration:none;padding:14px 24px;border-radius:12px;font-weight:700">${esc(ctaLabel)}</a></p>
      <p style="font-size:12px;color:#6b6683;margin:0">If the button does not work, copy this link:<br>${esc(ctaUrl)}</p></div>
  </div></div>`;

/**
 * Sends through Brevo's transactional email REST API. Never throws on provider failure paths the caller
 * cannot act on: callers already catch and log, and auth flows must not reveal delivery state.
 * `fetchImpl` is injectable for tests.
 */
async function send(to, subject, html, devLink, fetchImpl = fetch) {
  if (!env.BREVO_API_KEY) {
    if (!env.isProd && !env.isTest) console.log(`[email:dev] To: ${to} | ${subject} | ${devLink}`);
    else if (env.isProd) console.warn('[email] BREVO_API_KEY not set; email not sent:', subject);
    return { sent: false };
  }
  const res = await fetchImpl(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: env.EMAIL_FROM_NAME, email: env.EMAIL_FROM_EMAIL }, to: [{ email: to }], subject, htmlContent: html }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo ${res.status}: ${detail.slice(0, 200)}`);
  }
  return { sent: true };
}

const clientLink = (path, token) => `${env.clientOrigins[0]}${path}?token=${token}`;

const sendPasswordResetEmail = (user, token) => {
  const url = clientLink('/reset-password', token);
  return send(user.email, 'Reset your FameVote password',
    shell('Reset your password', 'We received a request to reset your password. This link expires in 1 hour. If this was not you, ignore this email.', 'Reset password', url), url);
};

module.exports = { sendPasswordResetEmail, send };
