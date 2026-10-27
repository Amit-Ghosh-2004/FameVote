
require('dotenv').config({ quiet: true });

const M = require('../services/imageManifest');

const manifest = M.ensureEntries(M.read());
const entries = M.listEntries();

const counts = {
  uploaded: 0,
  pending: 0,
  placeholder: 0,
  failed: 0,
  other: 0,
};

console.log('\n==========================================');
console.log('       FAMEVOTE IMAGE STATUS CHECK');
console.log('==========================================');

for (const entry of entries) {
  const image = manifest.entries[entry.slug] || {};
  const status = image.status || 'pending';

  if (Object.prototype.hasOwnProperty.call(counts, status)) {
    counts[status] += 1;
  } else {
    counts.other += 1;
  }

  console.log(`\n${entry.name} (${entry.slug})`);
  console.log(`  Status: ${status}`);
  console.log(`  Source: ${image.source || 'Not available'}`);
  console.log(`  Image URL: ${image.cloudinary?.url || 'Not uploaded'}`);
  console.log(`  License: ${image.license || 'Not recorded'}`);

  if (image.licenseUrl) {
    console.log(`  License details: ${image.licenseUrl}`);
  }

  if (image.attribution) {
    console.log(`  Attribution: ${image.attribution}`);
  }

  if (image.error) {
    console.log(`  Error: ${image.error}`);
  }

  if (image.tried?.length) {
    console.log(`  Lookup results: ${image.tried.join(' | ')}`);
  }
}

console.log('\n==========================================');
console.log('               TOTALS');
console.log('==========================================');
console.log(`Total celebrities: ${entries.length}`);
console.log(`Uploaded: ${counts.uploaded}`);
console.log(`Pending: ${counts.pending}`);
console.log(`No suitable image: ${counts.placeholder}`);
console.log(`Failed: ${counts.failed}`);
console.log(`Other statuses: ${counts.other}`);
console.log(`Manifest: ${M.MANIFEST}`);
