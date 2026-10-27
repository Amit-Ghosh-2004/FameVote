/** npm run images:manifest : (re)creates seed-assets/image-manifest.json with a 'pending' entry per celebrity. Offline. */
const M = require('../services/imageManifest');
const m = M.ensureEntries(M.read());
M.write(m);
console.log(`Manifest ready: ${Object.keys(m.entries).length} celebrities`, M.summary(m), `\n${M.MANIFEST}`);
