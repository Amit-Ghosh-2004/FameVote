// Unit tests for gender subcategories, phone sign-in and admin-only fields. No database or network needed.
require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../app');
const env = require('../config/env');
const { normalizePhone, maskPhone, placeholderEmail, isPlaceholderEmail, contactOf } = require('../utils/phone');
const { PhoneOtp, Vote, Celebrity, User } = require('../models');
const otp = require('../services/otpService');
const ranking = require('../services/rankingService');
const authV = require('../validators/auth');
const adminV = require('../validators/admin');
const pubV = require('../validators/public');
const { publicCelebrity } = require('../controllers/publicController');
const CELEBS = require('../data/celebrities');
const { STATE_CODES } = require('../utils/states');
const { slugify } = require('../validators/common');
const { GENDERS } = require('../utils/gender');

// Unit tests run without a database; the readiness gate itself is covered in readiness.test.js.
const app = createApp({ getReadiness: () => ({ db: true, indexes: true }) });
const oid = () => new (require('mongoose').Types.ObjectId)();

test.describe('phone numbers', () => {
  test('normalises Indian and international numbers to E.164', () => {
    assert.equal(normalizePhone('98765 43210'), '+919876543210');
    assert.equal(normalizePhone('09876543210'), '+919876543210');
    assert.equal(normalizePhone('+91 98765-43210'), '+919876543210');
    assert.equal(normalizePhone('919876543210'), '+919876543210');
    assert.equal(normalizePhone('+14155552671'), '+14155552671');
  });
  test('rejects bad numbers', () => {
    for (const bad of ['', '12345', '5876543210', '+915876543210', 'abcdefghij', '+0123456789', '98765432101234567', null, undefined, 5]) assert.equal(normalizePhone(bad), null, String(bad));
  });
  test('placeholder e-mail round-trips and never exposes the full number', () => {
    const e = placeholderEmail('+919876543210');
    assert.ok(isPlaceholderEmail(e));
    assert.equal(contactOf(e), '+91*******210');
    assert.equal(contactOf('a@b.com'), 'a@b.com');
    assert.equal(maskPhone('+919876543210'), '+91*******210');
  });
  test('request validators normalise and reject', () => {
    assert.equal(authV.phoneSend.parse({ phone: '98765 43210' }).phone, '+919876543210');
    assert.throws(() => authV.phoneSend.parse({ phone: '123' }));
    assert.throws(() => authV.phoneVerify.parse({ phone: '9876543210', code: '12345' }));
    const ok = authV.phoneVerify.parse({ phone: '9876543210', code: '123456', name: '', state: '' });
    assert.equal(ok.name, undefined); assert.equal(ok.state, undefined);
  });
});

/** In-memory stand-in for the PhoneOtp collection. */
function fakeOtpStore() {
  const rows = new Map();
  const orig = { findOne: PhoneOtp.findOne, updateOne: PhoneOtp.updateOne, deleteOne: PhoneOtp.deleteOne };
  PhoneOtp.findOne = async ({ phone }) => (rows.has(phone) ? { ...rows.get(phone) } : null);
  PhoneOtp.updateOne = async ({ phone }, upd) => {
    const cur = rows.get(phone) || {};
    if (upd.$set) rows.set(phone, { phone, ...cur, ...upd.$set });
    if (upd.$inc) for (const [k, v] of Object.entries(upd.$inc)) rows.get(phone)[k] = (rows.get(phone)[k] || 0) + v;
    return {};
  };
  PhoneOtp.deleteOne = async ({ phone, codeHash }) => { const r = rows.get(phone); if (r && (!codeHash || r.codeHash === codeHash)) { rows.delete(phone); return { deletedCount: 1 }; } return { deletedCount: 0 }; };
  return { rows, restore: () => Object.assign(PhoneOtp, orig) };
}

test.describe('one-time codes (store stubbed)', () => {
  const phone = '+919876543210';
  const run = async (fn) => { const store = fakeOtpStore(); const was = env.phoneLoginEnabled; env.phoneLoginEnabled = true; try { await fn(store); } finally { env.phoneLoginEnabled = was; store.restore(); } };
  const t0 = new Date('2026-10-20T10:00:00Z');

  test('a code is stored only as a keyed hash and works once', () => run(async (store) => {
    let sent; await otp.requestCode(phone, { now: t0, send: async (p, c) => { sent = c; } });
    assert.match(sent, /^\d{6}$/);
    assert.ok(!JSON.stringify([...store.rows.values()]).includes(sent), 'plain code must not be stored');
    await otp.verifyCode(phone, sent, { now: new Date(t0.getTime() + 1000) });
    await assert.rejects(otp.verifyCode(phone, sent, { now: new Date(t0.getTime() + 2000) }), { code: 'INVALID_OTP' });
  }));
  test('wrong codes burn attempts; the code dies after the limit', () => run(async () => {
    let sent; await otp.requestCode(phone, { now: t0, send: async (p, c) => { sent = c; } });
    const wrong = sent === '000000' ? '111111' : '000000';
    for (let i = 0; i < otp.MAX_ATTEMPTS; i += 1) await assert.rejects(otp.verifyCode(phone, wrong, { now: t0 }), { code: 'INVALID_OTP' });
    await assert.rejects(otp.verifyCode(phone, sent, { now: t0 }), { code: 'INVALID_OTP' }); // even the right one is refused now
  }));
  test('expires after 5 minutes', () => run(async () => {
    let sent; await otp.requestCode(phone, { now: t0, send: async (p, c) => { sent = c; } });
    await assert.rejects(otp.verifyCode(phone, sent, { now: new Date(t0.getTime() + otp.TTL_MS + 1) }), { code: 'INVALID_OTP' });
  }));
  test('resend cooldown and hourly cap', () => run(async () => {
    const send = async () => {};
    await otp.requestCode(phone, { now: t0, send });
    await assert.rejects(otp.requestCode(phone, { now: new Date(t0.getTime() + 5000), send }), { code: 'OTP_COOLDOWN' });
    let t = t0;
    for (let i = 0; i < 4; i += 1) { t = new Date(t.getTime() + otp.COOLDOWN_MS + 1); await otp.requestCode(phone, { now: t, send }); }
    t = new Date(t.getTime() + otp.COOLDOWN_MS + 1);
    await assert.rejects(otp.requestCode(phone, { now: t, send }), { code: 'OTP_LIMIT' });
  }));
  test('a failed SMS send leaves no usable code behind', () => run(async (store) => {
    await assert.rejects(otp.requestCode(phone, { now: t0, send: async () => { throw new Error('provider down'); } }), { code: 'SMS_FAILED' });
    assert.equal(store.rows.size, 0);
  }));
  test('is refused when no SMS provider is configured', async () => {
    const was = env.phoneLoginEnabled; env.phoneLoginEnabled = false;
    try { await assert.rejects(otp.requestCode(phone), { code: 'PHONE_DISABLED' }); } finally { env.phoneLoginEnabled = was; }
  });
});

test.describe('phone endpoints', () => {
  test('bad numbers are rejected before anything is sent', async () => {
    const res = await request(app).post('/api/auth/phone/send').set('X-FV-Client', 'web').send({ phone: '123' });
    assert.equal(res.status, 422);
  });
  test('answer 503 when phone sign-in is switched off', async () => {
    const res = await request(app).post('/api/auth/phone/send').set('X-FV-Client', 'web').send({ phone: '9876543210' });
    assert.equal(res.status, 503); assert.equal(res.body.error.code, 'PHONE_DISABLED');
  });
  test('verify needs a 6-digit code', async () => {
    const res = await request(app).post('/api/auth/phone/verify').set('X-FV-Client', 'web').send({ phone: '9876543210', code: 'abc' });
    assert.equal(res.status, 422);
  });
});

test.describe('gender sub-groups in rankings', () => {
  const mk = (name, gender, extra = {}) => ({ _id: oid(), name, code: `C-${name}`, slug: slugify(name), image: { url: null }, gender, ...extra });
  const celebs = [mk('A Man', 'male'), mk('B Man', 'male'), mk('C Woman', 'female'), mk('D Woman', 'female'), mk('E Other', 'other'), mk('F Old', undefined)];
  const votesFor = (c, n, state) => Array.from({ length: n }, () => ({ c, state }));
  async function withStubs(votes, fn) {
    const origAgg = Vote.aggregate; const origFind = Celebrity.find;
    Vote.aggregate = async (pipe) => {
      const group = pipe[1].$group; const tally = new Map();
      for (const v of votes) { const k = group._id === '$celebrityId' ? String(v.c._id) : `${v.state}|${v.c._id}`; tally.set(k, (tally.get(k) || 0) + 1); }
      return [...tally].map(([k, n]) => (group._id === '$celebrityId' ? { _id: celebs.find((c) => String(c._id) === k)._id, votes: n } : { _id: { state: k.split('|')[0], celebrityId: celebs.find((c) => String(c._id) === k.split('|')[1])._id }, votes: n }));
    };
    Celebrity.find = () => ({ select: async () => celebs });
    try { return await fn(); } finally { Vote.aggregate = origAgg; Celebrity.find = origFind; }
  }
  const votes = [...votesFor(celebs[0], 5, 'TN'), ...votesFor(celebs[1], 9, 'KA'), ...votesFor(celebs[2], 7, 'TN'), ...votesFor(celebs[3], 7, 'TN'), ...votesFor(celebs[4], 2, 'KA')];

  test('every sub-group is ranked on its own and the overall board is unchanged', () => withStubs(votes, async () => {
    const r = await ranking.computeCategory(oid(), oid());
    assert.deepEqual(r.national.map((x) => x.name), ['B Man', 'C Woman', 'D Woman', 'A Man', 'E Other', 'F Old']);
    assert.deepEqual(r.byGender.male.national.map((x) => [x.name, x.rank, x.votes]), [['B Man', 1, 9], ['A Man', 2, 5]]);
    assert.deepEqual(r.byGender.female.national.map((x) => [x.name, x.rank]), [['C Woman', 1], ['D Woman', 1]]); // tie shares rank 1
    assert.deepEqual(r.byGender.other.national.map((x) => x.name), ['E Other', 'F Old']); // records with no gender read as Others
    assert.equal(r.totalValidVotes, 30);
  }));
  test('state gender boards only include people with votes from that state', () => withStubs(votes, async () => {
    const r = await ranking.computeCategory(oid(), oid());
    assert.deepEqual(r.byGender.female.states.TN.map((x) => x.name), ['C Woman', 'D Woman']);
    assert.equal(r.byGender.male.states.KA.length, 1);
    assert.equal(r.byGender.female.states.KA, undefined);
  }));
  test('every group is a partition of the overall board', () => withStubs(votes, async () => {
    const r = await ranking.computeCategory(oid(), oid());
    const all = GENDERS.flatMap((g) => r.byGender[g].national.map((x) => x.name)).sort();
    assert.deepEqual(all, r.national.map((x) => x.name).sort());
  }));
  test('rejects an unknown group', async () => {
    await assert.rejects(ranking.getRanking({ campaign: { _id: oid(), key: '2026-10', status: 'active', startsAt: new Date(), endsAt: new Date() }, categoryId: oid(), gender: 'robot' }), { code: 'BAD_GENDER' });
  });
});

test.describe('validation of the new fields', () => {
  const base = { name: 'Test Person', categoryId: '64b000000000000000000001' };
  test('public nomination needs a gender; reason and links are optional', () => {
    assert.throws(() => pubV.nomination.parse(base));
    const n = pubV.nomination.parse({ ...base, gender: 'female' });
    assert.equal(n.reason, ''); assert.deepEqual(n.links, []);
    assert.throws(() => pubV.nomination.parse({ ...base, gender: 'x' }));
  });
  test('the public nomination form cannot set a social URL', () => {
    assert.equal('socialUrl' in pubV.nomination.parse({ ...base, gender: 'male', socialUrl: 'https://x.com/a' }), false);
  });
  test('admin celebrity: gender defaults, socialUrl must be http(s)', () => {
    assert.equal(adminV.celebrity.parse(base).gender, 'other');
    assert.equal(adminV.celebrity.parse({ ...base, socialUrl: '' }).socialUrl, undefined);
    assert.equal(adminV.celebrity.parse({ ...base, socialUrl: 'https://instagram.com/x' }).socialUrl, 'https://instagram.com/x');
    for (const bad of ['javascript:alert(1)', 'ftp://x.com/a', 'not a url']) assert.throws(() => adminV.celebrity.parse({ ...base, socialUrl: bad }), bad);
    assert.equal(adminV.celebrityUpdate.parse({ socialUrl: '' }).socialUrl, null); // clearing it
  });
  test('admin nomination requires a gender', () => {
    assert.throws(() => adminV.nominationCreate.parse(base));
    assert.equal(adminV.nominationCreate.parse({ ...base, gender: 'other' }).gender, 'other');
  });
  test('list and ranking queries accept only the three groups', () => {
    for (const g of GENDERS) assert.equal(pubV.rankings.parse({ category: 'actors', gender: g }).gender, g);
    assert.throws(() => pubV.rankings.parse({ category: 'actors', gender: 'all' }));
    assert.throws(() => pubV.celebrityList.parse({ gender: 'x' }));
  });
});

test.describe('the social URL never reaches the public', () => {
  test('public celebrity serializer omits it', () => {
    const doc = { _id: oid(), code: 'C1', name: 'X', slug: 'x', bio: '', image: { url: 'u' }, gender: 'female', socialUrl: 'https://instagram.com/secret', socialLinks: { a: 'b' }, categoryId: oid() };
    const out = publicCelebrity(doc);
    assert.equal(out.gender, 'female');
    assert.ok(!JSON.stringify(out).includes('secret') && !('socialUrl' in out));
  });
  test('user JSON hides the placeholder e-mail and masks the phone', () => {
    const u = new User({ name: 'Fan', email: placeholderEmail('+919876543210'), authProviders: ['phone'] }); u.phone = '+919876543210';
    const j = u.toSafeJSON();
    assert.equal(j.email, null); assert.equal(j.phone, '+91*******210'); assert.equal(j.hasPhone, true);
    assert.ok(!JSON.stringify(j).includes('9876543210'));
  });
  test('public endpoints reject a bad group with 422 before touching the database', async () => {
    assert.equal((await request(app).get('/api/celebrities?gender=bogus')).status, 422);
    assert.equal((await request(app).get('/api/rankings?category=actors&gender=bogus')).status, 422);
  });
  test('admin nomination routes are not open to guests', async () => {
    assert.equal((await request(app).post('/api/admin/nominations').set('X-FV-Client', 'web').send({})).status, 401);
  });
});

test.describe('seed data', () => {
  const all = Object.entries(CELEBS).flatMap(([cat, list]) => list.map((r) => ({ cat, name: r[0], wiki: r[1], state: r[2], bio: r[3], gender: r[4] })));
  test('every entry has a name, bio, valid state and an explicit gender', () => {
    for (const e of all) {
      assert.ok(e.name && e.wiki && e.bio.length > 20, e.name);
      assert.ok(e.state === null || STATE_CODES.includes(e.state), `${e.name}: state ${e.state}`);
      assert.ok(GENDERS.includes(e.gender), `${e.name}: gender ${e.gender}`);
    }
  });
  test('names and slugs are unique across all categories', () => {
    assert.equal(new Set(all.map((e) => slugify(e.name))).size, all.length);
  });
  test('every category lists at least two men and two women', () => {
    for (const cat of Object.keys(CELEBS)) for (const g of ['male', 'female']) assert.ok(all.filter((e) => e.cat === cat && e.gender === g).length >= 2, `${cat} ${g}`);
  });
  test('the manifest lists every seed celebrity with its gender', () => {
    const M = require('../services/imageManifest');
    const entries = M.listEntries();
    assert.equal(entries.length, all.length);
    const m = M.ensureEntries({ entries: {} });
    for (const e of entries) assert.equal(m.entries[e.slug].gender, e.gender);
  });
});
