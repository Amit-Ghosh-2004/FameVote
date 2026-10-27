const env = require('../config/env');

function twilioAuthorization() {
  return `Basic ${Buffer.from(
    `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`
  ).toString('base64')}`;
}

function verifyServiceUrl(endpoint) {
  return `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/${endpoint}`;
}

/**
 * Sends an OTP using the configured provider.
 * Twilio Verify generates and sends its own code; the local code argument
 * remains for console/MSG91 compatibility and is not sent to Twilio.
 */
async function sendOtp(phone, code) {
  if (env.SMS_PROVIDER === 'console') {
    if (env.isProd) throw new Error('console SMS provider is not allowed in production');
    console.log(`[sms:console] ${phone} -> ${code}`);
    return;
  }

  if (env.SMS_PROVIDER === 'twilio') {
    const res = await fetch(verifyServiceUrl('Verifications'), {
      method: 'POST',
      headers: {
        Authorization: twilioAuthorization(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: phone, Channel: 'sms' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Twilio Verify responded ${res.status}`);
    return;
  }

  if (env.SMS_PROVIDER === 'msg91') {
    const url = new URL('https://control.msg91.com/api/v5/otp');
    url.search = new URLSearchParams({
      template_id: env.MSG91_TEMPLATE_ID,
      mobile: phone.replace('+', ''),
      otp: code,
    }).toString();
    const res = await fetch(url, {
      method: 'POST',
      headers: { authkey: env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`MSG91 responded ${res.status}`);
    return;
  }

  throw new Error('No SMS provider configured');
}

/** Returns true only when Twilio Verify approves the submitted code. */
async function verifyTwilioOtp(phone, code) {
  const res = await fetch(verifyServiceUrl('VerificationCheck'), {
    method: 'POST',
    headers: {
      Authorization: twilioAuthorization(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: phone, Code: code }),
    signal: AbortSignal.timeout(10_000),
  });

  // Twilio may use a 400/404 response for an invalid, expired, or missing check.
  if (res.status === 400 || res.status === 404) return false;
  if (!res.ok) throw new Error(`Twilio Verify check responded ${res.status}`);

  const result = await res.json();
  return result.status === 'approved';
}

module.exports = { sendOtp, verifyTwilioOtp };
