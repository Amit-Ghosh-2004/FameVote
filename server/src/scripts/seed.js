/**
 * Seeds categories, settings, campaigns and (optionally) a super admin.
 * The unified npm run seed orchestrator handles portraits and clearly labeled demo results.
 *
 *   npm run seed:celebrities                 # adds celebrities and attempts missing portraits
 *   npm run seed:celebrities -- --no-images  # adds names/bios only
 *
 * Safe to rerun: existing profiles, admin edits, images, votes and payments are preserved.
 */
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { connectDB } = require('../config/db');
const { Category, Celebrity, User, Settings } = require('../models');
const { ensureCampaigns } = require('../services/campaignService');
const { slugify } = require('../validators/common');
const CELEBRITIES = require('../data/celebrities');
const { fetchAndStorePortrait } = require('../services/celebrityImageService');
const { isConfigured } = require('../services/cloudinaryService');
const { randomToken } = require('../utils/crypto');
const M = require('../services/imageManifest');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CATEGORIES = [
  ['Actors', 'actors', 'clapperboard', 'Film, TV and stage actors.'],
  ['Singers & Musicians', 'singers-musicians', 'mic', 'Playback singers, bands and instrumentalists.'],
  ['Influencers & Content Creators', 'influencers-content-creators', 'sparkles', 'Creators and digital personalities.'],
  ['Athletes & Sports Personalities', 'athletes-sports-personalities', 'trophy', 'Players and sports icons.'],
  ['TV Personalities', 'tv-personalities', 'tv', 'Anchors, hosts and television faces.'],
  ['Comedians', 'comedians', 'laugh', 'Stand-up and comedy performers.'],
  ['Models', 'models', 'camera', 'Fashion and commercial models.'],
  ['Other', 'other', 'star', 'Public figures who do not fit another category.'],
];

async function makeUniqueCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `CEL-${randomToken(6).toUpperCase()}`;
    if (!(await Celebrity.exists({ code }))) return code;
  }
  throw new Error('Could not generate a unique celebrity code after 10 attempts');
}

async function main() {
  await connectDB();
  for (const [i, [name, slug, icon, description]] of CATEGORIES.entries()) {
    await Category.updateOne({ slug }, { $setOnInsert: { name, slug, icon, description, displayOrder: i, status: 'active' } }, { upsert: true });
  }
  console.log(`Categories ready (${CATEGORIES.length})`);
  await Settings.get();
  await ensureCampaigns();
  console.log('Settings and campaigns ready');

  if (env.SUPERADMIN_EMAIL && env.SUPERADMIN_PASSWORD) {
    if (env.SUPERADMIN_PASSWORD.length < 10) throw new Error('SUPERADMIN_PASSWORD must be at least 10 characters');
    const email = env.SUPERADMIN_EMAIL.toLowerCase();
    const exists = await User.findOne({ email });
    if (!exists) {
      await User.create({ name: 'Super Admin', email, role: 'superadmin', emailVerified: true, passwordHash: await bcrypt.hash(env.SUPERADMIN_PASSWORD, 12) });
      console.log(`Super admin created: ${email}`);
    } else console.log('Super admin already exists');
  } else console.log('Skipping super admin (set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD)');

  if (!process.argv.includes('--celebrities')) {
    await require('mongoose').disconnect();
    return;
  }

  const withImages = !process.argv.includes('--no-images');
  const manifest = M.read();
  if (withImages && !isConfigured()) console.warn('Cloudinary is not configured (CLOUDINARY_*): portraits will be skipped.');
  let created = 0, uploadedThisRun = 0, withPhoto = 0, genderBackfilled = 0;
  const failed = [];
  const total = Object.values(CELEBRITIES).reduce((sum, list) => sum + list.length, 0);

  for (const [catSlug, list] of Object.entries(CELEBRITIES)) {
    const category = await Category.findOne({ slug: catSlug });
    if (!category) { console.warn(`Category ${catSlug} missing, skipped`); continue; }

    for (const [name, wikiTitle, state, bio, gender = 'other'] of list) {
      const slug = slugify(name);
      let doc = await Celebrity.findOne({ slug });
      if (!doc) {
        const payload = { code: await makeUniqueCode(), name, slug, categoryId: category._id, state, bio, gender, status: 'active', seeded: true };
        try {
          doc = await Celebrity.create(payload);
          created += 1;
        } catch (err) {
          if (err?.code === 11000 && err?.keyPattern?.slug) doc = await Celebrity.findOne({ slug });
          else if (err?.code === 11000 && err?.keyPattern?.code) {
            payload.code = await makeUniqueCode();
            doc = await Celebrity.create(payload);
            created += 1;
          } else throw err;
        }
      }
      if (!doc) doc = await Celebrity.findOne({ slug });
      if (!doc) throw new Error(`Could not load celebrity after insert: ${name}`);

      // Records seeded before gender subcategories existed get their gender filled in; an admin's later change is kept.
      // (raw update: mongoose would fill the schema default 'other' when reading an old record, hiding that it is unset)
      const bf = await Celebrity.collection.updateOne({ _id: doc._id, seeded: true, gender: { $exists: false } }, { $set: { gender } });
      if (bf.modifiedCount) { doc.gender = gender; genderBackfilled += 1; }

      // Repair legacy records without a code; keep the unique index intact.
      if (!doc.code) { doc.code = await makeUniqueCode(); await doc.save(); }

      // Never overwrite an existing photo, especially one manually uploaded by an admin.
      if (!doc.image?.url && !doc.image?.publicId) {
        const manifestImage = manifest.entries?.[slug]?.cloudinary;
        if (manifestImage?.url) {
          doc.image = { url: manifestImage.url, publicId: manifestImage.publicId, credit: manifest.entries[slug].sourceUrl, source: manifest.entries[slug].source || 'wikipedia', license: manifest.entries[slug].license, attribution: manifest.entries[slug].attribution };
          await doc.save();
        } else if (withImages && isConfigured()) {
          try {
            const image = await fetchAndStorePortrait(wikiTitle, slug);
            if (image) { doc.image = image; await doc.save(); uploadedThisRun += 1; }
            else failed.push(`${name}: no suitable Wikipedia lead image`);
          } catch (err) { failed.push(`${name}: ${err.message}`); }
          // Keep requests polite to Wikipedia and reduce rate limiting.
          await sleep(500);
        }
      }
      if (doc.image?.url || doc.image?.publicId) withPhoto += 1;
    }
  }

  console.log(`Celebrities: ${created} created, ${uploadedThisRun} photos uploaded to Cloudinary this run.`);
  if (genderBackfilled) console.log(`Gender subcategory set on ${genderBackfilled} existing celebrities.`);
  console.log(`Celebrities with an image saved: ${withPhoto}/${total}.`);
  if (failed.length) console.warn(`No photo for ${failed.length}: ${failed.join('; ')}\nYou can upload these from Admin > Celebrities and rerun the seed later.`);
  await require('mongoose').disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try { await require('mongoose').disconnect(); } catch {}
  process.exitCode = 1;
});
