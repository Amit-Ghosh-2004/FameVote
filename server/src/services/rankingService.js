const mongoose = require('mongoose');
const { Vote, Celebrity, Category, Campaign, RankingSnapshot, Payment } = require('../models');
const ApiError = require('../utils/ApiError');
const { GENDERS, isGender, genderOf } = require('../utils/gender');
const { effectiveStatus, syncStatuses } = require('./campaignService');
const { audit } = require('./auditService');

const NATIONAL_LIMIT = 15;
const STATE_LIMIT = 10;
const HEX24 = /^[0-9a-fA-F]{24}$/;
/**
 * Coerce an ObjectId, a hex string, or a POPULATED document (which has _id) into an ObjectId.
 * Anything else (a slug, undefined, "[object Object]") is a client/programming error, not a server crash.
 */
const idOf = (v) => String(v && typeof v === 'object' && v._id ? v._id : v);
const oid = (v) => {
  const s = idOf(v);
  if (!HEX24.test(s)) throw ApiError.badRequest('Invalid identifier', 'BAD_ID');
  return new mongoose.Types.ObjectId(s);
};

/**
 * TIE-BREAKING POLICY (disclosed on the site):
 *  - Celebrities with equal valid votes SHARE a rank (competition ranking: 1, 2, 2, 4).
 *  - Within a tie, entries are listed alphabetically by name (then by id) so the order is deterministic.
 *  - "Top N" shows the first N entries in that order.
 */
function rankRows(rows) {
  const sorted = [...rows].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name) || String(a.celebrityId).localeCompare(String(b.celebrityId)));
  let lastVotes = null; let lastRank = 0;
  return sorted.map((r, i) => {
    const rank = r.votes === lastVotes ? lastRank : i + 1;
    lastVotes = r.votes; lastRank = rank;
    return { ...r, rank };
  });
}

const cache = new Map(); // key -> { val, exp } | { promise }
const TTL_MS = 10_000;
/** 10 s memo with single-flight: concurrent misses for one key share one aggregation instead of stampeding MongoDB. */
async function cached(key, fn, bypass = false) {
  const hit = cache.get(key);
  if (!bypass && hit) {
    if (hit.promise) return hit.promise;
    if (hit.exp > Date.now()) return hit.val;
  }
  const promise = fn().then((val) => {
    if (cache.get(key)?.promise === promise) cache.set(key, { val, exp: Date.now() + TTL_MS });
    return val;
  }, (e) => { if (cache.get(key)?.promise === promise) cache.delete(key); throw e; });
  cache.set(key, { promise });
  if (cache.size > 500) cache.clear();
  return promise;
}

const toRow = (c, votes) => ({
  celebrityId: c._id, celebrityCode: c.code, name: c.name, slug: c.slug, image: c.image?.url || null, gender: genderOf(c), votes,
});

/** Official totals are ALWAYS derived from confirmed Vote documents in the database. */
async function computeCategory(campaignId, categoryId, { includeZeroNational = true } = {}) {
  const match = { campaignId: oid(campaignId), categoryId: oid(categoryId), status: 'confirmed' };
  const [byCeleb, byState] = await Promise.all([
    Vote.aggregate([{ $match: match }, { $group: { _id: '$celebrityId', votes: { $sum: 1 } } }]),
    Vote.aggregate([{ $match: match }, { $group: { _id: { state: '$state', celebrityId: '$celebrityId' }, votes: { $sum: 1 } } }]),
  ]);

  const ids = new Set([...byCeleb.map((r) => String(r._id)), ...byState.map((r) => String(r._id.celebrityId))]);
  const celebQuery = includeZeroNational
    ? { $or: [{ _id: { $in: [...ids].map(oid) } }, { categoryId: oid(categoryId), status: 'active' }] }
    : { _id: { $in: [...ids].map(oid) } };
  const celebs = await Celebrity.find(celebQuery).select('name code slug image gender');
  const byId = new Map(celebs.map((c) => [String(c._id), c]));

  const nationalVotes = new Map(byCeleb.map((r) => [String(r._id), r.votes]));
  const national = rankRows(celebs.map((c) => toRow(c, nationalVotes.get(String(c._id)) || 0)));

  const states = {};
  for (const r of byState) {
    const c = byId.get(String(r._id.celebrityId));
    if (!c) continue;
    (states[r._id.state] ||= []).push(toRow(c, r.votes)); // state lists only include celebrities with >=1 vote there
  }
  for (const st of Object.keys(states)) states[st] = rankRows(states[st]);

  // Gender boards: the same rows, re-ranked inside each sub-group (rank 1 = top of that group, ties share a rank).
  const byGender = {};
  for (const g of GENDERS) {
    const only = (rows) => rankRows(rows.filter((r) => r.gender === g));
    byGender[g] = { national: only(national), states: Object.fromEntries(Object.entries(states).map(([st, rows]) => [st, only(rows)]).filter(([, rows]) => rows.length)) };
  }
  const total = byCeleb.reduce((s, r) => s + r.votes, 0);
  return { national, states, byGender, totalValidVotes: total };
}

async function previousFinalizedRanks(campaign, categoryId, scope, state) {
  const prev = await Campaign.findOne({ status: 'finalized', startsAt: { $lt: campaign.startsAt } }).sort({ startsAt: -1 });
  if (!prev) return null;
  const snap = await RankingSnapshot.findOne({ campaignId: prev._id, categoryId, scope, state: state || '' }).sort({ revision: -1 });
  if (!snap) return null;
  return new Map(snap.entries.map((e) => [String(e.celebrityId), e.rank]));
}

const withMovement = (entries, prevRanks) =>
  entries.map((e) => ({ ...e, movement: prevRanks && prevRanks.has(String(e.celebrityId)) ? prevRanks.get(String(e.celebrityId)) - e.rank : null }));

/**
 * Public ranking lookup. Finalized campaigns read the immutable snapshot (latest revision);
 * everything else is computed live and labelled provisional.
 */
const genderKey = (state, gender) => (gender ? `${state || ''}~${gender}` : state || '');

async function getRanking({ campaign, categoryId, scope = 'national', state = '', gender = '' }, { fresh = false } = {}) {
  if (gender && !isGender(gender)) throw ApiError.badRequest('Unknown gender group', 'BAD_GENDER');
  if (scope === 'state' && !state) throw ApiError.badRequest('state is required for state rankings', 'STATE_REQUIRED');
  const limit = scope === 'national' ? NATIONAL_LIMIT : STATE_LIMIT;
  const status = effectiveStatus(campaign);
  const base = { campaign: { key: campaign.key, title: campaign.title, status }, categoryId, scope, state: scope === 'state' ? state : null, gender: gender || 'all', limit };

  if (campaign.status === 'finalized') {
    const snapKey = genderKey(scope === 'state' ? state : '', gender);
    const snap = await RankingSnapshot.findOne({ campaignId: campaign._id, categoryId, scope, state: snapKey }).sort({ revision: -1 });
    if (!snap && gender) {
      // Campaigns finalized before gender boards existed have no gender snapshot. Votes are never deleted, so the same
      // official computation over the confirmed votes gives the same numbers the main snapshot was built from.
      const computed = await cached(`${campaign._id}:${categoryId}`, () => computeCategory(campaign._id, categoryId), fresh);
      const g = computed.byGender[gender];
      const rows = scope === 'national' ? g.national : g.states[state] || [];
      return { ...base, provisional: false, finalized: true, revision: 1, totalValidVotes: rows.reduce((s, r) => s + r.votes, 0), entries: rows.slice(0, limit) };
    }
    return { ...base, provisional: false, finalized: true, revision: snap?.revision ?? 1, totalValidVotes: snap?.totalValidVotes ?? 0, entries: (snap?.entries ?? []).map((e) => e.toObject()) };
  }

  const computed = await cached(`${campaign._id}:${categoryId}`, () => computeCategory(campaign._id, categoryId), fresh);
  const src = gender ? computed.byGender[gender] : computed;
  const rows = scope === 'national' ? src.national : src.states[state] || [];
  const prev = await previousFinalizedRanks(campaign, categoryId, scope, genderKey(state, gender));
  const total = gender ? computed.byGender[gender].national.reduce((s, r) => s + r.votes, 0) : computed.totalValidVotes;
  return { ...base, provisional: true, finalized: false, totalValidVotes: total, entries: withMovement(rows.slice(0, limit), prev) };
}

/** Where does one celebrity stand right now (or in the final snapshot)? */
async function celebrityStanding(campaign, celebrity) {
  // celebrity.categoryId is a populated Category document when called from the public profile route.
  const categoryId = oid(celebrity.categoryId);
  const nat = await getRanking({ campaign, categoryId, scope: 'national' }, {});
  let natEntry;
  if (campaign.status === 'finalized') natEntry = nat.entries.find((e) => String(e.celebrityId) === String(celebrity._id));
  else {
    const computed = await cached(`${campaign._id}:${categoryId}`, () => computeCategory(campaign._id, categoryId));
    natEntry = computed.national.find((e) => String(e.celebrityId) === String(celebrity._id));
  }
  const gnat = await getRanking({ campaign, categoryId, scope: 'national', gender: genderOf(celebrity) });
  const genderEntry = gnat.entries.find((e) => String(e.celebrityId) === String(celebrity._id)) || null;
  let stateEntry = null;
  if (celebrity.state) {
    const st = await getRanking({ campaign, categoryId, scope: 'state', state: celebrity.state });
    stateEntry = st.entries.find((e) => String(e.celebrityId) === String(celebrity._id)) || null;
  }
  return {
    votes: natEntry?.votes ?? 0, nationalRank: natEntry?.rank ?? null, gender: genderOf(celebrity), genderRank: genderEntry?.rank ?? null,
    stateRank: stateEntry?.rank ?? null, stateRankState: celebrity.state || null, provisional: campaign.status !== 'finalized',
  };
}

/** Winners of a finalized campaign: every entry holding rank 1 (ties share the title). */
async function winnersFor(campaign) {
  const [nat, st] = await Promise.all([
    RankingSnapshot.find({ campaignId: campaign._id, scope: 'national', state: '' }).sort({ revision: -1 }),
    RankingSnapshot.find({ campaignId: campaign._id, scope: 'state', state: { $not: /~/ } }).sort({ revision: -1 }),
  ]);
  const latest = (docs, keyFn) => { const m = new Map(); for (const d of docs) { const k = keyFn(d); if (!m.has(k)) m.set(k, d); } return [...m.values()]; };
  const gSnaps = await RankingSnapshot.find({ campaignId: campaign._id, scope: 'national', state: { $in: GENDERS.map((g) => `~${g}`) } }).sort({ revision: -1 });
  const gLatest = new Map();
  for (const d of gSnaps) { const k = `${d.categoryId}:${d.state}`; if (!gLatest.has(k)) gLatest.set(k, d); }
  const categories = await Category.find({ _id: { $in: nat.map((s) => s.categoryId) } }).select('name slug');
  const catMap = new Map(categories.map((c) => [String(c._id), c]));
  return {
    national: latest(nat, (d) => String(d.categoryId)).map((s) => ({
      category: catMap.get(String(s.categoryId)), totalValidVotes: s.totalValidVotes,
      winners: s.entries.filter((e) => e.rank === 1 && e.votes > 0), top: s.entries,
      // Winner of each sub-group (campaigns finalized before sub-groups existed simply have none here)
      byGender: Object.fromEntries(GENDERS.map((g) => [g, (gLatest.get(`${s.categoryId}:~${g}`)?.entries || []).filter((e) => e.rank === 1 && e.votes > 0)])),
    })),
    state: latest(st, (d) => `${d.categoryId}:${d.state}`).map((s) => ({
      category: catMap.get(String(s.categoryId)), state: s.state, winners: s.entries.filter((e) => e.rank === 1), top: s.entries,
    })),
  };
}

/* ------------------------------ Finalization ------------------------------ */

async function buildSnapshots(campaign) {
  const categories = await Category.find({ status: { $ne: 'archived' } });
  const votedCategoryIds = await Vote.distinct('categoryId', { campaignId: campaign._id, status: 'confirmed' });
  const archivedWithVotes = await Category.find({ _id: { $in: votedCategoryIds }, status: 'archived' });
  let created = 0;

  for (const category of [...categories, ...archivedWithVotes]) {
    const { national, states, byGender, totalValidVotes } = await computeCategory(campaign._id, category._id);
    const prevNat = await previousFinalizedRanks(campaign, category._id, 'national', '');
    const docs = [{ scope: 'national', state: '', limit: NATIONAL_LIMIT, entries: withMovement(national.slice(0, NATIONAL_LIMIT), prevNat) }];
    for (const [state, rows] of Object.entries(states)) {
      const prev = await previousFinalizedRanks(campaign, category._id, 'state', state);
      docs.push({ scope: 'state', state, limit: STATE_LIMIT, entries: withMovement(rows.slice(0, STATE_LIMIT), prev) });
    }
    for (const g of GENDERS) { // sub-group boards, stored under '~gender' / 'ST~gender' keys (see RankingSnapshot)
      docs.push({ scope: 'national', state: genderKey('', g), limit: NATIONAL_LIMIT, entries: byGender[g].national.slice(0, NATIONAL_LIMIT) });
      for (const [state, rows] of Object.entries(byGender[g].states)) docs.push({ scope: 'state', state: genderKey(state, g), limit: STATE_LIMIT, entries: rows.slice(0, STATE_LIMIT) });
    }
    for (const d of docs) {
      try {
        await RankingSnapshot.create({ campaignId: campaign._id, categoryId: category._id, totalValidVotes, revision: 1, ...d });
        created += 1;
      } catch (e) { if (e.code !== 11000) throw e; /* already written by an earlier (crashed) attempt */ }
    }
  }
  return created;
}

async function finalizeCampaign(campaignId, { req = null, actor = null, force = false, now = new Date(), graceMinutes = 30 } = {}) {
  await syncStatuses(now);
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw ApiError.notFound('Campaign not found');
  if (campaign.status === 'finalized') throw ApiError.conflict('This campaign is already finalized', 'ALREADY_FINALIZED');
  if (effectiveStatus(campaign, now) !== 'closed') throw ApiError.conflict('Only a closed campaign can be finalized', 'CAMPAIGN_NOT_CLOSED');
  if (now < new Date(campaign.endsAt.getTime() + graceMinutes * 60_000) && !force) {
    throw ApiError.conflict('Results can be finalized after the payment grace period ends', 'GRACE_PERIOD', { finalizableAt: new Date(campaign.endsAt.getTime() + graceMinutes * 60_000) });
  }
  const pendingPayments = await Payment.countDocuments({
    campaignId: campaign._id,
    $or: [{ status: 'created', expiresAt: { $gt: now } }, { status: 'paid', voteId: { $exists: false } }],
  });
  if (pendingPayments > 0) throw ApiError.conflict('There are payments still being processed for this campaign', 'PENDING_PAYMENTS', { pendingPayments });

  // Atomic claim: only one finalizer can win, across any number of server instances.
  const claimed = await Campaign.findOneAndUpdate(
    { _id: campaign._id, status: { $ne: 'finalized' }, finalizing: { $ne: true } },
    { $set: { finalizing: true, finalizingAt: now } },
    { new: true }
  );
  if (!claimed) throw ApiError.conflict('Finalization is already in progress', 'FINALIZING');

  try {
    const snapshots = await buildSnapshots(claimed);
    await Campaign.updateOne({ _id: claimed._id }, { $set: { status: 'finalized', finalizedAt: now, finalizedBy: actor?._id || req?.user?._id, finalizing: false } });
    await audit(req || { user: actor }, 'campaign.finalize', { entity: 'Campaign', entityId: claimed._id, meta: { snapshots, auto: !req && !actor } });
    cache.clear();
    return { campaignId: claimed._id, snapshots };
  } catch (e) {
    await Campaign.updateOne({ _id: claimed._id }, { $set: { finalizing: false } }); // allow a retry; snapshots are idempotent
    throw e;
  }
}

/** Audited correction: never edits a snapshot, appends revision+1 for the affected category. */
async function correctCategoryRanking(campaignId, categoryId, { reason, req }) {
  if (!reason || reason.trim().length < 10) throw ApiError.badRequest('A reason of at least 10 characters is required', 'REASON_REQUIRED');
  const campaign = await Campaign.findById(campaignId);
  if (!campaign || campaign.status !== 'finalized') throw ApiError.conflict('Only finalized campaigns can be corrected', 'NOT_FINALIZED');
  const { national, states, byGender, totalValidVotes } = await computeCategory(campaign._id, categoryId);
  const latest = await RankingSnapshot.findOne({ campaignId, categoryId, scope: 'national' }).sort({ revision: -1 });
  const revision = (latest?.revision || 1) + 1;
  const docs = [{ scope: 'national', state: '', limit: NATIONAL_LIMIT, entries: national.slice(0, NATIONAL_LIMIT) }];
  for (const [state, rows] of Object.entries(states)) docs.push({ scope: 'state', state, limit: STATE_LIMIT, entries: rows.slice(0, STATE_LIMIT) });
  for (const g of GENDERS) {
    docs.push({ scope: 'national', state: genderKey('', g), limit: NATIONAL_LIMIT, entries: byGender[g].national.slice(0, NATIONAL_LIMIT) });
    for (const [state, rows] of Object.entries(byGender[g].states)) docs.push({ scope: 'state', state: genderKey(state, g), limit: STATE_LIMIT, entries: rows.slice(0, STATE_LIMIT) });
  }
  for (const d of docs) await RankingSnapshot.create({ campaignId, categoryId, totalValidVotes, revision, correctionReason: reason, correctedBy: req.user._id, ...d });
  await audit(req, 'ranking.correct', { entity: 'Campaign', entityId: campaignId, reason, meta: { categoryId, revision } });
  cache.clear();
  return { revision };
}

/** Winners of one sub-group (male/female/other) for each category of a finalized campaign. Falls back to live votes for older campaigns. */
async function genderWinnersFor(campaign, categoryIds, gender) {
  const out = {};
  for (const id of categoryIds) {
    const r = await getRanking({ campaign, categoryId: id, scope: 'national', gender });
    out[String(id)] = r.entries.filter((e) => e.rank === 1 && e.votes > 0);
  }
  return out;
}

const clearRankingCache = () => cache.clear();

module.exports = {
  NATIONAL_LIMIT, STATE_LIMIT, rankRows, computeCategory, getRanking, celebrityStanding, winnersFor,
  finalizeCampaign, correctCategoryRanking, clearRankingCache, genderWinnersFor,
};
