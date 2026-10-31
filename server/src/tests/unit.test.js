// Unit tests: no database required.
require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../app');
const T = require('../utils/time');
const { effectiveStatus } = require('../services/campaignService');
const { rankRows } = require('../services/rankingService');
const { receiptVerificationRef, hmacHex, safeEqual } = require('../utils/crypto');
const adminV = require('../validators/admin');
const authV = require('../validators/auth');
const Settings = require('../models/Settings');
const Vote = require('../models/Vote');
const Payment = require('../models/Payment');
const { STATE_CODES } = require('../utils/states');

const app = createApp({ getReadiness: () => ({ db: true, indexes: true }) }); // no DB in unit tests

test.describe('campaign schedule (IST)', () => {
  test('opens 00:00 IST on day 1 and closes 23:59:59.999 IST on the second-last day', () => {
    const { startsAt, endsAt } = T.campaignWindow(2026, 10);
    assert.equal(startsAt.toISOString(), '2026-09-30T18:30:00.000Z'); // 00:00 IST Oct 1
    assert.equal(endsAt.toISOString(), '2026-10-30T18:29:59.999Z'); // 23:59:59.999 IST Oct 30; Oct 31 is results day
  });
  test('handles leap years and variable month lengths', () => {
    assert.equal(T.campaignWindow(2028, 2).endsAt.toISOString(), '2028-02-28T18:29:59.999Z');
    assert.equal(T.campaignWindow(2027, 2).endsAt.toISOString(), '2027-02-27T18:29:59.999Z');
    assert.equal(T.campaignWindow(2026, 4).endsAt.toISOString(), '2026-04-29T18:29:59.999Z');
  });
  test('the next campaign opens one results day (the last day of the month) after the previous one closes', () => {
    const a = T.campaignWindow(2026, 12); const b = T.campaignWindow(2027, 1);
    assert.equal(b.startsAt.getTime() - a.endsAt.getTime(), 86400_000 + 1); // one full results day between campaigns
    assert.deepEqual(T.nextMonth(2026, 12), { year: 2027, month: 1 });
  });
  test('IST date parts are independent of server timezone', () => {
    // 2026-10-31 19:00 UTC is already Nov 1 00:30 IST
    assert.deepEqual(T.istParts(new Date('2026-10-31T19:00:00Z')).month, 11);
    assert.equal(T.istParts(new Date('2026-10-31T18:29:59Z')).month, 10);
  });
  test('effective status is derived from the clock, with inclusive boundaries', () => {
    const { startsAt, endsAt } = T.campaignWindow(2026, 10);
    const c = { status: 'upcoming', startsAt, endsAt };
    assert.equal(effectiveStatus(c, new Date(startsAt.getTime() - 1)), 'upcoming');
    assert.equal(effectiveStatus(c, startsAt), 'active');
    assert.equal(effectiveStatus(c, endsAt), 'active');
    assert.equal(effectiveStatus(c, new Date(endsAt.getTime() + 1)), 'closed');
    assert.equal(effectiveStatus({ ...c, status: 'finalized' }, startsAt), 'finalized');
  });
  test('a custom cutoff leaves a closed gap before the next month', () => {
    const { startsAt, endsAt } = T.campaignWindow(2026, 10, '12:00:00');
    assert.equal(endsAt.toISOString(), '2026-10-30T06:30:00.999Z');
    assert.equal(effectiveStatus({ status: 'active', startsAt, endsAt }, new Date('2026-10-30T10:00:00Z')), 'closed');
  });
});

test.describe('ranking rules', () => {
  const row = (name, votes) => ({ celebrityId: name, name, votes });
  test('ties share a rank (1,2,2,4) and order is deterministic', () => {
    const r = rankRows([row('Delta', 5), row('Bravo', 9), row('Charlie', 5), row('Alpha', 12)]);
    assert.deepEqual(r.map((x) => [x.name, x.rank]), [['Alpha', 1], ['Bravo', 2], ['Charlie', 3], ['Delta', 3]]);
    const r2 = rankRows([row('B', 3), row('A', 3), row('C', 1)]);
    assert.deepEqual(r2.map((x) => [x.name, x.rank]), [['A', 1], ['B', 1], ['C', 3]]);
    assert.deepEqual(rankRows([row('B', 3), row('A', 3), row('C', 1)]).map((x) => x.name), r2.map((x) => x.name));
  });
  test('shows only what exists (no fabrication)', () => {
    assert.equal(rankRows([]).length, 0);
    assert.equal(rankRows([row('Only', 0)]).length, 1);
  });
});

test.describe('schema-level business rules', () => {
  test('Vote has a unique {userId, campaignId, categoryId} index', () => {
    const idx = Vote.schema.indexes().find(([k]) => k.userId && k.campaignId && k.categoryId);
    assert.ok(idx, 'index missing');
    assert.equal(idx[1].unique, true);
  });
  test('Vote.paymentId and Payment order/payment ids are unique', () => {
    assert.equal(Vote.schema.path('paymentId').options.unique, true);
    assert.equal(Payment.schema.path('razorpayPaymentId').options.unique, true);
    assert.equal(Payment.schema.path('razorpayOrderId').options.unique, true);
    assert.equal(Payment.schema.path('activeKey').options.unique, true);
  });
  test('payment amount is capped at INR 7 and currency fixed to INR', () => {
    assert.equal(Payment.schema.path('amountPaise').options.max, 700);
    assert.deepEqual(Payment.schema.path('currency').enumValues, ['INR']);
  });
  test('Settings reject amounts outside 0..7 or non-integers', () => {
    for (const bad of [-1, 8, 1.5, 100]) assert.ok(new Settings({ voteAmountInr: bad }).validateSync(), `accepted ${bad}`);
    for (const ok of [0, 1, 7]) assert.equal(new Settings({ voteAmountInr: ok }).validateSync(), undefined);
  });
  test('admin settings validator enforces the same range', () => {
    assert.ok(!adminV.settings.safeParse({ voteAmountInr: 8 }).success);
    assert.ok(!adminV.settings.safeParse({ voteAmountInr: -1 }).success);
    assert.ok(!adminV.settings.safeParse({ voteAmountInr: 2.5 }).success);
    assert.ok(adminV.settings.safeParse({ voteAmountInr: 7 }).success);
    assert.ok(adminV.settings.safeParse({ voteAmountInr: 0 }).success);
  });
  test('all 36 states/UTs are available', () => assert.equal(STATE_CODES.length, 36));
});

test.describe('crypto helpers', () => {
  test('receipt verification ref is deterministic and tamper-evident', () => {
    const a = { receiptNo: 'FV-202610-AAAA1111', voteId: 'v1', userId: 'u1', celebrityId: 'c1' };
    assert.equal(receiptVerificationRef(a), receiptVerificationRef(a));
    assert.notEqual(receiptVerificationRef(a), receiptVerificationRef({ ...a, celebrityId: 'c2' }));
    assert.equal(receiptVerificationRef(a).length, 24);
  });
  test('safeEqual compares in constant time and handles length mismatch', () => {
    assert.ok(safeEqual('abc', 'abc'));
    assert.ok(!safeEqual('abc', 'abd'));
    assert.ok(!safeEqual('abc', 'abcd'));
    assert.equal(hmacHex('k', 'm').length, 64);
  });
});

test.describe('input validation', () => {
  test('passwords need length, a letter and a number', () => {
    for (const bad of ['short1', 'longpasswordnodigits', '12345678901']) assert.ok(!authV.register.safeParse({ name: 'Ab', email: 'a@b.co', password: bad }).success, bad);
    assert.ok(authV.register.safeParse({ name: 'Ab', email: 'A@B.co', password: 'GoodPass123' }).success);
  });
  test('registration with bad input returns 422 and never touches the database', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'x', email: 'nope', password: '1' });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });
  test('NoSQL operator injection in login is stripped/rejected', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    assert.equal(res.status, 422);
  });
});

test.describe('API authorization (no session)', () => {
  const cases = [
    ['get', '/api/admin/dashboard'], ['post', '/api/admin/campaigns/507f1f77bcf86cd799439011/finalize'],
    ['patch', '/api/admin/settings'], ['post', '/api/admin/payments/507f1f77bcf86cd799439011/refund'],
    ['get', '/api/admin/audit-logs'], ['post', '/api/admin/ai/biography'],
    ['get', '/api/receipts'], ['get', '/api/receipts/507f1f77bcf86cd799439011'], ['get', '/api/receipts/507f1f77bcf86cd799439011/pdf'],
    ['post', '/api/votes'], ['post', '/api/payments/order'], ['post', '/api/payments/verify'], ['get', '/api/me/dashboard'],
  ];
  for (const [m, url] of cases) {
    test(`${m.toUpperCase()} ${url} -> 401`, async () => {
      const res = await request(app)[m](url).send({});
      assert.equal(res.status, 401);
    });
  }
  test('a forged user JWT cannot open the admin portal', async () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ sub: '507f1f77bcf86cd799439011', tv: 0, adm: true }, 'not-the-secret');
    const res = await request(app).get('/api/admin/dashboard').set('Cookie', `fv_admin_token=${forged}`);
    assert.equal(res.status, 401);
  });
  test('webhook with a missing/invalid signature is rejected before any processing', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: {} });
    let res = await request(app).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').send(body);
    assert.equal(res.status, 401);
    res = await request(app).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', 'deadbeef').send(body);
    assert.equal(res.status, 401);
  });
  test('unknown routes return JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });
  test('security headers are set', async () => {
    const res = await request(app).get('/health');
    assert.ok(res.headers['x-content-type-options']);
    assert.ok(!res.headers['x-powered-by']);
  });
});

test.describe('Brevo email (REST)', () => {
  const env = require('../config/env');
  const { send } = require('../services/emailService');
  test('posts to the Brevo transactional endpoint with api-key header and JSON body', async () => {
    env.BREVO_API_KEY = 'xkeysib-test';
    let call;
    const fakeFetch = async (url, init) => { call = { url, init }; return { ok: true, text: async () => '' }; };
    const r = await send('a@b.com', 'Hi', '<p>x</p>', 'link', fakeFetch);
    env.BREVO_API_KEY = undefined;
    assert.equal(r.sent, true);
    assert.equal(call.url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(call.init.headers['api-key'], 'xkeysib-test');
    const body = JSON.parse(call.init.body);
    assert.deepEqual(body.to, [{ email: 'a@b.com' }]);
    assert.equal(body.subject, 'Hi');
    assert.ok(body.sender.email && body.htmlContent);
  });
  test('surfaces provider failures so callers can log them', async () => {
    env.BREVO_API_KEY = 'k';
    const bad = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
    await assert.rejects(() => send('a@b.com', 's', 'h', 'l', bad), /Brevo 401/);
    env.BREVO_API_KEY = undefined;
  });
  test('without an API key nothing is sent', async () => {
    assert.deepEqual(await send('a@b.com', 's', 'h', 'l', async () => { throw new Error('must not be called'); }), { sent: false });
  });
});

test.describe('Google sign-in verification', () => {
  const env = require('../config/env');
  const { verifyGoogleCredential } = require('../services/googleAuthService');
  const ticket = (p) => async () => ({ getPayload: () => p });
  test('is unavailable until GOOGLE_CLIENT_ID is configured', async () => {
    env.GOOGLE_CLIENT_ID = undefined;
    await assert.rejects(() => verifyGoogleCredential('x', ticket({})), (e) => e.code === 'GOOGLE_UNAVAILABLE');
  });
  test('accepts a verified payload and normalises the email', async () => {
    env.GOOGLE_CLIENT_ID = 'cid';
    const g = await verifyGoogleCredential('tok', ticket({ sub: '1', email: 'Amit@Example.com', email_verified: true, name: 'Amit' }));
    assert.deepEqual([g.sub, g.email, g.name], ['1', 'amit@example.com', 'Amit']);
  });
  test('rejects unverified emails and bad tokens', async () => {
    env.GOOGLE_CLIENT_ID = 'cid';
    await assert.rejects(() => verifyGoogleCredential('t', ticket({ sub: '1', email: 'a@b.com', email_verified: false })), (e) => e.code === 'GOOGLE_UNVERIFIED');
    await assert.rejects(() => verifyGoogleCredential('t', async () => { throw new Error('bad signature'); }), (e) => e.code === 'GOOGLE_INVALID');
    env.GOOGLE_CLIENT_ID = undefined;
  });
  test('route validates input shape before touching Google', async () => {
    const res = await request(app).post('/api/auth/google').set('X-FV-Client', 'web').send({ credential: 'short' });
    assert.equal(res.status, 422);
  });
});

test.describe('custom vote amount rules', () => {
  const { resolveAmountInr } = require('../services/amountService');
  const S = (voteAmountInr, allowCustomAmount) => ({ voteAmountInr, allowCustomAmount });
  test('defaults to the admin amount when nothing is requested', () => {
    assert.equal(resolveAmountInr(S(3, true)), 3);
    assert.equal(resolveAmountInr(S(0, true), undefined), 0);
  });
  test('custom ON: any whole rupee 0..7 is accepted', () => {
    for (const n of [0, 1, 4, 7]) assert.equal(resolveAmountInr(S(2, true), n), n);
  });
  test('rejects out-of-range, fractional and non-numeric amounts', () => {
    for (const bad of [-1, 8, 2.5, '5', NaN, 100]) assert.throws(() => resolveAmountInr(S(2, true), bad), (e) => e.code === 'AMOUNT_INVALID');
  });
  test('custom OFF: only the admin amount is accepted', () => {
    assert.equal(resolveAmountInr(S(5, false), 5), 5);
    assert.equal(resolveAmountInr(S(5, false)), 5);
    assert.throws(() => resolveAmountInr(S(5, false), 1), (e) => e.code === 'CUSTOM_AMOUNT_DISABLED');
  });
  test('a corrupt stored amount is refused rather than charged', () => {
    assert.throws(() => resolveAmountInr(S(9, true), 1), (e) => e.code === 'AMOUNT_INVALID');
  });
  test('request validator accepts an optional integer amount 0..7', () => {
    const v = require('../validators/public').vote;
    const base = { categoryId: '507f1f77bcf86cd799439011', celebrityId: '507f1f77bcf86cd799439012' };
    assert.ok(v.safeParse(base).success);
    assert.ok(v.safeParse({ ...base, amountInr: 7 }).success);
    for (const bad of [8, -1, 1.5, '3']) assert.ok(!v.safeParse({ ...base, amountInr: bad }).success);
  });
});

test.describe('celebrity standing (regression: populated categoryId)', () => {
  const { mock } = require('node:test');
  const mongoose = require('mongoose');
  const ranking = require('../services/rankingService');
  const { Vote, Celebrity, Campaign } = require('../models');
  const catId = new mongoose.Types.ObjectId();
  const celebId = new mongoose.Types.ObjectId();
  const now = Date.now();
  const campaign = { _id: new mongoose.Types.ObjectId(), key: '2026-10', title: 'October 2026 Campaign', status: 'active', startsAt: new Date(now - 864e5), endsAt: new Date(now + 864e5) };
  const celeb = { _id: celebId, name: 'Alia Bhatt', code: 'CEL-1', slug: 'alia-bhatt', image: null };

  test('accepts a populated Category document (what GET /celebrities/:slug passes)', async (t) => {
    ranking.clearRankingCache();
    t.mock.method(Vote, 'aggregate', async (pipe) => (pipe[1].$group._id === '$celebrityId' ? [{ _id: celebId, votes: 7 }] : [{ _id: { state: 'PB', celebrityId: celebId }, votes: 7 }]));
    t.mock.method(Celebrity, 'find', () => ({ select: async () => [celeb] }));
    t.mock.method(Campaign, 'findOne', () => ({ sort: async () => null }));
    const populated = { _id: catId, name: 'Actors', slug: 'actors', status: 'active', toString() { return '[object Category]'; } };
    const s = await ranking.celebrityStanding(campaign, { _id: celebId, categoryId: populated, state: null });
    assert.equal(s.votes, 7);
    assert.equal(s.nationalRank, 1);
  });

  test('a bare ObjectId and a hex string still work', async (t) => {
    t.mock.method(Vote, 'aggregate', async () => []);
    t.mock.method(Celebrity, 'find', () => ({ select: async () => [celeb] }));
    t.mock.method(Campaign, 'findOne', () => ({ sort: async () => null }));
    for (const cid of [catId, String(catId)]) {
      ranking.clearRankingCache();
      const s = await ranking.celebrityStanding(campaign, { _id: celebId, categoryId: cid, state: null });
      assert.equal(s.votes, 0);
    }
  });

  test('a slug or missing id is a 400, never an unhandled BSONError', async () => {
    ranking.clearRankingCache();
    for (const bad of ['alia-bhatt', undefined, null, '[object Object]']) {
      await assert.rejects(() => ranking.celebrityStanding(campaign, { _id: celebId, categoryId: bad }), (e) => e.status === 400 && e.code === 'BAD_ID');
    }
  });
});

test.describe('Google sign-in request validation', () => {
  const tok = `${'a'.repeat(30)}.${'b'.repeat(900)}.${'c'.repeat(340)}`;
  test('accepts a realistic ID token with or without a state', () => {
    assert.ok(authV.google.safeParse({ credential: tok }).success);
    assert.ok(authV.google.safeParse({ credential: tok, state: 'PB' }).success);
  });
  test('empty or unknown state is ignored instead of failing the sign-in', () => {
    for (const state of ['', null, undefined, 'Punjab', 'zz']) {
      const r = authV.google.safeParse({ credential: tok, state });
      assert.ok(r.success, String(state));
      assert.equal(r.data.state, undefined);
    }
  });
  test('accepts the idToken alias; rejects a missing or tiny credential', () => {
    assert.equal(authV.google.safeParse({ idToken: tok }).data.credential, tok);
    for (const bad of [{}, { credential: '' }, { credential: 'x' }, { credential: 123 }, null]) assert.ok(!authV.google.safeParse(bad).success);
  });
  test('POST /api/auth/google: valid shape reaches verification (not 422); garbage is 422', async () => {
    const ok = await request(app).post('/api/auth/google').set('X-FV-Client', 'web').send({ credential: tok });
    assert.notEqual(ok.status, 422);
    const bad = await request(app).post('/api/auth/google').set('X-FV-Client', 'web').send({});
    assert.equal(bad.status, 422);
  });
});

test.describe('guest sessions', () => {
  test('GET /api/auth/session is 200 with user:null for visitors (no 401)', async () => {
    const r = await request(app).get('/api/auth/session');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.user, null);
  });
  test('GET /api/admin/auth/session is 200 with user:null without an admin cookie', async () => {
    const r = await request(app).get('/api/admin/auth/session');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.user, null);
  });
  test('protected routes still answer 401 to guests', async () => {
    for (const path of ['/api/auth/me', '/api/admin/auth/me', '/api/admin/dashboard']) assert.equal((await request(app).get(path)).status, 401, path);
  });
});

test.describe('Wikipedia-only celebrity image pipeline (offline, mocked)', () => {
  const img = require('../services/celebrityImageService');
  const CELEBS = require('../data/celebrities');
  const { STATE_CODES: SC } = require('../utils/states');
  const { slugify } = require('../validators/common');
  const response = (body, { status = 200, type = 'application/json', headers = {} } = {}) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: (key) => headers[key.toLowerCase()] || (key.toLowerCase() === 'content-type' ? type : null) },
    json: async () => body, arrayBuffer: async () => Buffer.from(body),
  });
  const wikiPage = (over = {}) => ({
    type: 'standard', title: 'Alia Bhatt',
    thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Alia.jpg/330px-Alia.jpg' },
    originalimage: { source: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Alia.jpg' },
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Alia_Bhatt' } }, ...over,
  });

  test('resolves only the Wikipedia article lead image', async () => {
    const r = await img.findPortrait({ name: 'Alia Bhatt', wikiTitle: 'Alia Bhatt' }, {
      fetchImpl: async (url) => url.includes('/page/summary/') ? response(wikiPage()) : response({}, { status: 404 }),
    });
    assert.equal(r.status, 'found');
    assert.equal(r.source, 'wikipedia');
    assert.match(r.imageUrl, /upload\.wikimedia\.org/);
    assert.match(r.pageUrl, /en\.wikipedia\.org\/wiki\/Alia_Bhatt/);
  });

  test('rejects disambiguation, mismatched titles, and unapproved image hosts', async () => {
    for (const page of [wikiPage({ type: 'disambiguation' }), wikiPage({ title: 'Alia Khan' }), wikiPage({ thumbnail: { source: 'https://example.com/alia.jpg' }, originalimage: { source: 'https://example.com/alia-full.jpg' } })]) {
      const r = await img.findPortrait({ name: 'Alia Bhatt', wikiTitle: 'Alia Bhatt' }, { fetchImpl: async () => response(page) });
      assert.equal(r.status, 'placeholder');
    }
  });

  test('retries Wikimedia rate limits using Retry-After and then succeeds', async () => {
    let calls = 0; const delays = [];
    const r = await img.fetchWithRetry('https://example.test', {}, async () => {
      calls += 1;
      if (calls === 1) return response({}, { status: 429, headers: { 'retry-after': '0' } });
      return response({});
    }, { retries: 2, sleep: async (ms) => delays.push(ms) });
    assert.equal(r.status, 200); assert.equal(calls, 2); assert.equal(delays.length, 1);
  });

  test('download accepts image content types and rejects unapproved hosts or HTML', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const ok = await img.download('https://upload.wikimedia.org/wikipedia/commons/a/ab/a.png', {
      fetchImpl: async () => response(png, { type: 'image/png' }),
    });
    assert.equal(ok.ext, 'png');
    await assert.rejects(() => img.download('https://example.com/a.png', { fetchImpl: async () => response(png, { type: 'image/png' }) }), /HTTPS Wikimedia image host required/);
    await assert.rejects(() => img.download('https://upload.wikimedia.org/a', { fetchImpl: async () => response('<html>', { type: 'text/html' }) }), /Unsupported image type/);
  });

  test('seed lineup has unique slugs, valid state codes and all eight categories', () => {
    const slugs = []; const cats = ['actors', 'singers-musicians', 'influencers-content-creators', 'athletes-sports-personalities', 'tv-personalities', 'comedians', 'models', 'other'];
    for (const [cat, list] of Object.entries(CELEBS)) {
      assert.ok(cats.includes(cat), cat);
      for (const [name, wiki, state, bio] of list) { slugs.push(slugify(name)); assert.ok(name && wiki && bio.length > 20, name); if (state) assert.ok(SC.includes(state), `${name}: ${state}`); }
    }
    assert.equal(new Set(slugs).size, slugs.length);
    assert.deepEqual(Object.keys(CELEBS).sort(), [...cats].sort());
  });
});

test.describe('HTTP cache policy', () => {
  test('API responses are private by default (no-store), including sessions and 404s', async () => {
    for (const path of ['/api/auth/session', '/api/nope']) assert.equal((await request(app).get(path)).headers['cache-control'], 'no-store', path);
  });
  test('a public route that fails validation is never cacheable', async () => {
    const r = await request(app).get('/api/rankings?scope=bogus');
    assert.equal(r.status, 422);
    assert.equal(r.headers['cache-control'], 'no-store');
  });
  test('publicCache sets a short shared-cache lifetime', () => {
    const { publicCache } = require('../middleware/security');
    const headers = {}; publicCache(10)({}, { set: (k, v) => { headers[k] = v; } }, () => {});
    assert.equal(headers['Cache-Control'], 'public, max-age=10, stale-while-revalidate=30');
  });
});

test.describe('production configuration guard', () => {
  const { spawnSync } = require('node:child_process');
  const boot = (extra) => spawnSync(process.execPath, ['-e', "require('./src/config/env')"], {
    cwd: require('node:path').join(__dirname, '..', '..'), encoding: 'utf8',
    env: { PATH: process.env.PATH, MONGODB_URI: 'mongodb://x/y', JWT_SECRET: 'a'.repeat(40), ADMIN_JWT_SECRET: 'b'.repeat(40), RECEIPT_HMAC_SECRET: 'c'.repeat(40), ...extra },
  });
  test('refuses a production boot with http/localhost URLs', () => {
    const r = boot({ NODE_ENV: 'production', CLIENT_URL: 'http://localhost:5173', SERVER_URL: 'http://localhost:5000' });
    assert.equal(r.status, 1); assert.match(r.stderr, /CLIENT_URL must be your public https/); assert.match(r.stderr, /SERVER_URL must be/);
  });
  test('refuses reused or placeholder secrets', () => {
    assert.match(boot({ JWT_SECRET: 'z'.repeat(40), ADMIN_JWT_SECRET: 'z'.repeat(40) }).stderr, /must all be different/);
    assert.match(boot({ JWT_SECRET: 'replace-with-64-hex-chars-' + 'x'.repeat(20) }).stderr, /placeholder secrets/);
  });
  test('accepts a correct production configuration', () => {
    const r = boot({ NODE_ENV: 'production', CLIENT_URL: 'https://famevote.vercel.app', SERVER_URL: 'https://famevote-api.onrender.com' });
    assert.equal(r.status, 0, r.stderr);
  });
});

test.describe('Google sign-in controller (database stubbed, Google verification stubbed)', () => {
  const env = require('../config/env');
  const { OAuth2Client } = require('google-auth-library');
  const User = require('../models/User');
  const origFind = User.findOne; const origCreate = User.create; const origVerify = OAuth2Client.prototype.verifyIdToken;
  const claims = (o) => { OAuth2Client.prototype.verifyIdToken = async () => ({ getPayload: () => ({ sub: 'g1', email: 'a@x.test', email_verified: true, name: 'Aa Bb', ...o }) }); };
  const existing = (o) => { const u = { _id: 'u1', status: 'active', role: 'user', tokenVersion: 0, authProviders: ['password'], passwordHash: 'hash', saves: 0, async save() { this.saves += 1; }, toSafeJSON() { return { id: 'u1', email: 'a@x.test' }; }, ...o }; User.findOne = () => ({ select: async () => u }); return u; };
  const post = (b = {}) => request(app).post('/api/auth/google').set('X-FV-Client', 'web').send({ credential: 'x'.repeat(40), ...b });
  test.beforeEach(() => { env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com'; });
  test.afterEach(() => { User.findOne = origFind; User.create = origCreate; OAuth2Client.prototype.verifyIdToken = origVerify; });

  test('503 with a clear code when the server has no GOOGLE_CLIENT_ID', async () => {
    env.GOOGLE_CLIENT_ID = undefined; claims({});
    const r = await post(); assert.equal(r.status, 503); assert.equal(r.body.error.code, 'GOOGLE_UNAVAILABLE');
  });
  test('a token Google rejects (for example a client-ID mismatch) answers 401 GOOGLE_INVALID', async () => {
    OAuth2Client.prototype.verifyIdToken = async () => { throw new Error('Wrong recipient, payload audience != requiredAudience'); };
    const r = await post(); assert.equal(r.status, 401); assert.equal(r.body.error.code, 'GOOGLE_INVALID');
  });
  test('new user: 201, state saved, session cookie set', async () => {
    claims({}); User.findOne = () => ({ select: async () => null });
    let made; User.create = async (d) => { made = d; return { _id: 'n1', ...d, toSafeJSON: () => ({ id: 'n1', state: d.state }) }; };
    const r = await post({ state: 'KA' });
    assert.equal(r.status, 201); assert.equal(made.state, 'KA'); assert.deepEqual(made.authProviders, ['google']);
    assert.ok((r.headers['set-cookie'] || []).length, 'session cookie');
  });
  test('existing Google user: 200; a different Google account on the same e-mail: 409 GOOGLE_MISMATCH', async () => {
    claims({}); existing({ googleId: 'g1', authProviders: ['google'], passwordHash: undefined });
    assert.equal((await post()).status, 200);
    claims({ sub: 'OTHER' });
    assert.equal((await post()).body.error.code, 'GOOGLE_MISMATCH');
  });
  test('pre-registered password account: linked, password removed and old sessions revoked', async () => {
    claims({}); const u = existing({});
    const r = await post();
    assert.equal(r.status, 200); assert.equal(r.body.data.passwordRemoved, true);
    assert.equal(u.passwordHash, undefined); assert.equal(u.tokenVersion, 1); assert.equal(u.googleId, 'g1');
    assert.deepEqual(u.authProviders, ['google']);
  });
  test('staff accounts are never linked; unverified Google e-mails are refused', async () => {
    claims({}); existing({ role: 'admin' });
    assert.equal((await post()).body.error.code, 'ACCOUNT_LINK_REQUIRED');
    claims({ email_verified: false });
    assert.equal((await post()).body.error.code, 'GOOGLE_UNVERIFIED');
  });
});

test.describe('sample-data plan (pure, deterministic)', () => {
  const plan = require('../services/demoPlan');
  const { campaignWindow } = require('../utils/time');
  const first = new Date('2026-08-12T00:00:00Z'); const last = new Date('2026-10-20T00:00:00Z'); const now = new Date('2026-10-21T02:00:00Z');
  const voters = plan.buildVoters({ count: 420, stateCodes: STATE_CODES, firstJoin: first, lastJoin: last });
  const cats = ['actors', 'singers', 'comics'].map((slug, ci) => ({ slug, celebs: Array.from({ length: 8 }, (_, i) => ({ id: `${slug}${i}`, order: i, state: i % 2 ? 'MH' : null })) }));
  const { startsAt, endsAt } = campaignWindow(2026, 10);
  const votes = plan.planVotes({ campaignKey: '2026-10', voters, categories: cats, startsAt, endsAt, now });

  test('voters: unique non-routable e-mails, every state/UT covered', () => {
    assert.equal(new Set(voters.map((v) => v.email)).size, 420);
    assert.ok(voters.every((v) => v.email.endsWith('@demo.famevote.test')));
    assert.equal(new Set(voters.map((v) => v.state)).size, STATE_CODES.length);
  });
  test('one vote per voter per category; none before the voter joined or after now/end', () => {
    const seen = new Set();
    for (const v of votes) {
      const k = `${v.voterIdx}:${v.categorySlug}`; assert.ok(!seen.has(k), 'duplicate slot'); seen.add(k);
      assert.ok(v.at >= voters[v.voterIdx].joinedAt, 'voted before joining');
      assert.ok(v.at >= startsAt && v.at <= endsAt && v.at <= now);
    }
    assert.ok(votes.length > 420, 'enough votes for meaningful rankings');
  });
  test('a small pool (60) still produces valid, unique voters and votes', () => {
    const small = plan.buildVoters({ count: 60, stateCodes: STATE_CODES, firstJoin: first, lastJoin: last });
    assert.equal(new Set(small.map((v) => v.email)).size, 60);
    assert.ok(small.every((v) => STATE_CODES.includes(v.state)));
    assert.ok(plan.planVotes({ campaignKey: '2026-10', voters: small, categories: cats, startsAt, endsAt, now }).length > 60);
  });
  test('every celebrity in every category gets at least one vote (no empty rows), even with 60 voters', () => {
    const small = plan.buildVoters({ count: 60, stateCodes: STATE_CODES, firstJoin: first, lastJoin: last });
    const vs = plan.planVotes({ campaignKey: '2026-10', voters: small, categories: cats, startsAt, endsAt, now });
    for (const c of cats) for (const ce of c.celebs) assert.ok(vs.some((v) => v.categorySlug === c.slug && v.celebrityId === ce.id), `${ce.id} has no vote`);
  });
  test('deterministic, and popularity gives a real leader (not a flat tie)', () => {
    const again = plan.planVotes({ campaignKey: '2026-10', voters, categories: cats, startsAt, endsAt, now });
    assert.deepEqual(again.map((v) => v.celebrityId), votes.map((v) => v.celebrityId));
    const tally = {}; votes.filter((v) => v.categorySlug === 'actors').forEach((v) => { tally[v.celebrityId] = (tally[v.celebrityId] || 0) + 1; });
    const sorted = Object.values(tally).sort((a, b) => b - a);
    assert.ok(sorted[0] > sorted[sorted.length - 1] * 1.5);
  });
  test('home-state boost: Maharashtra voters favour Maharashtra celebrities more than others do', () => {
    const share = (pred) => { const vs = votes.filter((v) => v.categorySlug === 'actors' && pred(voters[v.voterIdx])); return vs.filter((v) => Number(v.celebrityId.replace('actors', '')) % 2 === 1).length / Math.max(1, vs.length); };
    assert.ok(share((x) => x.state === 'MH') > share((x) => x.state !== 'MH'));
  });
});

test.describe('fan-style receipt PDF (no database)', () => {
  const { Category } = require('../models');
  const svc = require('../services/receiptService');
  const { fanLine, firstName, initials: initialsOf } = require('../data/fanCopy');
  const render = async (over = {}) => {
    const orig = Category.findById; Category.findById = () => ({ select: () => ({ lean: () => ({ catch: () => Promise.resolve({ slug: 'actors' }) }) }) });
    const chunks = []; const { Writable } = require('node:stream');
    const out = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } }); out.setHeader = () => {};
    const r = { receiptNo: 'FV-202610-A1B2C3D4', verificationRef: 'F00DBEEFCAFE1234ABCD9876', issuedAt: new Date('2026-10-21T07:12:00Z'), snapshot: { userName: 'Aarav Sharma', celebrityCode: 'CEL-1', celebrityName: 'Shah Rukh Khan', categoryName: 'Actors', campaignLabel: 'October 2026', stateName: 'Maharashtra', amountPaise: 0, ...over } };
    try { await svc.streamReceiptPdf(r, out); await new Promise((res) => out.on('finish', res)); } finally { Category.findById = orig; }
    return Buffer.concat(chunks);
  };
  test('produces a valid single-page PDF, including very long names', async () => {
    for (const over of [{}, { celebrityName: 'Priyanka Chopra Jonas the Third of Mumbai', userName: 'V'.repeat(80) }]) {
      const pdf = await render(over);
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.length > 5000);
      assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1, 'exactly one page');
    }
  });
  test('fan copy helpers', () => {
    assert.equal(firstName('Shah Rukh Khan'), 'Shah'); assert.equal(initialsOf('A. R. Rahman'), 'AR'); assert.equal(initialsOf('???'), 'FV');
    assert.ok(fanLine('actors', 3).length > 5); assert.ok(fanLine('unknown', 1).length > 3);
  });
});
