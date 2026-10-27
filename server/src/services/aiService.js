const crypto = require('crypto');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

/**
 * Gemini is an optional admin-productivity layer. It can only RETURN TEXT/JSON drafts.
 * It has no access to payments, votes, rankings, refunds or fraud decisions, and nothing it
 * returns is persisted or published without an explicit human action.
 */
let client = null;
let breakerUntil = 0; // simple circuit breaker after quota/rate-limit errors
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

const isConfigured = () => Boolean(env.GEMINI_API_KEY);

function getClient() {
  if (client) return client;
  const { GoogleGenAI } = require('@google/genai');
  client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return client;
}

class AiUnavailable extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

async function generateJson({ feature, system, prompt, cacheable = true }) {
  if (!isConfigured()) throw new AiUnavailable('not_configured');
  if (Date.now() < breakerUntil) throw new AiUnavailable('quota_cooldown');

  const key = crypto.createHash('sha256').update(`${feature}|${system}|${prompt}`).digest('hex');
  const hit = cache.get(key);
  if (cacheable && hit && hit.exp > Date.now()) return hit.val;

  try {
    const call = getClient().models.generateContent({
      model: env.GEMINI_MODEL,
      contents: prompt,
      config: { systemInstruction: system, responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 800 },
    });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), env.GEMINI_TIMEOUT_MS));
    const res = await Promise.race([call, timeout]);
    const val = JSON.parse(res.text);
    if (cacheable) { cache.set(key, { val, exp: Date.now() + CACHE_TTL }); if (cache.size > 300) cache.clear(); }
    return val;
  } catch (e) {
    const msg = String(e?.message || e);
    if (/429|quota|rate|RESOURCE_EXHAUSTED/i.test(msg)) { breakerUntil = Date.now() + 60_000; throw new AiUnavailable('quota_exceeded'); }
    if (/timeout/.test(msg)) throw new AiUnavailable('timeout');
    console.error('[ai] gemini error', feature, msg.slice(0, 200));
    throw new AiUnavailable('error');
  }
}

/**
 * Runs an AI feature, and ALWAYS returns something usable: on any failure the manual
 * `fallback()` result is returned with ai:false so the admin UI keeps working.
 */
async function withFallback(feature, aiFn, fallbackFn) {
  try {
    const data = await aiFn();
    return { ai: true, feature, draft: true, data };
  } catch (e) {
    if (!(e instanceof AiUnavailable) && !(e instanceof SyntaxError)) throw e;
    return { ai: false, feature, draft: true, reason: e.reason || 'bad_response', message: 'AI assistance is unavailable right now. A manual starting point is provided instead.', data: await fallbackFn() };
  }
}

const clip = (s, n = 600) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

module.exports = { generateJson, withFallback, isConfigured, AiUnavailable, clip, ApiError };
