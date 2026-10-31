const mongoose = require('mongoose');
const { Category, Celebrity, Campaign, RankingSnapshot, Settings, Favorite, User } = require('../models');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { escapeRegex } = require('../utils/crypto');
const { STATES } = require('../utils/states');
const { getCurrentCampaign, publicCampaign, ensureCampaigns } = require('../services/campaignService');
const ranking = require('../services/rankingService');
const { genderOf } = require('../utils/gender');
const { cache: memo, TAGS } = require('../services/publicCache');

const publicCategory = (c) => ({ id: c._id, name: c.name, slug: c.slug, description: c.description, icon: c.icon, image: c.image?.url || null, displayOrder: c.displayOrder });
const publicCelebrity = (c) => ({
  id: c._id, code: c.code, name: c.name, slug: c.slug, bio: c.bio, image: c.image?.url || null, imageCredit: c.image?.credit || null, gender: genderOf(c),
  state: c.state, region: c.region, categoryId: c.categoryId?._id || c.categoryId, category: c.categoryId?.name ? { id: c.categoryId._id, name: c.categoryId.name, slug: c.categoryId.slug } : undefined,
});

async function resolveCampaign(key) {
  if (!key || key === 'current') return getCurrentCampaign();
  const c = await Campaign.findOne({ key });
  if (!c) throw ApiError.notFound('Campaign not found');
  return c;
}
async function resolveCategory(idOrSlug, { activeOnly = false } = {}) {
  const q = mongoose.isValidObjectId(idOrSlug) ? { _id: idOrSlug } : { slug: idOrSlug };
  const c = await Category.findOne(q);
  if (!c || (activeOnly && c.status !== 'active')) throw ApiError.notFound('Category not found');
  return c;
}

// Sample accounts are rare to look up and never change within a minute: memoise so /meta stays a cheap read.
let sampleMemo = { at: 0, v: false };
async function hasSampleData() {
  if (Date.now() - sampleMemo.at > 60_000) sampleMemo = { at: Date.now(), v: Boolean(await User.exists({ authProviders: 'demo' })) };
  return sampleMemo.v;
}

exports.meta = asyncHandler(async (_req, res) => {
  // Settings + campaigns change rarely: memoised 15 s (admin writes invalidate it). serverTime is always fresh.
  const [parts, sample] = await Promise.all([memo.get('meta:parts', 15_000, async () => { const [settings, campaigns] = await Promise.all([Settings.get(), ensureCampaigns()]); return { settings, campaigns }; }, { tags: [TAGS.meta] }), hasSampleData()]);
  const { settings, campaigns } = parts;
  const now = new Date();
  res.json({
    success: true,
    data: {
      states: STATES, currency: 'INR', voteAmountInr: settings.voteAmountInr, allowCustomAmount: settings.allowCustomAmount !== false, amountRangeInr: [0, 7], serverTime: now,
      campaign: publicCampaign(campaigns.current, now), nextCampaign: publicCampaign(campaigns.upcoming, now),
      announcements: settings.announcements.filter((a) => a.active).map((a) => ({ id: a._id, message: a.message })),
      banners: settings.banners.filter((b) => b.active).map((b) => ({ id: b._id, title: b.title, subtitle: b.subtitle, image: b.image?.url, link: b.link })),
      sampleData: Boolean(sample), googleSignIn: Boolean(env.GOOGLE_CLIENT_ID), phoneSignIn: env.phoneLoginEnabled,
      tieBreakPolicy: 'Celebrities with equal valid votes share a rank (1, 2, 2, 4) and are listed alphabetically within the tie.',
    },
  });
});

exports.categories = asyncHandler(async (_req, res) => {
  const body = await memo.get('categories', 30_000, buildCategories, { tags: [TAGS.catalog] });
  res.json(body);
});

async function buildCategories() {
  const cats = await Category.find({ status: 'active' }).sort({ displayOrder: 1, name: 1 }).lean();
  const counts = await Celebrity.aggregate([{ $match: { status: 'active', categoryId: { $in: cats.map((c) => c._id) } } }, { $group: { _id: { c: '$categoryId', g: { $ifNull: ['$gender', 'other'] } }, n: { $sum: 1 } } }]);
  const byId = new Map(); const byGender = new Map();
  for (const r of counts) {
    const k = String(r._id.c);
    byId.set(k, (byId.get(k) || 0) + r.n);
    byGender.set(k, { ...(byGender.get(k) || { male: 0, female: 0, other: 0 }), [r._id.g]: r.n });
  }
  return { success: true, data: { categories: cats.map((c) => ({ ...publicCategory(c), celebrityCount: byId.get(String(c._id)) || 0, genderCounts: byGender.get(String(c._id)) || { male: 0, female: 0, other: 0 } })) } };
}

exports.celebrities = asyncHandler(async (req, res) => {
  const { page, limit, category, state, q, sort, gender } = req.query;
  const filter = { status: 'active' };
  if (category) {
    const cat = await resolveCategory(category, { activeOnly: true });
    filter.categoryId = cat._id;
  } else {
    filter.categoryId = { $in: (await Category.find({ status: 'active' }).select('_id')).map((c) => c._id) };
  }
  if (state) filter.state = state;
  if (gender) filter.gender = gender === 'other' ? { $in: ['other', null] } : gender; // records from before subcategories read as 'other'
  if (q) filter.name = new RegExp(escapeRegex(q), 'i');
  const [items, total] = await Promise.all([
    Celebrity.find(filter).select('code name slug bio image.url image.credit gender state region categoryId').sort(sort === 'newest' ? { createdAt: -1 } : { name: 1 }).skip((page - 1) * limit).limit(limit).populate({ path: 'categoryId', select: 'name slug' }).lean(),
    Celebrity.countDocuments(filter),
  ]);
  res.json({ success: true, data: { items: items.map(publicCelebrity), page, limit, total, pages: Math.ceil(total / limit) } });
});

exports.celebrity = asyncHandler(async (req, res) => {
  const { idOrSlug } = req.params;
  const q = mongoose.isValidObjectId(idOrSlug) ? { _id: idOrSlug } : { $or: [{ slug: idOrSlug }, { code: idOrSlug }] };
  const celeb = await Celebrity.findOne({ ...q, status: 'active' }).populate('categoryId', 'name slug status');
  if (!celeb || celeb.categoryId?.status === 'archived') throw ApiError.notFound('Celebrity not found');

  const campaign = await getCurrentCampaign();
  const [standing, history, fav] = await Promise.all([
    ranking.celebrityStanding(campaign, celeb),
    RankingSnapshot.aggregate([
      { $match: { scope: 'national', state: '', 'entries.celebrityId': celeb._id } },
      { $sort: { revision: -1 } },
      { $group: { _id: '$campaignId', entries: { $first: '$entries' }, finalizedAt: { $first: '$finalizedAt' } } },
      { $sort: { finalizedAt: -1 } }, { $limit: 12 },
    ]),
    req.user ? Favorite.exists({ userId: req.user._id, celebrityId: celeb._id }) : null,
  ]);
  const camps = await Campaign.find({ _id: { $in: history.map((h) => h._id) } }).select('key title');
  const campMap = new Map(camps.map((c) => [String(c._id), c]));
  res.json({
    success: true,
    data: {
      celebrity: publicCelebrity(celeb), campaign: publicCampaign(campaign), standing,
      history: history.map((h) => {
        const e = h.entries.find((x) => String(x.celebrityId) === String(celeb._id));
        return { campaign: campMap.get(String(h._id))?.key, title: campMap.get(String(h._id))?.title, rank: e?.rank, votes: e?.votes };
      }),
      isFavorite: Boolean(fav),
    },
  });
});

exports.currentCampaign = asyncHandler(async (_req, res) => {
  const c = await getCurrentCampaign();
  res.json({ success: true, data: { campaign: publicCampaign(c) } });
});

exports.campaigns = asyncHandler(async (_req, res) => {
  const list = await Campaign.find({}).sort({ startsAt: -1 }).limit(36);
  res.json({ success: true, data: { campaigns: list.map((c) => publicCampaign(c)) } });
});

exports.rankings = asyncHandler(async (req, res) => {
  const { campaign: key, category, scope, state, gender } = req.query;
  const [campaign, cat] = await Promise.all([resolveCampaign(key), resolveCategory(category)]);
  const data = await ranking.getRanking({ campaign, categoryId: cat._id, scope, state, gender });
  res.json({ success: true, data: { ...data, category: publicCategory(cat), label: data.provisional ? 'Provisional - updates live until voting closes' : 'Final results' } });
});

/** Home page: trending + per-category national previews, all derived live from valid votes. */
exports.homeRankings = asyncHandler(async (req, res) => {
  // Same 10 s freshness as the ranking boards it is built from; one build is shared by every visitor.
  const body = await memo.get('home', 10_000, async () => {
    const campaign = await getCurrentCampaign();
    const cats = await Category.find({ status: 'active', 'rules.showOnHome': { $ne: false } }).sort({ displayOrder: 1 }).lean();
    const previews = await Promise.all(cats.map(async (cat) => {
      const r = await ranking.getRanking({ campaign, categoryId: cat._id, scope: 'national' });
      return { category: publicCategory(cat), entries: r.entries.slice(0, 5), provisional: r.provisional, totalValidVotes: r.totalValidVotes || 0 };
    }));
    const trending = previews.flatMap((p) => p.entries.filter((e) => e.votes > 0).map((e) => ({ ...e, categoryName: p.category.name })))
      .sort((a, b) => b.votes - a.votes).slice(0, 8);
    return { success: true, data: { campaign: publicCampaign(campaign), trending, previews } };
  }, { tags: [TAGS.rankings, TAGS.catalog, TAGS.meta] });
  res.json(body);
});

exports.winners = asyncHandler(async (req, res) => {
  if (!req.query.campaign) {
    const list = await Campaign.find({ status: 'finalized', published: true }).sort({ startsAt: -1 }).limit(24);
    return res.json({ success: true, data: { campaigns: list.map((c) => publicCampaign(c)) } });
  }
  const campaign = await Campaign.findOne({ key: req.query.campaign, status: 'finalized', published: true });
  if (!campaign) throw ApiError.notFound('No published results for that campaign');
  const winners = await ranking.winnersFor(campaign);
  res.json({ success: true, data: { campaign: publicCampaign(campaign), ...winners } });
});

exports.publicCategory = publicCategory;
exports.publicCelebrity = publicCelebrity;
exports.resolveCampaign = resolveCampaign;
