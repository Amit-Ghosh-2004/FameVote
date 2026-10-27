/**
 * Pure, deterministic planning for the sample-data seed (no database, no clock unless passed in).
 * Keeping it pure is what makes it unit-testable: the rules below are checked in tests without MongoDB.
 *
 * Everything generated from this plan belongs to accounts whose authProviders is ['demo'] and whose e-mail ends in
 * @demo.famevote.test (a reserved, non-routable domain). That single marker is how the seed finds, reports and removes
 * its own records, and how the site can say honestly that sample data is present.
 */

const DEMO_DOMAIN = 'demo.famevote.test';
const DEMO_PROVIDER = 'demo';

const FIRST = ['Aarav', 'Aditya', 'Akash', 'Ananya', 'Anika', 'Anjali', 'Arjun', 'Aryan', 'Bhavya', 'Chetan', 'Deepak', 'Dev', 'Diya', 'Divya', 'Farhan', 'Gaurav', 'Harsh', 'Isha', 'Ishaan', 'Jaya', 'Kabir', 'Karan', 'Kavya', 'Kiran', 'Lakshmi', 'Madhav', 'Mahesh', 'Meera', 'Mohit', 'Naina', 'Neha', 'Nikhil', 'Nisha', 'Pooja', 'Pranav', 'Priya', 'Rahul', 'Rajesh', 'Rohan', 'Sakshi', 'Sana', 'Sanjay', 'Shreya', 'Siddharth', 'Simran', 'Sneha', 'Suresh', 'Tanvi', 'Uday', 'Varun', 'Vikram', 'Vivek', 'Yash', 'Zoya', 'Imran', 'Fatima', 'Gurpreet', 'Harpreet', 'Joseph', 'Mary', 'Ravi', 'Swati'];
const LAST = ['Sharma', 'Verma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Mehta', 'Joshi', 'Shah', 'Nair', 'Iyer', 'Reddy', 'Rao', 'Menon', 'Pillai', 'Das', 'Banerjee', 'Chatterjee', 'Mukherjee', 'Ghosh', 'Bose', 'Kapoor', 'Malhotra', 'Khanna', 'Chopra', 'Bhatia', 'Sethi', 'Arora', 'Yadav', 'Mishra', 'Pandey', 'Tiwari', 'Dubey', 'Jain', 'Agarwal', 'Bansal', 'Desai', 'Kulkarni', 'Patil', 'Deshmukh', 'Naidu', 'Gowda', 'Hegde', 'Shetty', 'Khan', 'Ansari', 'Sheikh', 'Gill', 'Sandhu', 'Thakur', 'Rawat', 'Bisht', 'Borah', 'Hazarika', 'Sahoo', 'Mohanty', 'Fernandes', 'D\'Souza', 'Lal', 'Saxena'];

/** Rough share of India's online population by state/UT; drives how many sample voters each state gets. */
const STATE_WEIGHT = { UP: 14, MH: 11, BR: 8, WB: 7, TN: 6.5, MP: 6, RJ: 6, KA: 5.5, GJ: 5.5, AP: 4, TS: 3.5, OD: 3.4, KL: 3, JH: 2.5, AS: 2.5, PB: 2.4, CG: 2, HR: 2.2, DL: 3, UK: 1, HP: 0.8, JK: 1, GA: 0.3, CH: 0.3, TR: 0.3, ML: 0.3, MN: 0.25, NL: 0.2, AR: 0.15, MZ: 0.15, SK: 0.1, PY: 0.15, AN: 0.08, LD: 0.03, DN: 0.1, DD: 0.05, LA: 0.05 };

/** mulberry32: small seeded PRNG so every run builds the same plan. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rand, items, weightOf) {
  const total = items.reduce((s, it) => s + weightOf(it), 0);
  let x = rand() * total;
  for (const it of items) { x -= weightOf(it); if (x <= 0) return it; }
  return items[items.length - 1];
}

/** `count` sample voters: unique names/e-mails, state by population weight, joined before `joinBefore`. */
function buildVoters({ count, stateCodes, firstJoin, lastJoin, seed = 7 }) {
  const rand = rng(seed);
  const out = []; const seen = new Set();
  for (let i = 0; out.length < count && i < count * 20; i += 1) {
    const first = FIRST[Math.floor(rand() * FIRST.length)];
    const last = LAST[Math.floor(rand() * LAST.length)];
    const base = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');
    const n = Math.floor(rand() * 90) + 10;
    const email = `${base}${n}@${DEMO_DOMAIN}`;
    if (seen.has(email)) continue;
    seen.add(email);
    // Every state/UT gets at least 4 voters (when the pool is large enough), so state rankings are never empty.
    const guaranteed = count >= stateCodes.length * 4 && out.length < stateCodes.length * 4;
    const state = guaranteed ? stateCodes[out.length % stateCodes.length] : pickWeighted(rand, stateCodes, (c) => STATE_WEIGHT[c] ?? 0.2);
    const joined = new Date(firstJoin.getTime() + rand() * (lastJoin.getTime() - firstJoin.getTime()));
    out.push({ name: `${first} ${last}`, email, state, joinedAt: joined, activity: 0.25 + rand() * 0.75 });
  }
  return out;
}

/** Hour-of-day weights in IST: quiet at night, busy in the evening. */
const HOUR_WEIGHT = [1, .6, .4, .3, .3, .5, 1, 2, 3, 3.5, 3.5, 3.5, 4, 3.5, 3.5, 3.5, 4, 4.5, 5.5, 7, 8, 8, 5, 2.5];
const IST = 330 * 60 * 1000;

/** A vote timestamp inside [from, to]: day weights favour launch week and the final days, hours favour evenings. */
function voteTime(rand, from, to) {
  const days = Math.max(1, Math.ceil((to - from) / 864e5));
  const dayW = (d) => (d < 4 ? 2.2 : d >= days - 3 ? 1.8 : 1) * (1 + 0.35 * Math.sin(d * 1.7));
  const dayIdx = pickWeighted(rand, Array.from({ length: days }, (_, i) => i), dayW);
  const hour = pickWeighted(rand, HOUR_WEIGHT.map((_, h) => h), (h) => HOUR_WEIGHT[h]);
  const base = from.getTime() + dayIdx * 864e5;
  const istDayStart = Math.floor((base + IST) / 864e5) * 864e5 - IST;
  const t = istDayStart + hour * 36e5 + Math.floor(rand() * 36e5);
  return new Date(Math.min(Math.max(t, from.getTime()), to.getTime()));
}

/**
 * Plans the sample votes for one campaign.
 *  - one vote per voter per category (the database rule), and only after the voter joined
 *  - voters vote in some categories, not all (activity level), more in the first ones
 *  - celebrities have a stable popularity (earlier in the lineup = more popular) and get a boost from voters in
 *    their home state, so national and state rankings genuinely differ
 *  - nothing is dated after `now` (live campaign) or after the campaign end
 */
function planVotes({ campaignKey, voters, categories, startsAt, endsAt, now, seed = 11 }) {
  const rand = rng(seed + [...campaignKey].reduce((s, c) => s + c.charCodeAt(0), 0));
  const to = new Date(Math.min(endsAt.getTime(), now.getTime()));
  const votes = [];
  voters.forEach((v, voterIdx) => {
    const from = new Date(Math.max(startsAt.getTime(), v.joinedAt.getTime()));
    if (from >= to) return;
    categories.forEach((cat, ci) => {
      if (!cat.celebs.length) return;
      const take = v.activity * (1 - ci * 0.06);
      if (rand() > take) return;
      const celeb = pickWeighted(rand, cat.celebs, (c) => (1 / Math.pow(c.order + 1, 0.8)) * (c.state && c.state === v.state ? 3 : 1));
      votes.push({ voterIdx, categorySlug: cat.slug, celebrityId: celeb.id, at: voteTime(rand, from, to) });
    });
  });
  // Every celebrity should appear on the board with at least one vote, so no category shows an empty or half-empty list.
  // A zero-vote celebrity takes over one vote from the current leader of its category (same voter slot, same time).
  for (const cat of categories) {
    const inCat = votes.filter((v) => v.categorySlug === cat.slug);
    if (inCat.length < cat.celebs.length) continue; // too few votes to cover everyone
    const tally = new Map(cat.celebs.map((c) => [c.id, 0])); inCat.forEach((v) => tally.set(v.celebrityId, tally.get(v.celebrityId) + 1));
    for (const [id, n] of tally) {
      if (n > 0) continue;
      const leader = [...tally.entries()].sort((x, y) => y[1] - x[1])[0];
      const move = inCat.find((v) => v.celebrityId === leader[0]);
      if (!move || leader[1] < 3) break;
      move.celebrityId = id; tally.set(id, 1); tally.set(leader[0], leader[1] - 1);
    }
  }
  return votes.sort((a, b) => a.at - b.at);
}

module.exports = { DEMO_DOMAIN, DEMO_PROVIDER, STATE_WEIGHT, rng, buildVoters, planVotes, voteTime };
