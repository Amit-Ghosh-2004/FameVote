/**
 * Idempotent boot-time setup, so nobody has to run `npm run seed` by hand.
 * Runs in the background AFTER the HTTP server is listening and the database is connected.
 *
 *   1. categories, settings, current + next campaign         (always; a handful of cheap upserts)
 *   2. super admin from SUPERADMIN_EMAIL / _PASSWORD          (only if that user does not exist yet)
 *   3. the sample celebrity lineup (BOOTSTRAP_CELEBRITIES)    (only when the lineup/manifest changed since the last sync)
 *        - inserts celebrities that are missing                (never touches existing ones, so admin edits survive)
 *        - fills `gender` on seeded records that predate it    (admin changes are kept)
 *        - attaches manifest portraits to records that have none (never overwrites a photo)
 *
 * Every step is safe to run on several instances at once (upserts / unordered inserts that ignore duplicate-key errors),
 * never deletes anything, and never needs network access (portraits come from the committed image manifest).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { Category, Celebrity, User, Settings } = require('../models');
const { ensureCampaigns } = require('./campaignService');
const { invalidateAll } = require('./publicCache');
const { randomToken } = require('../utils/crypto');
const CATEGORIES = require('../data/categories');
const manifestStore = require('./imageManifest');
const { slugify } = require('../validators/common');
const CELEBRITIES = require('../data/celebrities');

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const hasPhoto = (img) => Boolean(img && (img.url || img.publicId));

/** Fingerprint of everything the celebrity sync depends on. Changes when the lineup, genders or manifest portraits change. */
function seedVersion(entries = manifestStore.listEntries(), manifest = manifestStore.read()) {
  const h = crypto.createHash('sha1');
  for (const e of entries) h.update(`${e.slug}|${e.category}|${e.gender}|${manifest.entries?.[e.slug]?.cloudinary?.url || ''};`);
  return h.digest('hex').slice(0, 16);
}

/**
 * Pure planner (unit-tested without a database).
 *  existing: Map(slug -> { _id, image, hasGender })     catIds: Map(categorySlug -> ObjectId)
 */
function planCelebritySync({ entries, manifest, existing, catIds, makeCode }) {
  const inserts = []; const genderFixes = []; const imageFixes = [];
  for (const e of entries) {
    const m = manifest.entries?.[e.slug];
    const photo = m?.cloudinary?.url
      ? { url: m.cloudinary.url, publicId: m.cloudinary.publicId, credit: m.sourceUrl, source: m.source || 'wikipedia', license: m.license, attribution: m.attribution }
      : null;
    const cur = existing.get(e.slug);
    if (!cur) {
      const categoryId = catIds.get(e.category);
      if (!categoryId) continue;
      inserts.push({ code: makeCode(), name: e.name, nameNormalized: normalize(e.name), slug: e.slug, categoryId, state: e.state, bio: e.bio, gender: e.gender || 'other', status: 'active', seeded: true, ...(photo ? { image: photo } : {}) });
      continue;
    }
    if (cur.seeded && !cur.hasGender) genderFixes.push({ slug: e.slug, gender: e.gender || 'other' });
    if (photo && !hasPhoto(cur.image)) imageFixes.push({ slug: e.slug, image: photo });
  }
  return { inserts, genderFixes, imageFixes };
}

async function syncCategories() {
  await Category.bulkWrite(CATEGORIES.map(([name, slug, icon, description], i) => ({
    updateOne: { filter: { slug }, update: { $setOnInsert: { name, slug, icon, description, displayOrder: i, status: 'active' } }, upsert: true },
  })), { ordered: false });
}

async function syncSuperAdmin(log) {
  if (!env.SUPERADMIN_EMAIL || !env.SUPERADMIN_PASSWORD) return;
  if (env.SUPERADMIN_PASSWORD.length < 10) { log.warn?.('[bootstrap] SUPERADMIN_PASSWORD is shorter than 10 characters; admin not created'); return; }
  const email = env.SUPERADMIN_EMAIL.toLowerCase();
  if (await User.exists({ email })) return;
  try { await User.create({ name: 'Super Admin', email, role: 'superadmin', emailVerified: true, passwordHash: await bcrypt.hash(env.SUPERADMIN_PASSWORD, 12) }); log.log?.(`[bootstrap] super admin created: ${email}`); } catch (e) { if (e.code !== 11000) throw e; }
}

async function syncCelebrities(log) {
  const entries = manifestStore.listEntries(); const manifest = manifestStore.read();
  const version = seedVersion(entries, manifest);
  const settings = await Settings.get();
  if (settings.bootstrap?.seedVersion === version) return { skipped: true, version };

  const cats = await Category.find({}, 'slug').lean();
  const catIds = new Map(cats.map((c) => [c.slug, c._id]));
  // Raw read: Mongoose would fill the schema default 'other' for an old record and hide that gender is unset.
  const raw = await Celebrity.collection.find({}, { projection: { slug: 1, image: 1, gender: 1, seeded: 1 } }).toArray();
  const existing = new Map(raw.map((c) => [c.slug, { _id: c._id, seeded: c.seeded === true, hasGender: c.gender != null, image: c.image }]));
  const { inserts, genderFixes, imageFixes } = planCelebritySync({ entries, manifest, existing, catIds, makeCode: () => `CEL-${randomToken(6).toUpperCase()}` });

  let inserted = 0;
  if (inserts.length) {
    try { const r = await Celebrity.insertMany(inserts, { ordered: false }); inserted = r.length; } catch (e) {
      if (e.code !== 11000 && !e.writeErrors) throw e; // duplicates from a concurrent instance are fine
      inserted = e.insertedDocs?.length ?? 0;
    }
  }
  const ops = [
    ...genderFixes.map((g) => ({ updateOne: { filter: { slug: g.slug, seeded: true, gender: { $exists: false } }, update: { $set: { gender: g.gender } } } })),
    ...imageFixes.map((i) => ({ updateOne: { filter: { slug: i.slug, 'image.url': { $exists: false }, 'image.publicId': { $exists: false } }, update: { $set: { image: i.image } } } })),
  ];
  if (ops.length) await Celebrity.collection.bulkWrite(ops, { ordered: false });
  await Settings.updateOne({ key: 'global' }, { $set: { bootstrap: { seedVersion: version, at: new Date() } } });
  log.log?.(`[bootstrap] celebrities: ${inserted} added, ${genderFixes.length} genders filled, ${imageFixes.length} portraits attached`);
  return { skipped: false, inserted, genders: genderFixes.length, images: imageFixes.length, version };
}

/** Runs all steps. Never throws; resolves to { ok, ...details } so the caller can record the outcome. */
async function bootstrap({ log = console } = {}) {
  if (!env.BOOTSTRAP_ENABLED) return { ok: true, skipped: true };
  const t0 = Date.now();
  try {
    await syncCategories();
    await Settings.get();
    await ensureCampaigns();
    await syncSuperAdmin(log);
    const celebs = env.BOOTSTRAP_CELEBRITIES ? await syncCelebrities(log) : { skipped: true };
    if (!celebs.skipped) invalidateAll();
    log.log?.(`[bootstrap] done in ${Date.now() - t0} ms`);
    return { ok: true, ms: Date.now() - t0, celebs };
  } catch (e) {
    log.error?.('[bootstrap] failed (the app keeps running; it will retry on the next boot):', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { bootstrap, planCelebritySync, seedVersion, syncCategories, syncCelebrities };
