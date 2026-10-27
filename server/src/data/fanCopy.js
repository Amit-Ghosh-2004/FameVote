/** Playful, fan-style lines per category. Used by the receipt PDF; the client has the same table (client/src/lib/fanCopy.js). */
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
const fanLine = (slug, seed = 0) => { const l = LINES[slug] || LINES.other; return l[Math.abs(seed) % l.length]; };
const firstName = (name = '') => String(name).trim().split(/\s+/)[0] || 'them';
const initials = (name = '') => String(name).replace(/[^A-Za-z\s.]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'FV';
module.exports = { fanLine, firstName, initials };
