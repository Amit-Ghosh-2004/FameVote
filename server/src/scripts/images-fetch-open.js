/**
 * npm run images:fetch-open [-- --force] [-- --only=slug,slug]
 *
 * Searches Wikimedia Commons for each celebrity, accepts only openly reusable
 * CC0, Public Domain, CC BY, or CC BY-SA files (not NC/ND), downloads to memory,
 * uploads to Cloudinary, and records source/license/creator attribution in the
 * existing manifest. Review the report and each file page before production.
 */
require('dotenv').config({ quiet: true });
const M = require('../services/imageManifest');
const { uploadPortrait, verifyUrl, cloudinaryReady, fetchWithRetry } = require('../services/celebrityImageService');

const UA = 'FameVoteOpenPortraitSeeder/1.0 (open-license Commons image importer)';
const force = process.argv.includes('--force');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stripHtml = (s = '') => String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const metaValue = (meta, key) => stripHtml(meta?.[key]?.value || '');

function normalized(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function allowedLicense(meta) {
  const name = metaValue(meta, 'LicenseShortName');
  const url = metaValue(meta, 'LicenseUrl');
  if (!name || metaValue(meta, 'NonFree').toLowerCase() === 'true') return false;
  if (/\b(NC|ND)\b|non.?commercial|no.?derivatives|fair use|all rights reserved/i.test(name)) return false;
  const ok = /\bcc0\b|public domain|public-domain|\bcc by(?:-sa)?(?:\s|$)|creative commons attribution(?:-sharealike)?/i.test(name);
  return Boolean(ok && url);
}
function candidateScore(entry, page, info, meta) {
  const name = normalized(entry.name);
  const tokens = name.split(' ').filter((t) => t.length > 1);
  const hay = normalized(`${page.title || ''} ${metaValue(meta, 'ImageDescription')} ${metaValue(meta, 'ObjectName')}`);
  const matched = tokens.filter((t) => hay.includes(t)).length;
  const last = tokens[tokens.length - 1];
  if (last && !hay.includes(last)) return -1;
  // Require at least two identifying tokens when the name has two or more.
  if (tokens.length >= 2 && matched < Math.min(2, tokens.length)) return -1;
  let score = matched * 10;
  if (/\b(portrait|headshot|press|event|festival|premiere|profile)\b/i.test(`${page.title} ${metaValue(meta, 'ImageDescription')}`)) score += 3;
  const w = Number(info.width || 0), h = Number(info.height || 0);
  if (w < 250 || h < 250) return -1;
  if (h >= w) score += 2;
  return score;
}
async function commonsSearch(entry) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  const params = {
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6',
    gsrsearch: `"${entry.name}"`, gsrlimit: '15', redirects: '1',
    prop: 'imageinfo', iiprop: 'url|size|extmetadata',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|Attribution|ImageDescription|ObjectName|NonFree',
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetchWithRetry(url.toString(), {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Commons search failed (${response.status})`);
  const data = await response.json();
  return Object.values(data.query?.pages || {}).map((page) => {
    const info = page.imageinfo?.[0];
    return info ? { page, info, meta: info.extmetadata || {} } : null;
  }).filter(Boolean);
}
async function downloadImage(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'upload.wikimedia.org') throw new Error('Rejected non-Commons image host');
  const response = await fetchWithRetry(url, {
    headers: { 'user-agent': UA, accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Image download failed (${response.status})`);
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error(`Unsupported image type: ${type || 'unknown'}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error('Image is empty or exceeds 10 MB');
  return buffer;
}

(async () => {
  if (!cloudinaryReady()) {
    console.error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in server/.env.');
    process.exitCode = 2;
    return;
  }
  const manifest = M.ensureEntries(M.read());
  const report = { uploaded: [], reused: [], skipped: [], failed: [] };
  for (const entry of M.listEntries()) {
    if (only.length && !only.includes(entry.slug)) continue;
    const current = manifest.entries[entry.slug];
    if (!force && current.cloudinary?.url && current.status === 'uploaded' && current.licenseVerified) {
      report.reused.push(entry.slug);
      continue;
    }
    try {
      const candidates = await commonsSearch(entry);
      const ranked = candidates
        .filter(({ info, meta }) => info.url && allowedLicense(meta))
        .map((c) => ({ ...c, score: candidateScore(entry, c.page, c.info, c.meta) }))
        .filter((c) => c.score >= 0)
        .sort((a, b) => b.score - a.score);
      if (!ranked.length) {
        manifest.entries[entry.slug] = { ...current, status: 'placeholder', licenseVerified: false, tried: ['Wikimedia Commons: no confidently matched image with an allowed open license'], checkedAt: new Date().toISOString() };
        report.skipped.push(entry.name);
      } else {
        const chosen = ranked[0];
        const buffer = await downloadImage(chosen.info.url);
        const uploaded = await uploadPortrait(buffer, entry.slug);
        if (!(await verifyUrl(uploaded.url))) throw new Error('Cloudinary URL did not return an image');
        const filePage = chosen.info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(chosen.page.title.replace(/ /g, '_'))}`;
        const license = metaValue(chosen.meta, 'LicenseShortName');
        const licenseUrl = metaValue(chosen.meta, 'LicenseUrl');
        const artist = metaValue(chosen.meta, 'Attribution') || metaValue(chosen.meta, 'Artist') || metaValue(chosen.meta, 'Credit') || 'Creator not listed';
        manifest.entries[entry.slug] = {
          ...current, status: 'uploaded', source: 'wikimedia-commons', sourceUrl: filePage,
          originalUrl: chosen.info.url, license, licenseUrl, attribution: artist,
          licenseVerified: true,
          cloudinary: { url: uploaded.url, publicId: uploaded.publicId, cloudName: process.env.CLOUDINARY_CLOUD_NAME },
          uploadedAt: new Date().toISOString(), checkedAt: new Date().toISOString(),
        };
        report.uploaded.push(`${entry.name} (${license})`);
      }
    } catch (err) {
      manifest.entries[entry.slug] = { ...current, status: 'failed', error: err.message, checkedAt: new Date().toISOString() };
      report.failed.push(`${entry.name}: ${err.message}`);
    }
    M.write(manifest);
    await sleep(700);
  }
  M.write(manifest);
  console.log(`Open-license Commons portraits: uploaded ${report.uploaded.length}, reused ${report.reused.length}, skipped ${report.skipped.length}, failed ${report.failed.length}.`);
  if (report.uploaded.length) console.log('\nUploaded:\n - ' + report.uploaded.join('\n - '));
  if (report.skipped.length) console.log('\nNo confidently matched open-license image (left unchanged):\n - ' + report.skipped.join('\n - '));
  if (report.failed.length) console.log('\nFailed (safe to retry):\n - ' + report.failed.join('\n - '));
  console.log(`Manifest: ${M.MANIFEST}\nNext: npm run seed:celebrities`);
})().catch((err) => { console.error(err); process.exitCode = 1; });
