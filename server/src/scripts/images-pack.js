/**
 * npm run images:pack
 * Bundles seed-assets/ (manifest + downloaded images) into famevote-seed-assets.tgz so it can be sent to someone or
 * moved to another machine. Refuses to pack anything that looks like a credential.
 * To use it elsewhere: extract it inside server/ (it recreates server/seed-assets/) then run images:upload.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const M = require('../services/imageManifest');

const SECRET = /(api[_-]?secret|CLOUDINARY_API|JWT_SECRET|BEGIN (RSA |EC )?PRIVATE KEY|mongodb(\+srv)?:\/\/[^\s"']*:[^\s"']*@)/i;
function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])); }

if (!fs.existsSync(M.MANIFEST)) { console.error('No manifest yet. Run: npm run images:manifest (and images:fetch).'); process.exit(1); }
const files = walk(M.ROOT);
const bad = files.filter((f) => /(^|[\\/])\.env/.test(f) || (/\.(json|txt|md)$/.test(f) && SECRET.test(fs.readFileSync(f, 'utf8'))));
if (bad.length) { console.error('Refusing to pack: possible secrets in\n - ' + bad.join('\n - ')); process.exit(1); }

const out = path.resolve(M.ROOT, '..', 'famevote-seed-assets.tgz');
const r = spawnSync('tar', ['-czf', out, '-C', path.resolve(M.ROOT, '..'), 'seed-assets'], { stdio: 'inherit' });
if (r.status !== 0) { console.error('tar failed (Windows 10+, macOS and Linux include it).'); process.exit(1); }
const imgs = files.filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).length;
console.log(`Packed ${imgs} images + manifest (${(fs.statSync(out).size / 1048576).toFixed(1)} MB):\n${out}\nNo secrets included. Extract inside server/ with: tar -xzf famevote-seed-assets.tgz`);
