console.log('[SEED] seed-all.js started');

/**
 * Unified, idempotent FameVote seed.
 * Runs core setup, attempts openly licensed portraits (Cloudinary required),
 * attaches available portraits/creates celebrity records, then adds clearly
 * labeled synthetic demo campaigns. Never changes a non-demo campaign.
 *
 * Run with: npm run seed
 */
require('dotenv').config({ quiet: true });
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const serverRoot = path.resolve(__dirname, '../..');
const hasCloudinary = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

function run(label, args) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, args, {
    cwd: serverRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function runBestEffort(label, args) {
  console.log(`\n=== ${label} (best effort) ===`);
  const result = spawnSync(process.execPath, args, {
    cwd: serverRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.warn(`[WARNING] ${label} could not start: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    console.warn(`[WARNING] ${label} exited with code ${result.status ?? 'unknown'}. Continuing with the remaining seed stages.`);
  }
}

async function main() {
  run('Core categories, settings, campaigns and admin setup', [
    path.join(__dirname, 'seed.js'),
  ]);

  if (hasCloudinary) {
    runBestEffort('Find Wikipedia portraits first, fall back to Wikimedia Commons, and upload to Cloudinary', [
      path.join(__dirname, 'images-fetch.js'),
    ]);
  } else {
    console.warn('Cloudinary credentials are missing; image import is skipped. Configure CLOUDINARY_* to seed images.');
  }

  run('Create/update celebrity records and attach available portraits', [
    path.join(__dirname, 'seed.js'), '--celebrities',
  ]);

  run('Create clearly labeled synthetic demo campaigns and rankings', [
    path.join(__dirname, 'seed-demo.js'),
  ]);

  console.log('\nUnified FameVote seed completed.');
}

main().catch((err) => {
  console.error(`Unified seed failed: ${err.message}`);
  process.exitCode = 1;
});
