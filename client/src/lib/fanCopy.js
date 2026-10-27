/** Playful fan-style lines per category (same table as server/src/data/fanCopy.js, used by the PDF). */
const LINES = {
  actors: ['Lights. Camera. Vote.', 'Gave a standing ovation to'],
  'singers-musicians': ['Turned the volume all the way up for', 'Sang along, then voted for'],
  'influencers-content-creators': ['Smashed the like button for', 'Hit follow, then hit vote for'],
  'athletes-sports-personalities': ['Cheered from the stands for', 'Roared for'],
  'tv-personalities': ['Prime-time pick:', 'Tuned in and voted for'],
  comedians: ['Laughed, then voted for', 'Still giggling, voted for'],
  models: ['Struck a pose for', 'Voted in style for'],
  other: ['Proud fan of', 'Backed'],
};
const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);
export const fanLine = (slug, seed = '') => { const l = LINES[slug] || LINES.other; return l[hash(seed) % l.length]; };
export const firstName = (name = '') => String(name).trim().split(/\s+/)[0] || 'them';
export const initialsOf = (name = '') => String(name).replace(/[^A-Za-z\s.]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'FV';
/** Receipt snapshots carry the category NAME, not its slug; map back for the tagline. */
export const slugFromName = (n = '') => String(n).toLowerCase().replace(/&/g, '').replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
