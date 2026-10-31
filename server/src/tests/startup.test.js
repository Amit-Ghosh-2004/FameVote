// Start-up behaviour: readiness gate, bootstrap planner, reconnect back-off. No database required.
require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { decide } = require('../middleware/readiness');
const { planCelebritySync, seedVersion } = require('../services/bootstrapService');
const { backoffMs } = require('../config/db');
const { createApp } = require('../app');

test.describe('readiness gate', () => {
  test('reads pass once connected, even before indexes exist', () => {
    assert.equal(decide({ method: 'GET', path: '/rankings' }, { db: true, indexes: false }), null);
  });
  test('everything is refused with 503 while the DB is down', () => {
    const d = decide({ method: 'GET', path: '/categories' }, { db: false, indexes: false });
    assert.equal(d.status, 503); assert.equal(d.code, 'DB_NOT_READY'); assert.ok(d.retryAfter > 0);
  });
  test('votes and payments wait for the unique indexes; login does not', () => {
    assert.equal(decide({ method: 'POST', path: '/votes' }, { db: true, indexes: false }).code, 'DB_INITIALISING');
    assert.equal(decide({ method: 'POST', path: '/payments/verify' }, { db: true, indexes: false }).code, 'DB_INITIALISING');
    assert.equal(decide({ method: 'POST', path: '/auth/login' }, { db: true, indexes: false }), null);
  });
  test('the API answers 503 + Retry-After over HTTP and /health stays 200', async () => {
    const app = createApp({ getReadiness: () => ({ db: false, indexes: false }) });
    const r = await request(app).get('/api/categories').set('X-FV-Client', 'web');
    assert.equal(r.status, 503); assert.ok(r.headers['retry-after']);
    assert.equal((await request(app).get('/health')).status, 200);
    assert.equal((await request(app).get('/health/ready')).status, 503);
  });
});

test.describe('bootstrap planner', () => {
  const entries = [{ slug: 'a', name: 'A', category: 'cinema', gender: 'female', state: 'MH', bio: 'x' }, { slug: 'b', name: 'B', category: 'cinema', gender: 'male', state: 'MH', bio: 'y' }];
  const manifest = { entries: { a: { cloudinary: { url: 'https://img/a.jpg', publicId: 'a' } } } };
  const catIds = new Map([['cinema', 'cat1']]);
  test('inserts only missing celebrities and never touches admin-edited ones', () => {
    const existing = new Map([['b', { _id: 1, seeded: false, hasGender: true, image: { url: 'https://admin/b.jpg' } }]]);
    const p = planCelebritySync({ entries, manifest, existing, catIds, makeCode: () => 'C1' });
    assert.deepEqual(p.inserts.map((i) => i.slug), ['a']);
    assert.equal(p.inserts[0].image.url, 'https://img/a.jpg');
    assert.equal(p.genderFixes.length, 0); assert.equal(p.imageFixes.length, 0);
  });
  test('a second run with everything present plans nothing', () => {
    const existing = new Map([['a', { seeded: true, hasGender: true, image: { url: 'https://img/a.jpg' } }], ['b', { seeded: true, hasGender: true, image: { url: 'x' } }]]);
    const p = planCelebritySync({ entries, manifest, existing, catIds, makeCode: () => 'C' });
    assert.equal(p.inserts.length + p.genderFixes.length + p.imageFixes.length, 0);
  });
  test('the seed version changes when data changes and is stable otherwise', () => {
    assert.equal(seedVersion(entries, manifest), seedVersion(entries, manifest));
    assert.notEqual(seedVersion(entries, manifest), seedVersion(entries.slice(0, 1), manifest));
  });
});

test.describe('reconnect back-off', () => {
  test('grows, is capped and never reaches zero', () => {
    const v = [1, 2, 3, 6, 12].map((n) => backoffMs(n));
    assert.ok(v.every((x) => x > 0));
    assert.ok(Math.max(...v) <= 60_000);
    assert.ok(backoffMs(3) >= backoffMs(1));
  });
});
