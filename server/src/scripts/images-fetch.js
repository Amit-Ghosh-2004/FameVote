
/**
 * FameVote image prefetcher.
 *
 * Priority:
 *   1. Wikipedia article lead image
 *   2. Wikimedia Commons reusable image
 *   3. Record missing image for later retry
 *
 * Images are downloaded into memory and uploaded directly to Cloudinary.
 * No image files are saved to the local filesystem.
 *
 * Usage:
 *   npm run images:fetch
 *   npm run images:fetch -- --force
 *   npm run images:fetch -- --only=alia-bhatt
 *   npm run images:fetch -- --only=alia-bhatt,shah-rukh-khan
 */
require('dotenv').config({ quiet: true });

const M = require('../services/imageManifest');

const {
  findPortrait,
  download,
  uploadPortrait,
  verifyUrl,
  cloudinaryReady,
} = require('../services/celebrityImageService');

const force = process.argv.includes('--force');

const onlyArgument = process.argv.find((arg) =>
  arg.startsWith('--only=')
);

const only = onlyArgument
  ? onlyArgument
      .slice('--only='.length)
      .split(',')
      .map((slug) => slug.trim())
      .filter(Boolean)
  : [];

const startedAt = Date.now();

const report = {
  uploaded: [],
  reused: [],
  skipped: [],
  failed: [],
};

function elapsed() {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function printList(title, items, formatter = (item) => item) {
  if (!items.length) return;

  console.log(`\n${title}`);

  for (const item of items) {
    console.log(`  - ${formatter(item)}`);
  }
}

function persist(manifest) {
  M.write(manifest);
}

(async () => {
  console.log('\n==========================================');
  console.log('       FAMEVOTE IMAGE IMPORTER');
  console.log('==========================================');
  console.log('Image order: Wikipedia → Wikimedia Commons');
  console.log('Storage: Cloudinary (no local image files)');
  console.log(`Force refresh: ${force ? 'YES' : 'NO'}`);
  console.log(`Started: ${new Date().toLocaleString()}`);

  if (!cloudinaryReady()) {
    console.error('\n✗ Cloudinary is not configured.');
    console.error(
      'Check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in server/.env.'
    );

    process.exitCode = 2;
    return;
  }

  const manifest = M.ensureEntries(M.read());

  const entries = M.listEntries().filter(
    (entry) => !only.length || only.includes(entry.slug)
  );

  console.log(`Total celebrities selected: ${entries.length}`);
  console.log(`Manifest: ${M.MANIFEST}`);

  if (!entries.length) {
    console.log('\nNo matching celebrity slugs were found.');

    if (only.length) {
      console.log(`Requested slugs: ${only.join(', ')}`);
    }

    process.exitCode = 1;
    return;
  }

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const current = manifest.entries[entry.slug] || {};

    console.log('\n------------------------------------------');
    console.log(`[${index + 1}/${entries.length}] ${entry.name}`);
    console.log(`Slug: ${entry.slug}`);
    console.log(`Category: ${entry.category}`);
    console.log('------------------------------------------');

    if (
      !force &&
      current.status === 'uploaded' &&
      current.cloudinary?.url
    ) {
      console.log('↻ Existing Cloudinary image found.');
      console.log('↻ Reusing existing upload; no network lookup needed.');
      console.log(`Source: ${current.source || 'previously saved'}`);
      console.log(`Cloudinary URL: ${current.cloudinary.url}`);

      report.reused.push({
        name: entry.name,
        slug: entry.slug,
      });

      continue;
    }

    try {
      const found = await findPortrait({
        name: entry.name,
        wikiTitle: entry.wikiTitle,
      });

      if (found.status !== 'found') {
        const reason = (found.tried || ['No suitable image found']).join(
          ' | '
        );

        manifest.entries[entry.slug] = {
          ...current,
          name: entry.name,
          category: entry.category,
          wikiTitle: entry.wikiTitle,
          status: 'placeholder',
          tried: found.tried || [],
          error: undefined,
          checkedAt: new Date().toISOString(),
        };

        report.skipped.push({
          name: entry.name,
          slug: entry.slug,
          reason,
        });

        console.log('– No suitable image found.');
        console.log(`Details: ${reason}`);

        persist(manifest);
        console.log(
          `Progress: ${index + 1}/${entries.length} | Elapsed: ${elapsed()}`
        );

        continue;
      }

      console.log('\nImage candidate selected');
      console.log(`Source: ${found.source}`);
      console.log(`Source page: ${found.pageUrl}`);
      console.log(`Original image: ${found.imageUrl}`);
      console.log(`License: ${found.license || 'Needs manual verification'}`);
      console.log(`License URL: ${found.licenseUrl || 'Not provided'}`);
      console.log(`Attribution: ${found.attribution || 'Not provided'}`);

      console.log('\n→ Downloading image into memory...');

      const { buffer, ext } = await download(found.imageUrl);

      console.log(
        `✓ Downloaded ${(buffer.length / 1024).toFixed(1)} KB (${ext})`
      );

      console.log('→ Uploading image to Cloudinary...');

      const uploaded = await uploadPortrait(buffer, entry.slug);

      console.log('→ Verifying Cloudinary image URL...');

      const verified = await verifyUrl(uploaded.url);

      if (!verified) {
        throw new Error(
          'Cloudinary URL verification failed; the URL did not return an image'
        );
      }

      const timestamp = new Date().toISOString();

      manifest.entries[entry.slug] = {
        ...current,
        name: entry.name,
        category: entry.category,
        wikiTitle: entry.wikiTitle,
        status: 'uploaded',
        source: found.source,
        sourceUrl: found.pageUrl,
        originalUrl: found.imageUrl,
        license: found.license || '',
        licenseUrl: found.licenseUrl || '',
        attribution: found.attribution || '',
        licenseVerified: found.source === 'wikimedia-commons',
        tried: found.tried || [],
        cloudinary: {
          url: uploaded.url,
          publicId: uploaded.publicId,
          cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        },
        uploadedAt: timestamp,
        checkedAt: timestamp,
      };

      report.uploaded.push({
        name: entry.name,
        slug: entry.slug,
        source: found.source,
        url: uploaded.url,
        license: found.license || 'Not provided',
      });

      console.log('\n✓ SUCCESS');
      console.log(`Celebrity: ${entry.name}`);
      console.log(`Selected source: ${found.source}`);
      console.log(`Cloudinary URL: ${uploaded.url}`);
      console.log(`Public ID: ${uploaded.publicId}`);
      console.log(`License: ${found.license || 'Needs manual verification'}`);
      console.log(`Attribution: ${found.attribution || 'Not provided'}`);

    } catch (error) {
      manifest.entries[entry.slug] = {
        ...current,
        name: entry.name,
        category: entry.category,
        wikiTitle: entry.wikiTitle,
        status: 'failed',
        error: error.message,
        checkedAt: new Date().toISOString(),
      };

      report.failed.push({
        name: entry.name,
        slug: entry.slug,
        reason: error.message,
      });

      console.error('\n✗ FAILED');
      console.error(`Celebrity: ${entry.name}`);
      console.error(`Reason: ${error.message}`);
    }

    // Persist every result immediately to allow safe retries.
    persist(manifest);

    console.log(
      `Progress: ${index + 1}/${entries.length} | ` +
      `Uploaded: ${report.uploaded.length} | ` +
      `Reused: ${report.reused.length} | ` +
      `Skipped: ${report.skipped.length} | ` +
      `Failed: ${report.failed.length} | ` +
      `Elapsed: ${elapsed()}`
    );

    // Small delay to avoid making requests too aggressively.
    if (index < entries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  persist(manifest);

  console.log('\n==========================================');
  console.log('          FINAL IMAGE SUMMARY');
  console.log('==========================================');
  console.log(`Selected: ${entries.length}`);
  console.log(`Uploaded: ${report.uploaded.length}`);
  console.log(`Reused: ${report.reused.length}`);
  console.log(`Skipped / no suitable image: ${report.skipped.length}`);
  console.log(`Failed: ${report.failed.length}`);
  console.log(`Elapsed time: ${elapsed()}`);
  console.log(`Manifest file: ${M.MANIFEST}`);

  printList(
    'Uploaded images:',
    report.uploaded,
    (item) =>
      `${item.name} | ${item.source} | ${item.url} | License: ${item.license}`
  );

  printList(
    'Reused images:',
    report.reused,
    (item) => `${item.name} (${item.slug})`
  );

  printList(
    'Skipped images:',
    report.skipped,
    (item) => `${item.name}: ${item.reason}`
  );

  printList(
    'Failed images:',
    report.failed,
    (item) => `${item.name}: ${item.reason}`
  );

  console.log('\nFinished.');

  if (report.failed.length) {
    console.warn(`\n[WARNING] ${report.failed.length} portrait(s) failed. Their details are saved in the manifest; the importer will still finish successfully so seeding can continue.`);
  }
})().catch((error) => {
  console.error('\nFatal image-import error:', error);
  process.exitCode = 1;
});
