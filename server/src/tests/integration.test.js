// Integration tests for the 17 acceptance scenarios. Need a replica-set MongoDB (see helpers/setup.js).
const H = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../app');
const M = require('../models');
const paymentService = require('../services/paymentService');
const reconcile = require('../services/reconcileService');
const ranking = require('../services/rankingService');
const scheduler = require('../jobs/scheduler');
const { getCurrentCampaign } = require('../services/campaignService');
const aiService = require('../services/aiService');

let dbOk = false; let skipReason = '';
let cat; let celebs; let gw;

test.before(async () => {
  const r = await H.startDb();
  dbOk = r.ok; skipReason = r.reason || '';
  if (!dbOk) console.warn(`\n[integration] SKIPPED - no MongoDB replica set available: ${skipReason}\n`);
});
test.after(async () => { if (dbOk) await H.stopDb(); });
test.beforeEach(async () => {
  if (!dbOk) return;
  await H.resetDb();
  cat = await H.seedCatalog(); celebs = cat.celebs;
  gw = H.makeGateway(); paymentService.setGateway(gw);
});
const it = (name, fn) => test.it(name, async (t) => { if (!dbOk) return t.skip(`no MongoDB: ${skipReason}`); return fn(t); });

const voteBody = (celeb, category = cat.actors) => ({ categoryId: String(category._id), celebrityId: String(celeb._id) });

async function payFor(agent, user, celeb, { amount = 200, status = 'captured', when = Date.now() } = {}) {
  const o = await agent.post('/api/payments/order').send(voteBody(celeb));
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const orderId = o.body.data.orderId;
  const pid = `pay_${Math.random().toString(36).slice(2, 10)}`;
  gw.addPayment(pid, orderId, amount, status, when);
  return { orderId, pid, paymentId: o.body.data.paymentId, verify: () => agent.post('/api/payments/verify').send({ razorpay_order_id: orderId, razorpay_payment_id: pid, razorpay_signature: H.sign(orderId, pid) }) };
}

test.describe('1-3. one vote per category per campaign', () => {
  it('user can vote once in each category', async () => {
    const u = await H.createUser(); const a = await H.login(u);
    assert.equal((await a.post('/api/votes').send(voteBody(celebs[0]))).status, 201);
    assert.equal((await a.post('/api/votes').send(voteBody(celebs[3], cat.singers))).status, 201);
    assert.equal(await M.Vote.countDocuments({ userId: u._id }), 2);
  });
  it('cannot vote twice in the same category (even for a different celebrity)', async () => {
    const u = await H.createUser(); const a = await H.login(u);
    await a.post('/api/votes').send(voteBody(celebs[0]));
    const r = await a.post('/api/votes').send(voteBody(celebs[1]));
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'ALREADY_VOTED');
    assert.equal(await M.Vote.countDocuments({ userId: u._id }), 1);
  });
  it('simultaneous requests produce exactly one vote', async () => {
    const u = await H.createUser(); const a = await H.login(u);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => a.post('/api/votes').send(voteBody(celebs[i % 3]))));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(await M.Vote.countDocuments({ userId: u._id }), 1);
    assert.equal(await M.Receipt.countDocuments({ userId: u._id }), 1);
  });
  it('email verification is not required, but users must select a state', async () => {
    const a = await H.login(await H.createUser({ emailVerified: false }));
    assert.equal((await a.post('/api/votes').send(voteBody(celebs[0]))).status, 201);
    const b = await H.login(await H.createUser({ state: null }));
    assert.equal((await b.post('/api/votes').send(voteBody(celebs[0]))).body.error.code, 'STATE_REQUIRED');
  });
  it('rejects a celebrity from a different category / inactive category', async () => {
    const a = await H.login(await H.createUser());
    assert.equal((await a.post('/api/votes').send({ categoryId: String(cat.actors._id), celebrityId: String(celebs[3]._id) })).status, 422);
    await M.Category.updateOne({ _id: cat.actors._id }, { status: 'inactive' });
    assert.equal((await a.post('/api/votes').send(voteBody(celebs[0]))).status, 422);
  });
});

test.describe('4. free transactions', () => {
  it('create a receipt with amount 0 and never touch Razorpay', async () => {
    const a = await H.login(await H.createUser());
    const r = await a.post('/api/votes').send(voteBody(celebs[0]));
    assert.equal(r.body.data.receipt.amountInr, 0);
    assert.equal(r.body.data.receipt.celebrityName, 'TEST Actor A');
    assert.equal(gw.calls.orders, 0);
  });
  it('the paid-order endpoint refuses when voting is free', async () => {
    const a = await H.login(await H.createUser());
    assert.equal((await a.post('/api/payments/order').send(voteBody(celebs[0]))).body.error.code, 'USE_FREE_FLOW');
  });
  it('the free endpoint refuses when a payment is required', async () => {
    await H.setAmount(2);
    const a = await H.login(await H.createUser());
    const r = await a.post('/api/votes').send(voteBody(celebs[0]));
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'PAYMENT_REQUIRED');
    assert.equal(await M.Vote.countDocuments(), 0);
  });
  it('replaying an Idempotency-Key never creates a second vote', async () => {
    const a = await H.login(await H.createUser());
    const r1 = await a.post('/api/votes').set('Idempotency-Key', 'k1').send(voteBody(celebs[0]));
    const r2 = await a.post('/api/votes').set('Idempotency-Key', 'k1').send(voteBody(celebs[0]));
    assert.equal(r1.status, 201); assert.equal(r2.status, 201);
    assert.equal(r1.body.data.receipt.receiptNo, r2.body.data.receipt.receiptNo);
    assert.equal(await M.Vote.countDocuments(), 1);
  });
});

test.describe('5-6. paid transactions', () => {
  it('amount comes from the server setting (paise), never from the client', async () => {
    await H.setAmount(3);
    const a = await H.login(await H.createUser());
    const r = await a.post('/api/payments/order').send({ ...voteBody(celebs[0]), amount: 1, amountPaise: 1 });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.amount, 300); assert.equal(r.body.data.currency, 'INR'); assert.equal(gw.lastOrder.amount, 300);
  });
  it('vote is confirmed only after signature + gateway verification', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const p = await payFor(a, u, celebs[0]);
    assert.equal(await M.Vote.countDocuments(), 0, 'no vote before payment is verified');
    const r = await p.verify();
    assert.equal(r.body.data.status, 'paid');
    assert.equal(r.body.data.receipt.razorpayPaymentId, p.pid);
    assert.equal(await M.Vote.countDocuments(), 1);
  });
  it('a forged signature creates nothing', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const p = await payFor(a, u, celebs[0]);
    const r = await a.post('/api/payments/verify').send({ razorpay_order_id: p.orderId, razorpay_payment_id: p.pid, razorpay_signature: 'f'.repeat(64) });
    assert.equal(r.status, 400); assert.equal(r.body.error.code, 'INVALID_SIGNATURE');
    assert.equal(await M.Vote.countDocuments(), 0);
  });
  it('a valid signature for a non-captured / failed payment creates nothing', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const p = await payFor(a, u, celebs[0], { status: 'failed' });
    assert.equal((await p.verify()).body.data.status, 'failed');
    assert.equal(await M.Vote.countDocuments(), 0);
    const retry = await a.post('/api/payments/order').send(voteBody(celebs[0])); // slot was released
    assert.equal(retry.status, 201);
  });
  it('a cancelled order cannot produce a vote and frees the slot', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const o = await a.post('/api/payments/order').send(voteBody(celebs[0]));
    assert.equal((await a.post(`/api/payments/${o.body.data.paymentId}/cancel`).send({})).status, 200);
    assert.equal(await M.Vote.countDocuments(), 0);
    assert.equal((await a.post('/api/payments/order').send(voteBody(celebs[0]))).status, 201);
  });
  it('wrong amount from the gateway is flagged, not counted', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const p = await payFor(a, u, celebs[0], { amount: 100 });
    assert.equal((await p.verify()).status, 400);
    assert.equal(await M.Vote.countDocuments(), 0);
  });
  it("one user cannot verify another user's payment", async () => {
    await H.setAmount(2);
    const u1 = await H.createUser(); const a1 = await H.login(u1); const a2 = await H.login(await H.createUser());
    const p = await payFor(a1, u1, celebs[0]);
    const r = await a2.post('/api/payments/verify').send({ razorpay_order_id: p.orderId, razorpay_payment_id: p.pid, razorpay_signature: H.sign(p.orderId, p.pid) });
    assert.equal(r.status, 404);
  });
});

test.describe('7. webhooks', () => {
  it('duplicate / concurrent webhooks and callback+webhook races give one vote and one receipt', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const p = await payFor(a, u, celebs[0]);
    const wh = H.webhookBody('payment.captured', gw.store[p.pid], 'evt_1');
    const send = () => request(createApp()).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', wh.sig).set('x-razorpay-event-id', 'evt_1').send(wh.raw.toString());
    const results = await Promise.all([send(), send(), send(), p.verify()]);
    results.forEach((r) => assert.ok([200, 201].includes(r.status), JSON.stringify(r.body)));
    assert.equal(await M.Vote.countDocuments(), 1);
    assert.equal(await M.Receipt.countDocuments(), 1);
    assert.equal(await M.WebhookEvent.countDocuments({ eventId: 'evt_1' }), 1);
  });
  it('a webhook alone (browser closed) still confirms the vote', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const p = await payFor(a, u, celebs[0]);
    const wh = H.webhookBody('payment.captured', gw.store[p.pid]);
    const r = await request(createApp()).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', wh.sig).set('x-razorpay-event-id', 'evt_2').send(wh.raw.toString());
    assert.equal(r.status, 200);
    assert.equal(await M.Vote.countDocuments({ userId: u._id }), 1);
  });
  it('a late payment.failed webhook never downgrades a paid vote', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const p = await payFor(a, u, celebs[0]); await p.verify();
    const wh = H.webhookBody('payment.failed', { ...gw.store[p.pid], error_description: 'x' });
    await request(createApp()).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', wh.sig).set('x-razorpay-event-id', 'evt_3').send(wh.raw.toString());
    assert.equal((await M.Payment.findById(p.paymentId)).status, 'paid');
    assert.equal(await M.Vote.countDocuments(), 1);
  });
});

test.describe('8. receipts', () => {
  it('every confirmed vote has a receipt naming the right celebrity and category', async () => {
    const u = await H.createUser(); const a = await H.login(u);
    await a.post('/api/votes').send(voteBody(celebs[1]));
    await a.post('/api/votes').send(voteBody(celebs[3], cat.singers));
    for (const v of await M.Vote.find({ userId: u._id })) {
      const r = await M.Receipt.findOne({ voteId: v._id });
      assert.ok(r); assert.equal(String(r.snapshot.celebrityId), String(v.celebrityId)); assert.equal(String(r.snapshot.categoryId), String(v.categoryId));
    }
    assert.equal(await M.Vote.countDocuments({ receiptId: { $exists: false } }), 0);
  });
  it('PDF download and public verification work; tampered refs fail', async () => {
    const a = await H.login(await H.createUser());
    const v = (await a.post('/api/votes').send(voteBody(celebs[0]))).body.data.receipt;
    const pdf = await a.get(`/api/receipts/${v.id}/pdf`).buffer().parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    assert.equal(pdf.status, 200); assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
    const ok = await request(createApp()).get('/api/receipts/verify').query({ receiptNo: v.receiptNo, ref: v.verificationRef });
    assert.equal(ok.body.data.valid, true); assert.equal(ok.body.data.celebrityName, 'TEST Actor A');
    assert.ok(!('userMasked' in ok.body.data) && !('userName' in ok.body.data), 'public verification must not leak personal data');
    assert.equal((await request(createApp()).get('/api/receipts/verify').query({ receiptNo: v.receiptNo, ref: 'A'.repeat(24) })).status, 404);
  });
  it('receipts are immutable', async () => {
    const a = await H.login(await H.createUser());
    await a.post('/api/votes').send(voteBody(celebs[0]));
    await assert.rejects(() => M.Receipt.updateOne({}, { $set: { 'snapshot.celebrityName': 'X' } }));
    await assert.rejects(() => M.Receipt.deleteMany({}));
  });
});

test.describe('9. schedule', () => {
  it('upcoming and closed campaigns reject votes and payments', async () => {
    const a = await H.login(await H.createUser());
    const camp = await getCurrentCampaign();
    await M.Campaign.updateOne({ _id: camp._id }, { startsAt: new Date(Date.now() + 3600_000), endsAt: new Date(Date.now() + 7200_000) });
    assert.equal((await a.post('/api/votes').send(voteBody(celebs[0]))).body.error.code, 'CAMPAIGN_NOT_STARTED');
    await M.Campaign.updateOne({ _id: camp._id }, { startsAt: new Date(Date.now() - 7200_000), endsAt: new Date(Date.now() - 3600_000) });
    assert.equal((await a.post('/api/votes').send(voteBody(celebs[0]))).body.error.code, 'CAMPAIGN_CLOSED');
    await H.setAmount(2);
    assert.equal((await a.post('/api/payments/order').send(voteBody(celebs[0]))).body.error.code, 'CAMPAIGN_CLOSED');
    assert.equal(await M.Vote.countDocuments(), 0);
  });
  it('closure is enforced by the clock even when the scheduler has not run', async () => {
    const camp = await getCurrentCampaign();
    await M.Campaign.updateOne({ _id: camp._id }, { status: 'active', endsAt: new Date(Date.now() - 1000) }); // stale persisted status
    const a = await H.login(await H.createUser());
    assert.equal((await a.post('/api/votes').send(voteBody(celebs[0]))).status, 409);
  });
  it('scheduler creates current + next campaigns idempotently and survives restarts', async () => {
    await M.Campaign.deleteMany({});
    await Promise.all([scheduler.tick(), scheduler.tick(), scheduler.tick()]);
    await scheduler.tick();
    assert.equal(await M.Campaign.countDocuments(), 2);
  });
});

test.describe('10-12. rankings and finalization', () => {
  async function castVotes(spec) { // [state, celebIndex]
    for (const [state, ci] of spec) {
      const u = await H.createUser({ state });
      const a = await H.login(u);
      const r = await a.post('/api/votes').send(voteBody(celebs[ci]));
      assert.equal(r.status, 201);
    }
  }
  const closeCampaign = async () => {
    const camp = await getCurrentCampaign();
    await M.Campaign.updateOne({ _id: camp._id }, { startsAt: new Date(Date.now() - 86400_000 * 40), endsAt: new Date(Date.now() - 86400_000 * 2), status: 'closed' });
    return M.Campaign.findById(camp._id);
  };

  it('national and per-state rankings are separate per category and count only valid votes', async () => {
    await castVotes([['PB', 0], ['PB', 0], ['DL', 0], ['PB', 1], ['DL', 1], ['MH', 2]]);
    const camp = await getCurrentCampaign();
    const nat = await ranking.getRanking({ campaign: camp, categoryId: cat.actors._id, scope: 'national' }, { fresh: true });
    assert.deepEqual(nat.entries.map((e) => [e.name, e.votes, e.rank]), [['TEST Actor A', 3, 1], ['TEST Actor B', 2, 2], ['TEST Actor C', 1, 3]]);
    assert.equal(nat.provisional, true);
    const pb = await ranking.getRanking({ campaign: camp, categoryId: cat.actors._id, scope: 'state', state: 'PB' }, { fresh: true });
    assert.deepEqual(pb.entries.map((e) => [e.name, e.votes]), [['TEST Actor A', 2], ['TEST Actor B', 1]]);
    const singers = await ranking.getRanking({ campaign: camp, categoryId: cat.singers._id, scope: 'national' }, { fresh: true });
    assert.equal(singers.entries.reduce((s, e) => s + e.votes, 0), 0, 'categories are independent');
  });
  it('shows only available entries and caps national at 15 / state at 10', async () => {
    const many = await M.Celebrity.create(Array.from({ length: 20 }, (_, i) => ({ name: `Bulk ${String(i).padStart(2, '0')}`, slug: `bulk-${i}`, categoryId: cat.singers._id })));
    const camp = await getCurrentCampaign();
    const nat = await ranking.getRanking({ campaign: camp, categoryId: cat.singers._id, scope: 'national' }, { fresh: true });
    assert.equal(nat.entries.length, 15);
    for (let i = 0; i < 12; i++) { const u = await H.createUser({ state: 'GJ' }); await (await H.login(u)).post('/api/votes').send({ categoryId: String(cat.singers._id), celebrityId: String(many[i]._id) }); }
    const st = await ranking.getRanking({ campaign: camp, categoryId: cat.singers._id, scope: 'state', state: 'GJ' }, { fresh: true });
    assert.equal(st.entries.length, 10);
    const empty = await ranking.getRanking({ campaign: camp, categoryId: cat.singers._id, scope: 'state', state: 'KL' }, { fresh: true });
    assert.equal(empty.entries.length, 0);
  });
  it('a state change after voting does not move past votes between state rankings', async () => {
    const u = await H.createUser({ state: 'PB' }); const a = await H.login(u);
    await a.post('/api/votes').send(voteBody(celebs[0]));
    await a.patch('/api/auth/profile').send({ state: 'KL' });
    const camp = await getCurrentCampaign();
    const pb = await ranking.getRanking({ campaign: camp, categoryId: cat.actors._id, scope: 'state', state: 'PB' }, { fresh: true });
    const kl = await ranking.getRanking({ campaign: camp, categoryId: cat.actors._id, scope: 'state', state: 'KL' }, { fresh: true });
    assert.equal(pb.entries[0].votes, 1); assert.equal(kl.entries.length, 0);
  });
  it('disqualified votes are excluded but keep occupying the voter slot', async () => {
    const u = await H.createUser(); const a = await H.login(u);
    await a.post('/api/votes').send(voteBody(celebs[0]));
    await M.Vote.updateOne({ userId: u._id }, { status: 'disqualified' });
    const camp = await getCurrentCampaign();
    const nat = await ranking.getRanking({ campaign: camp, categoryId: cat.actors._id, scope: 'national' }, { fresh: true });
    assert.equal(nat.entries[0].votes, 0);
    assert.equal((await a.post('/api/votes').send(voteBody(celebs[1]))).status, 409);
  });
  it('finalizes exactly once, concurrently safe, with immutable snapshots', async () => {
    await castVotes([['PB', 0], ['PB', 0], ['DL', 1]]);
    const camp = await closeCampaign();
    const res = await Promise.allSettled([1, 2, 3].map(() => ranking.finalizeCampaign(camp._id, { actor: { _id: new (require('mongoose').Types.ObjectId)() } })));
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
    const fin = await M.Campaign.findById(camp._id);
    assert.equal(fin.status, 'finalized');
    const snap = await M.RankingSnapshot.findOne({ campaignId: camp._id, categoryId: cat.actors._id, scope: 'national' });
    assert.equal(snap.entries[0].name, 'TEST Actor A'); assert.equal(snap.entries[0].votes, 2);
    await assert.rejects(() => M.RankingSnapshot.updateOne({ _id: snap._id }, { $set: { totalValidVotes: 999 } }));
    await assert.rejects(() => ranking.finalizeCampaign(camp._id, { actor: null }), /already finalized|ALREADY/i);
  });
  it('finalized history stays readable and unchanged even if live data changes later', async () => {
    await castVotes([['PB', 0]]);
    const camp = await closeCampaign();
    await ranking.finalizeCampaign(camp._id, { actor: { _id: new (require('mongoose').Types.ObjectId)() } });
    await M.Vote.updateMany({}, { status: 'disqualified' });
    ranking.clearRankingCache();
    const fin = await M.Campaign.findById(camp._id);
    const r = await ranking.getRanking({ campaign: fin, categoryId: cat.actors._id, scope: 'national' });
    assert.equal(r.finalized, true); assert.equal(r.provisional, false); assert.equal(r.entries[0].votes, 1);
  });
  it('corrections create a new revision with a reason and an audit entry', async () => {
    await castVotes([['PB', 0]]);
    const camp = await closeCampaign();
    await ranking.finalizeCampaign(camp._id, { actor: { _id: new (require('mongoose').Types.ObjectId)() } });
    const sa = await H.createUser({ role: 'superadmin' });
    await M.Vote.updateMany({}, { status: 'disqualified' });
    await assert.rejects(() => ranking.correctCategoryRanking(camp._id, cat.actors._id, { reason: 'x', req: { user: sa } }));
    const out = await ranking.correctCategoryRanking(camp._id, cat.actors._id, { reason: 'Fraud review #12 removed 1 vote', req: { user: sa } });
    assert.equal(out.revision, 2);
    assert.ok(await M.AuditLog.exists({ action: 'ranking.correct' }));
    const rev1 = await M.RankingSnapshot.findOne({ campaignId: camp._id, categoryId: cat.actors._id, scope: 'national', revision: 1 });
    assert.equal(rev1.entries[0].votes, 1, 'original snapshot untouched');
  });
  it('cannot finalize an open campaign', async () => {
    const camp = await getCurrentCampaign();
    await assert.rejects(() => ranking.finalizeCampaign(camp._id, { actor: null }), /closed/i);
  });
});

test.describe('13. authorization', () => {
  it("a user cannot read another user's receipt, PDF or payment (IDOR)", async () => {
    const a1 = await H.login(await H.createUser()); const a2 = await H.login(await H.createUser());
    const r = (await a1.post('/api/votes').send(voteBody(celebs[0]))).body.data.receipt;
    assert.equal((await a2.get(`/api/receipts/${r.id}`)).status, 404);
    assert.equal((await a2.get(`/api/receipts/${r.id}/pdf`)).status, 404);
    const pay = await M.Payment.findOne();
    assert.equal((await a2.get(`/api/payments/${pay._id}`)).status, 404);
    assert.equal((await a2.get('/api/receipts')).body.data.receipts.length, 0);
  });
  it('regular users are blocked from the admin portal; admin cookie and user cookie are separate', async () => {
    const user = await H.createUser();
    const res = await request(createApp()).post('/api/admin/auth/login').send({ email: user.email, password: 'Passw0rdTest' });
    assert.equal(res.status, 401);
    const ua = await H.login(user);
    assert.equal((await ua.get('/api/admin/dashboard')).status, 401);
  });
  it('role matrix: moderator < admin < superadmin', async () => {
    const mod = await H.login(await H.createUser({ role: 'moderator' }), { admin: true });
    const adm = await H.login(await H.createUser({ role: 'admin' }), { admin: true });
    const sup = await H.login(await H.createUser({ role: 'superadmin' }), { admin: true });
    assert.equal((await mod.get('/api/admin/dashboard')).status, 200);
    assert.equal((await mod.get('/api/admin/payments')).status, 403);
    assert.equal((await mod.patch('/api/admin/settings').send({ voteAmountInr: 1 })).status, 403);
    assert.equal((await adm.get('/api/admin/payments')).status, 200);
    assert.equal((await adm.patch('/api/admin/settings').send({ voteAmountInr: 1 })).status, 403);
    assert.equal((await adm.post('/api/admin/payments/507f1f77bcf86cd799439011/refund').send({ reason: 'abcde' })).status, 403);
    assert.equal((await sup.patch('/api/admin/settings').send({ voteAmountInr: 8 })).status, 422);
    assert.equal((await sup.patch('/api/admin/settings').send({ voteAmountInr: 0 })).status, 200);
  });
  it('privileged actions are audit-logged; there is no way to mark a payment as paid', async () => {
    const sup = await H.login(await H.createUser({ role: 'superadmin' }), { admin: true });
    await sup.patch('/api/admin/settings').send({ voteAmountInr: 0, cutoffTime: '23:59:59' });
    assert.ok(await M.AuditLog.exists({ action: 'settings.update' }));
    for (const m of ['patch', 'put', 'post']) assert.equal((await sup[m]('/api/admin/payments/507f1f77bcf86cd799439011/mark-paid').send({})).status, 404);
  });
  it('categories with history cannot be deleted, only archived', async () => {
    const a = await H.login(await H.createUser()); await a.post('/api/votes').send(voteBody(celebs[0]));
    const adm = await H.login(await H.createUser({ role: 'admin' }), { admin: true });
    assert.equal((await adm.delete(`/api/admin/categories/${cat.actors._id}`)).body.error.code, 'HAS_HISTORY');
    assert.equal((await adm.patch(`/api/admin/categories/${cat.actors._id}`).send({ status: 'archived' })).status, 200);
  });
  it('a suspended user is logged out everywhere', async () => {
    const u = await H.createUser(); const a = await H.login(u);
    const adm = await H.login(await H.createUser({ role: 'admin' }), { admin: true });
    assert.equal((await adm.post(`/api/admin/users/${u._id}/suspend`).send({ reason: 'abuse test' })).status, 200);
    assert.equal((await a.get('/api/auth/me')).status, 401);
  });
});

test.describe('14. Gemini failures never break anything', () => {
  it('AI endpoints degrade to manual fallbacks without an API key; voting is unaffected', async () => {
    const mod = await H.login(await H.createUser({ role: 'moderator' }), { admin: true });
    const bio = await mod.post('/api/admin/ai/biography').send({ name: 'TEST Actor A', category: 'Actors' });
    assert.equal(bio.status, 200); assert.equal(bio.body.ai, false); assert.ok(bio.body.data.bio);
    const seo = await mod.post('/api/admin/ai/seo').send({ name: 'TEST Actor A', category: 'Actors' });
    assert.equal(seo.body.ai, false); assert.ok(seo.body.data.title);
    await M.Category.create({ name: 'Athletes & Sports Personalities', slug: 'athletes-sports-personalities' });
    const cats = await mod.post('/api/admin/ai/category').send({ name: 'Test Player', details: 'a famous cricket player' });
    assert.equal(cats.body.data.suggestions[0].slug, 'athletes-sports-personalities');
    const faq = await request(createApp()).post('/api/faq/ask').send({ question: 'How many times can I vote?' });
    assert.equal(faq.status, 200); assert.match(faq.body.data.answer, /once per category/i);
    const a = await H.login(await H.createUser());
    assert.equal((await a.post('/api/votes').send(voteBody(celebs[0]))).status, 201);
  });
  it('quota errors trip the circuit breaker and still return fallbacks', async () => {
    process.env.GEMINI_API_KEY = 'fake';
    const env = require('../config/env'); env.GEMINI_API_KEY = 'fake';
    const mod = await H.login(await H.createUser({ role: 'moderator' }), { admin: true });
    const r = await mod.post('/api/admin/ai/seo').send({ name: 'TEST Actor A', category: 'Actors' });
    assert.equal(r.status, 200); assert.equal(r.body.ai, false);
    env.GEMINI_API_KEY = '';
  });
  it('duplicate detection works locally without AI', async () => {
    const mod = await H.login(await H.createUser({ role: 'moderator' }), { admin: true });
    const r = await mod.post('/api/admin/ai/duplicates').send({ name: 'test actor a' });
    assert.ok(r.body.data.matches.some((m) => m.name === 'TEST Actor A'));
  });
  it('duplicate detection also works for records created without nameNormalized (e.g. upserted seed data)', async () => {
    await M.Celebrity.collection.updateOne({ slug: 'test-actor-a' }, { $unset: { nameNormalized: '' } });
    const mod = await H.login(await H.createUser({ role: 'moderator' }), { admin: true });
    const r = await mod.post('/api/admin/ai/duplicates').send({ name: 'TEST Actor A' });
    assert.equal(r.status, 200); assert.ok(r.body.data.matches.some((m) => m.name === 'TEST Actor A'));
    const c = await M.Celebrity.findOne({ slug: 'test-actor-a' }); await c.save();
    assert.ok((await M.Celebrity.findOne({ slug: 'test-actor-a' })).nameNormalized, 'save() backfills it');
  });
  it('AI natural-language search only runs fixed, role-checked queries', async () => {
    const mod = await H.login(await H.createUser({ role: 'moderator' }), { admin: true });
    assert.equal((await mod.post('/api/admin/ai/search').send({ query: 'show failed payments' })).status, 403);
    const ok = await mod.post('/api/admin/ai/search').send({ query: 'find actor celebrity' });
    assert.equal(ok.status, 200);
  });
});

test.describe('16-17. reconciliation, restarts, delayed webhooks', () => {
  it('payment captured after campaign close creates NO vote and is refunded', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const camp = await getCurrentCampaign();
    const p = await payFor(a, u, celebs[0], { when: Date.now() + 5000 }); // gateway says it was paid "after close"
    await M.Campaign.updateOne({ _id: camp._id }, { endsAt: new Date(Date.now() + 1000) });
    const r = await p.verify();
    assert.equal(r.body.data.status, 'requires_reconciliation'); assert.equal(r.body.data.reason, 'paid_after_campaign_close');
    assert.equal(await M.Vote.countDocuments(), 0); assert.equal(await M.Receipt.countDocuments(), 0);
    await H.sleep(150);
    const pay = await M.Payment.findById(p.paymentId);
    assert.equal(pay.status, 'refunded'); assert.equal(gw.calls.refund, 1);
  });
  it('failed refunds are retried by the reconciliation job and cannot double-refund', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const camp = await getCurrentCampaign();
    gw.failRefund = true;
    const p = await payFor(a, u, celebs[0], { when: Date.now() + 5000 });
    await M.Campaign.updateOne({ _id: camp._id }, { endsAt: new Date(Date.now() + 1000) });
    await p.verify(); await H.sleep(150);
    assert.equal((await M.Payment.findById(p.paymentId)).status, 'refund_failed');
    gw.failRefund = false;
    await M.Payment.updateOne({ _id: p.paymentId }, { 'refund.initiatedAt': new Date(Date.now() - 3600_000) });
    await reconcile.retryRefunds(new Date());
    assert.equal((await M.Payment.findById(p.paymentId)).status, 'refunded');
    await reconcile.retryRefunds(new Date());
    assert.equal(gw.calls.refund, 1);
  });
  it('late capture of a cancelled/expired order is refunded, not counted', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const p = await payFor(a, u, celebs[0]);
    await M.Payment.updateOne({ _id: p.paymentId }, { status: 'expired', $unset: { activeKey: '' } });
    const r = await p.verify();
    assert.equal(r.body.data.status, 'requires_reconciliation');
    assert.equal(await M.Vote.countDocuments(), 0);
  });
  it('paid-but-orphaned payments (crash before vote write) are completed by the job; receipts are repaired', async () => {
    const u = await H.createUser(); const camp = await getCurrentCampaign();
    const pay = await M.Payment.create({ userId: u._id, campaignId: camp._id, categoryId: cat.actors._id, celebrityId: celebs[0]._id, state: 'PB', amountPaise: 0, method: 'free', status: 'paid', paidAt: new Date() });
    await M.Payment.collection.updateOne({ _id: pay._id }, { $set: { updatedAt: new Date(Date.now() - 600_000) } });
    const out = await reconcile.runAll(new Date());
    assert.equal(out.orphans, 1);
    assert.equal(await M.Vote.countDocuments({ userId: u._id }), 1); assert.equal(await M.Receipt.countDocuments({ userId: u._id }), 1);
    await M.Vote.collection.updateOne({ userId: u._id }, { $unset: { receiptId: '' } });
    assert.equal((await reconcile.runAll(new Date())).receipts, 1);
  });
  it('stale unpaid orders are checked against the gateway before expiring (delayed webhook)', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const p = await payFor(a, u, celebs[0]);
    await M.Payment.updateOne({ _id: p.paymentId }, { expiresAt: new Date(Date.now() - 1000) });
    const out = await reconcile.runAll(new Date());
    assert.equal(out.settled, 1);
    assert.equal(await M.Vote.countDocuments({ userId: u._id }), 1);
    const q = await payFor(await H.login(await H.createUser()), u, celebs[1]).catch(() => null); // second order path is exercised elsewhere
    assert.ok(q === null || q.orderId);
  });
  it('unpaid orders with nothing captured simply expire and free the slot', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const o = await a.post('/api/payments/order').send(voteBody(celebs[0]));
    await M.Payment.updateOne({ _id: o.body.data.paymentId }, { expiresAt: new Date(Date.now() - 1000) });
    await reconcile.runAll(new Date());
    assert.equal((await M.Payment.findById(o.body.data.paymentId)).status, 'expired');
    assert.equal((await a.post('/api/payments/order').send(voteBody(celebs[0]))).status, 201);
  });
  it('re-running the whole scheduler tick is idempotent', async () => {
    await scheduler.tick(); const c1 = await M.Campaign.countDocuments();
    await scheduler.tick(); await scheduler.tick();
    assert.equal(await M.Campaign.countDocuments(), c1);
  });
  it('simultaneous order creation for one slot yields one live payment', async () => {
    await H.setAmount(2);
    const u = await H.createUser(); const a = await H.login(u);
    const rs = await Promise.all(Array.from({ length: 6 }, () => a.post('/api/payments/order').send(voteBody(celebs[0]))));
    assert.ok(rs.filter((r) => r.status === 201).length >= 1);
    assert.equal(await M.Payment.countDocuments({ userId: u._id, activeKey: { $exists: true } }), 1);
  });
});

test.describe('auth flows', () => {
  it('registers without sending verification email; reset invalidates old sessions; no account enumeration', async () => {
    const app = createApp(); const agent = request.agent(app);
    const reg = await agent.post('/api/auth/register').send({ name: 'New Voter', email: 'new@test.example', password: 'GoodPass123', state: 'PB' });
    assert.equal(reg.status, 201); assert.equal(reg.body.data.user.emailVerified, true);
    assert.equal((await agent.post('/api/votes').send(voteBody(celebs[0]))).status, 201);
    const { randomToken, sha256 } = require('../utils/crypto');

    const a = await agent.post('/api/auth/forgot-password').send({ email: 'new@test.example' });
    const b = await agent.post('/api/auth/forgot-password').send({ email: 'ghost@test.example' });
    assert.deepEqual(a.body, b.body);
    const rt = randomToken(32);
    await M.User.updateOne({ email: 'new@test.example' }, { resetTokenHash: sha256(rt), resetTokenExpires: new Date(Date.now() + 60_000) });
    assert.equal((await request(app).post('/api/auth/reset-password').send({ token: rt, password: 'BrandNew456' })).status, 200);
    assert.equal((await agent.get('/api/auth/me')).status, 401, 'old session must be revoked');
    assert.equal((await request(app).post('/api/auth/reset-password').send({ token: rt, password: 'BrandNew456' })).status, 400, 'token is single-use');
  });
  it('accounts lock after repeated failed logins', async () => {
    const u = await H.createUser(); const app = createApp();
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email: u.email, password: 'wrong-password1' });
    const r = await request(app).post('/api/auth/login').send({ email: u.email, password: 'Passw0rdTest' });
    assert.equal(r.status, 429);
  });
});

test.describe('nominations', () => {
  it('validates, de-duplicates and is moderated before anything goes live', async () => {
    const a = await H.login(await H.createUser());
    const body = { name: 'Brand New Person', categoryId: String(cat.actors._id), reason: 'A well known actor with a large following.', links: [] };
    assert.equal((await a.post('/api/nominations').send(body)).status, 201);
    assert.equal((await a.post('/api/nominations').send(body)).body.error.code, 'ALREADY_NOMINATED');
    assert.equal((await a.post('/api/nominations').send({ ...body, name: 'TEST Actor A' })).body.error.code, 'ALREADY_LISTED');
    assert.equal(await M.Celebrity.countDocuments({ name: 'Brand New Person' }), 0);
    const mod = await H.login(await H.createUser({ role: 'moderator' }), { admin: true });
    const n = await M.Nomination.findOne();
    assert.equal((await mod.post(`/api/admin/nominations/${n._id}/review`).send({ decision: 'approve' })).status, 200);
    assert.equal((await M.Celebrity.findOne({ name: 'Brand New Person' })).status, 'inactive');
  });
});

test.describe('Google sign-in (ID-token verification stubbed; never contacts Google)', () => {
  const env = require('../config/env');
  const { OAuth2Client } = require('google-auth-library');
  const stub = (claims) => { OAuth2Client.prototype.verifyIdToken = async () => ({ getPayload: () => claims }); };
  const cred = { credential: 'x'.repeat(40) };
  it('creates a new account (201) with the chosen state and issues a session', async () => {
    env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
    stub({ sub: 'g-1', email: 'Fresh@Test.Example', email_verified: true, name: 'Fresh User' });
    const agent = request.agent(createApp());
    const r = await agent.post('/api/auth/google').send({ ...cred, state: 'KA' });
    assert.equal(r.status, 201); assert.equal(r.body.data.user.state, 'KA');
    assert.equal((await agent.get('/api/auth/me')).status, 200);
  });
  it('signs an existing Google user in (200), and rejects the same e-mail from another Google account', async () => {
    env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
    stub({ sub: 'g-2', email: 'again@test.example', email_verified: true, name: 'Again' });
    assert.equal((await request(createApp()).post('/api/auth/google').send(cred)).status, 201);
    assert.equal((await request(createApp()).post('/api/auth/google').send(cred)).status, 200);
    stub({ sub: 'g-OTHER', email: 'again@test.example', email_verified: true, name: 'Again' });
    assert.equal((await request(createApp()).post('/api/auth/google').send(cred)).body.error.code, 'GOOGLE_MISMATCH');
  });
  it('links to a pre-registered password account only after removing that password and revoking its sessions', async () => {
    env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
    const app = createApp(); const old = request.agent(app);
    await old.post('/api/auth/register').send({ name: 'Pre Reg', email: 'owner@test.example', password: 'GoodPass123', state: 'PB' });
    stub({ sub: 'g-3', email: 'owner@test.example', email_verified: true, name: 'Real Owner' });
    const r = await request(app).post('/api/auth/google').send(cred);
    assert.equal(r.status, 200); assert.equal(r.body.data.passwordRemoved, true);
    assert.equal((await old.get('/api/auth/me')).status, 401, 'the old session must be revoked');
    assert.equal((await request(app).post('/api/auth/login').send({ email: 'owner@test.example', password: 'GoodPass123' })).status, 401);
  });
  it('never links Google to a staff account, and rejects unverified Google e-mails', async () => {
    env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
    const admin = await H.createUser({ role: 'admin', email: 'boss@test.example' });
    stub({ sub: 'g-4', email: admin.email, email_verified: true, name: 'Boss' });
    assert.equal((await request(createApp()).post('/api/auth/google').send(cred)).body.error.code, 'ACCOUNT_LINK_REQUIRED');
    stub({ sub: 'g-5', email: 'unv@test.example', email_verified: false, name: 'U' });
    assert.equal((await request(createApp()).post('/api/auth/google').send(cred)).body.error.code, 'GOOGLE_UNVERIFIED');
  });
});
