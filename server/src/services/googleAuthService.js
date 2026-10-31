
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

let client;

const displayName = (p) => {
  const n = String(p.name || p.email.split('@')[0])
    .trim()
    .slice(0, 80);

  return n.length >= 2 ? n : 'FameVote user';
};

/**
 * Verifies a Google ID token:
 * - Validates the signature using Google's public keys.
 * - Checks the audience against our configured client ID.
 * - Validates token expiry.
 *
 * The verifier parameter is injectable for tests.
 */
async function verifyGoogleCredential(credential, verifier) {
  if (!env.GOOGLE_CLIENT_ID) {
    throw ApiError.unavailable(
      'Google sign-in is not configured',
      'GOOGLE_UNAVAILABLE'
    );
  }

  let payload;

  try {
    if (!client) {
      const { OAuth2Client } = require('google-auth-library'); // lazy: only loaded when Google sign-in is used
      client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

      // Use Node.js's built-in fetch instead of Gaxios's failing
      // automatic fetch-loader path. Requires Node.js 18+.
      if (client.transporter?.defaults && globalThis.fetch) {
        client.transporter.defaults.fetchImplementation = globalThis.fetch;
      }
    }

    const ticket = await (
      verifier
        ? verifier(credential)
        : client.verifyIdToken({
            idToken: credential,
            audience: env.GOOGLE_CLIENT_ID,
          })
    );

    payload = ticket.getPayload();
  } catch (e) {
    // Keep detailed verification errors in the server log only.
    console.warn('[google] ID token rejected:', e?.message);

    throw ApiError.unauthorized(
      'Google sign-in could not be verified. Check that the Google client ID is the same in client and server settings, then try again.',
      'GOOGLE_INVALID'
    );
  }

  if (!payload?.sub || !payload.email) {
    throw ApiError.unauthorized(
      'Google did not return an email address',
      'GOOGLE_INVALID'
    );
  }

  if (!payload.email_verified) {
    throw ApiError.unauthorized(
      'Your Google email is not verified',
      'GOOGLE_UNVERIFIED'
    );
  }

  return {
    sub: payload.sub,
    email: String(payload.email).toLowerCase(),
    name: displayName(payload),
    picture: payload.picture,
  };
}

module.exports = { verifyGoogleCredential };
