/**
 * Test helpers. IMPORTANT: this file sets process.env BEFORE anything else loads the app config.
 *
 * Integration tests need a MongoDB that supports transactions (a replica set):
 *   - set MONGODB_URI_TEST to any replica-set URI (MongoDB Atlas works: use a throwaway database name), or
 *   - run `npm run test:mem`, which installs mongodb-memory-server on demand (it downloads a mongod
 *     binary once; it is deliberately NOT a regular dependency so `npm install` stays fast).
 * If neither is available, integration tests are SKIPPED (not passed) and the reason is printed.
 */
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://placeholder/test',
  JWT_SECRET: 'j'.repeat(48),
  ADMIN_JWT_SECRET: 'a'.repeat(48),
  RECEIPT_HMAC_SECRET: 'r'.repeat(48),
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'test_key_secret_value',
  RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_value',
  ENABLE_SCHEDULER: 'false',
  AUTO_REFUND: 'true',
  GEMINI_API_KEY: '',
  CLIENT_URL: 'http://localhost:5173',
});

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { hmacHex } = require('../../utils/crypto');

let mem = null;
async function startDb() {
  const uri = process.env.MONGODB_URI_TEST;
  try {
    let url = uri;
    if (!url) {
      const { MongoMemoryReplSet } = require('mongodb-memory-server');
      mem = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
      url = mem.getUri();
    }
    const { connectDB } = require('../../config/db');
    await connectDB(url);
    return { ok: true };
  } catch (e) {
    const hint = e.code === 'MODULE_NOT_FOUND' ? 'set MONGODB_URI_TEST or run `npm run test:mem`' : String(e.message).split('\n')[0];
    return { ok: false, reason: hint };
  }
}
async function stopDb() {
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
  if (mem) await mem.stop();
}
async function resetDb() {
  const { clearRankingCache } = require('../../services/rankingService');
  clearRankingCache();
  await Promise.all(Object.values(mongoose.models).map((m) => m.collection.deleteMany({})));
}

let hash;
async function createUser(overrides = {}) {
  const { User } = require('../../models');
  hash ||= await bcrypt.hash('Passw0rdTest', 4);
  const n = Math.random().toString(36).slice(2, 8);
  return User.create({ name: `User ${n}`, email: `u_${n}@test.example`, passwordHash: hash, emailVerified: true, state: 'PB', ...overrides });
}
async function login(user, { admin = false } = {}) {
  const { createApp } = require('../../app');
  const agent = request.agent(createApp());
  const res = await agent.post(admin ? '/api/admin/auth/login' : '/api/auth/login').send({ email: user.email, password: 'Passw0rdTest' });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

async function seedCatalog() {
  const { Category, Celebrity, Settings } = require('../../models');
  const [actors, singers] = await Category.create([
    { name: 'Actors', slug: 'actors', displayOrder: 0 },
    { name: 'Singers & Musicians', slug: 'singers-musicians', displayOrder: 1 },
  ]);
  const celebs = await Celebrity.create([
    { name: 'TEST Actor A', slug: 'test-actor-a', categoryId: actors._id, state: 'MH' },
    { name: 'TEST Actor B', slug: 'test-actor-b', categoryId: actors._id, state: 'DL' },
    { name: 'TEST Actor C', slug: 'test-actor-c', categoryId: actors._id },
    { name: 'TEST Singer A', slug: 'test-singer-a', categoryId: singers._id },
  ]);
  const s = await Settings.get(); s.voteAmountInr = 0; await s.save();
  return { actors, singers, celebs };
}
async function setAmount(inr) {
  const { Settings } = require('../../models');
  await Settings.updateOne({ key: 'global' }, { $set: { voteAmountInr: inr } }, { upsert: true });
}

/** Controllable Razorpay stand-in. Nothing here is a real payment. */
function makeGateway() {
  let seq = 0;
  const g = {
    calls: { orders: 0, capture: 0, refund: 0 }, payments: {}, orderPayments: {}, failRefund: false,
    orders: {
      create: async (o) => { g.calls.orders += 1; const id = `order_T${++seq}`; g.lastOrder = { id, ...o }; return { id, ...o }; },
      fetchPayments: async (id) => ({ items: g.orderPayments[id] || [] }),
    },
    payments: {},
  };
  g.payments = {
    fetch: async (id) => g.store[id],
    capture: async (id) => { g.calls.capture += 1; g.store[id].status = 'captured'; },
    refund: async (id) => { if (g.failRefund) throw new Error('gateway down'); g.calls.refund += 1; return { id: `rfnd_${id}`, status: 'processed' }; },
  };
  g.store = {};
  g.addPayment = (id, order, amount, status = 'captured', createdAtMs = Date.now()) => {
    g.store[id] = { id, order_id: order, amount, currency: 'INR', status, created_at: Math.floor(createdAtMs / 1000) };
    (g.orderPayments[order] ||= []).push(g.store[id]);
    return g.store[id];
  };
  return g;
}

const sign = (orderId, paymentId) => hmacHex(process.env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
const webhookBody = (event, payment, eventId) => {
  const raw = Buffer.from(JSON.stringify({ event, payload: { payment: { entity: payment } } }));
  return { raw, sig: hmacHex(process.env.RAZORPAY_WEBHOOK_SECRET, raw), eventId };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { startDb, stopDb, resetDb, createUser, login, seedCatalog, setAmount, makeGateway, sign, webhookBody, sleep };
