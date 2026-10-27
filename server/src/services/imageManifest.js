/** Manifest of celebrity portraits: one entry per celebrity slug. Contains NO secrets (Cloudinary URLs are public). */
const fs = require('fs');
const path = require('path');
const CELEBRITIES = require('../data/celebrities');
const { slugify } = require('../validators/common');

const ROOT = path.resolve(__dirname, '../../seed-assets');
const IMAGES_DIR = path.join(ROOT, 'images');
const MANIFEST = path.join(ROOT, 'image-manifest.json');

/** Every celebrity in the seed data, in order. */
function listEntries() {
  const out = [];
  for (const [category, list] of Object.entries(CELEBRITIES)) {
    for (const [name, wikiTitle, state, bio, gender = 'other'] of list) out.push({ slug: slugify(name), name, category, wikiTitle, state, bio, gender });
  }
  return out;
}

function read() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return { version: 1, generatedAt: null, entries: {} }; }
}

function write(m) {
  fs.mkdirSync(ROOT, { recursive: true });
  m.generatedAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
}

/** Adds a 'pending' entry for every seed celebrity that is not in the manifest yet (never overwrites existing entries). */
function ensureEntries(m) {
  for (const e of listEntries()) {
    m.entries[e.slug] ||= { name: e.name, category: e.category, gender: e.gender, wikiTitle: e.wikiTitle, status: 'pending' };
    m.entries[e.slug].gender ||= e.gender;
  }
  return m;
}

const summary = (m) => Object.values(m.entries).reduce((a, e) => { a[e.status] = (a[e.status] || 0) + 1; return a; }, {});
const localFile = (slug, ext) => path.join(IMAGES_DIR, `${slug}.${ext}`);

module.exports = { ROOT, IMAGES_DIR, MANIFEST, listEntries, read, write, ensureEntries, summary, localFile };
