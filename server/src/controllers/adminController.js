const { contactOf } = require('../utils/phone');
const bcrypt = require('bcryptjs');
const { User, Category, Celebrity, Campaign, Vote, Payment, Receipt, Nomination, Notification, AuditLog, Settings, WebhookEvent, RankingSnapshot } = require('../models');
const { normalizeName } = require('../models/Celebrity');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { escapeRegex } = require('../utils/crypto');
const { slugify } = require('../validators/common');
const { audit } = require('../services/auditService');
const { getCurrentCampaign, publicCampaign, effectiveStatus, ensureCampaigns } = require('../services/campaignService');
const ranking = require('../services/rankingService');
const paymentService = require('../services/paymentService');
const reconcile = require('../services/reconcileService');
const scheduler = require('../jobs/scheduler');
const cloud = require('../services/cloudinaryService');
const env = require('../config/env');

const page = (q) => ({ skip: (q.page - 1) * q.limit, limit: q.limit });
const paged = (items, total, q) => ({ items, page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) });

async function uniqueSlug(Model, base, excludeId) {
  let slug = base || 'item'; let n = 1;
  while (await Model.exists({ slug, ...(excludeId && { _id: { $ne: excludeId } }) })) slug = `${base}-${++n}`;
  return slug;
}

/* ------------------------------ Dashboard ------------------------------ */

exports.dashboard = asyncHandler(async (_req, res) => {
  const now = new Date();
  const { current } = await ensureCampaigns(now);
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const [users, activeCategories, totalVotes, validVotes, byStatus, paidSum, pendingNoms, recent, failedBurst, reconc, refundFailed, failedHooks, activeCampaigns] = await Promise.all([
    User.countDocuments(), Category.countDocuments({ status: 'active' }),
    Vote.countDocuments(), Vote.countDocuments({ status: 'confirmed' }),
    Payment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, paise: { $sum: '$amountPaise' } } }]),
    Payment.aggregate([{ $match: { status: 'paid', method: 'razorpay' } }, { $group: { _id: null, paise: { $sum: '$amountPaise' } } }]),
    Nomination.countDocuments({ status: 'pending' }),
    AuditLog.find().sort({ createdAt: -1 }).limit(10).populate('actorId', 'name role'),
    Payment.aggregate([{ $match: { status: { $in: ['failed', 'cancelled'] }, createdAt: { $gte: dayAgo } } }, { $group: { _id: '$userId', n: { $sum: 1 } } }, { $match: { n: { $gte: 5 } } }, { $count: 'users' }]),
    Payment.countDocuments({ status: 'requires_reconciliation' }), Payment.countDocuments({ status: 'refund_failed' }),
    WebhookEvent.countDocuments({ status: 'failed' }),
    Campaign.countDocuments({ status: { $in: ['active', 'upcoming'] }, startsAt: { $lte: now }, endsAt: { $gte: now } }),
  ]);
  const alerts = [];
  if (failedBurst[0]?.users) alerts.push({ level: 'warn', message: `${failedBurst[0].users} user(s) had 5+ failed/cancelled payments in the last 24h` });
  if (reconc) alerts.push({ level: 'warn', message: `${reconc} payment(s) need reconciliation (vote could not be recorded)` });
  if (refundFailed) alerts.push({ level: 'error', message: `${refundFailed} refund(s) failed and need attention` });
  if (failedHooks) alerts.push({ level: 'error', message: `${failedHooks} webhook event(s) failed processing` });
  res.json({ success: true, data: {
    stats: {
      totalRegisteredUsers: users, activeCampaigns, activeCategories, totalRecordedVotes: totalVotes, validConfirmedVotes: validVotes,
      paymentsByStatus: byStatus.map((s) => ({ status: s._id, count: s.count, amountInr: s.paise / 100 })), totalVerifiedGatewayPaymentsInr: (paidSum[0]?.paise || 0) / 100, pendingNominations: pendingNoms,
    },
    currentCampaign: publicCampaign(current, now), alerts,
    recentActions: recent.map((a) => ({ id: a._id, action: a.action, by: a.actorId?.name, role: a.actorRole, at: a.createdAt, reason: a.reason })),
  } });
});

/* ------------------------------ Categories ------------------------------ */

const catDto = (c) => ({ id: c._id, name: c.name, slug: c.slug, description: c.description, icon: c.icon, image: c.image?.url || null, displayOrder: c.displayOrder, status: c.status, rules: c.rules, hasHistoricalData: c.hasHistoricalData });

exports.categories = asyncHandler(async (_req, res) => {
  const cats = await Category.find().sort({ displayOrder: 1, name: 1 });
  res.json({ success: true, data: { categories: cats.map(catDto) } });
});
exports.createCategory = asyncHandler(async (req, res) => {
  const slug = await uniqueSlug(Category, req.body.slug || slugify(req.body.name));
  const max = await Category.findOne().sort({ displayOrder: -1 });
  const c = await Category.create({ ...req.body, slug, displayOrder: req.body.displayOrder ?? (max ? max.displayOrder + 1 : 0) });
  await audit(req, 'category.create', { entity: 'Category', entityId: c._id });
  res.status(201).json({ success: true, data: { category: catDto(c) } });
});
exports.updateCategory = asyncHandler(async (req, res) => {
  const c = await Category.findById(req.params.id);
  if (!c) throw ApiError.notFound('Category not found');
  const { slug, ...rest } = req.body;
  if (slug && slug !== c.slug) {
    if (c.hasHistoricalData) throw ApiError.conflict('The slug of a category with historical data cannot change', 'SLUG_LOCKED');
    c.slug = await uniqueSlug(Category, slug, c._id);
  }
  Object.assign(c, rest);
  await c.save();
  await audit(req, 'category.update', { entity: 'Category', entityId: c._id, meta: { fields: Object.keys(req.body) } });
  res.json({ success: true, data: { category: catDto(c) } });
});
exports.reorderCategories = asyncHandler(async (req, res) => {
  await Category.bulkWrite(req.body.order.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { displayOrder: i } } } })));
  await audit(req, 'category.reorder');
  res.json({ success: true });
});
exports.deleteCategory = asyncHandler(async (req, res) => {
  const c = await Category.findById(req.params.id);
  if (!c) throw ApiError.notFound('Category not found');
  const used = c.hasHistoricalData || (await Celebrity.exists({ categoryId: c._id })) || (await Vote.exists({ categoryId: c._id })) || (await RankingSnapshot.exists({ categoryId: c._id }));
  if (used) throw ApiError.conflict('This category has celebrities or campaign history. Archive it instead of deleting.', 'HAS_HISTORY');
  await cloud.destroyImage(c.image?.publicId);
  await c.deleteOne();
  await audit(req, 'category.delete', { entity: 'Category', entityId: c._id });
  res.json({ success: true });
});
exports.categoryImage = asyncHandler(async (req, res) => {
  const c = await Category.findById(req.params.id);
  if (!c) throw ApiError.notFound('Category not found');
  const img = await cloud.replaceImage(c, 'image', req.file, 'category');
  await audit(req, 'category.image', { entity: 'Category', entityId: c._id });
  res.json({ success: true, data: { image: img.url } });
});

/* ------------------------------ Celebrities ------------------------------ */

exports.celebrities = asyncHandler(async (req, res) => {
  const { q, category, status, gender } = req.query;
  const filter = { ...(category && { categoryId: category }), ...(gender && { gender: gender === 'other' ? { $in: ['other', null] } : gender }), ...(status && { status }), ...(q && { name: new RegExp(escapeRegex(q), 'i') }) };
  const { skip, limit } = page(req.query);
  const [items, total, campaign] = await Promise.all([
    Celebrity.find(filter).sort({ name: 1 }).skip(skip).limit(limit).populate('categoryId', 'name slug'), Celebrity.countDocuments(filter), getCurrentCampaign(),
  ]);
  const counts = await Vote.aggregate([{ $match: { campaignId: campaign._id, status: 'confirmed', celebrityId: { $in: items.map((i) => i._id) } } }, { $group: { _id: '$celebrityId', n: { $sum: 1 } } }]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json({ success: true, data: paged(items.map((c) => ({
    id: c._id, code: c.code, name: c.name, slug: c.slug, bio: c.bio, state: c.state, region: c.region, status: c.status, image: c.image?.url || null, gender: c.gender || 'other', socialUrl: c.socialUrl || '', // socialUrl is admin-only: this controller sits behind admin auth
    category: c.categoryId && { id: c.categoryId._id, name: c.categoryId.name }, currentCampaignVotes: byId.get(String(c._id)) || 0, aiDrafted: c.aiDrafted,
  })), total, req.query) });
});
exports.createCelebrity = asyncHandler(async (req, res) => {
  const { force, ...body } = req.body;
  const nameNormalized = normalizeName(body.name);
  const dupes = await Celebrity.find({ nameNormalized, status: { $ne: 'archived' } }).select('name code categoryId');
  if (dupes.length && !force) throw ApiError.conflict('A celebrity with this name already exists', 'POSSIBLE_DUPLICATE', { matches: dupes.map((d) => ({ id: d._id, name: d.name, code: d.code })) });
  if (!(await Category.exists({ _id: body.categoryId, status: { $ne: 'archived' } }))) throw ApiError.unprocessable('Invalid category', 'CATEGORY_INVALID');
  const c = await Celebrity.create({ ...body, slug: await uniqueSlug(Celebrity, slugify(body.name)), createdBy: req.user._id });
  await audit(req, 'celebrity.create', { entity: 'Celebrity', entityId: c._id, meta: { aiDrafted: Boolean(body.aiDrafted) } });
  res.status(201).json({ success: true, data: { id: c._id, code: c.code, slug: c.slug } });
});
exports.updateCelebrity = asyncHandler(async (req, res) => {
  const c = await Celebrity.findById(req.params.id);
  if (!c) throw ApiError.notFound('Celebrity not found');
  const { force, categoryId, ...rest } = req.body;
  if (categoryId && String(categoryId) !== String(c.categoryId)) {
    if (await Vote.exists({ celebrityId: c._id })) throw ApiError.conflict('A celebrity who has received votes cannot change category', 'HAS_VOTES');
    c.categoryId = categoryId;
  }
  Object.assign(c, rest);
  await c.save();
  await audit(req, 'celebrity.update', { entity: 'Celebrity', entityId: c._id, meta: { fields: Object.keys(req.body) } });
  res.json({ success: true });
});
exports.celebrityImage = asyncHandler(async (req, res) => {
  const c = await Celebrity.findById(req.params.id);
  if (!c) throw ApiError.notFound('Celebrity not found');
  const img = await cloud.replaceImage(c, 'image', req.file, 'celebrity');
  await audit(req, 'celebrity.image', { entity: 'Celebrity', entityId: c._id });
  res.json({ success: true, data: { image: img.url } });
});
exports.celebrityRanking = asyncHandler(async (req, res) => {
  const c = await Celebrity.findById(req.params.id);
  if (!c) throw ApiError.notFound('Celebrity not found');
  const campaign = await getCurrentCampaign();
  res.json({ success: true, data: await ranking.celebrityStanding(campaign, c) });
});

/* ------------------------------ Campaigns ------------------------------ */

exports.campaigns = asyncHandler(async (_req, res) => {
  const list = await Campaign.find().sort({ startsAt: -1 }).limit(48);
  const counts = await Vote.aggregate([{ $match: { status: 'confirmed' } }, { $group: { _id: '$campaignId', n: { $sum: 1 } } }]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json({ success: true, data: { campaigns: list.map((c) => ({ ...publicCampaign(c), cutoffTime: c.cutoffTime, persistedStatus: c.status, finalizing: c.finalizing, validVotes: byId.get(String(c._id)) || 0 })) } });
});
exports.updateCampaign = asyncHandler(async (req, res) => {
  const c = await Campaign.findById(req.params.id);
  if (!c) throw ApiError.notFound('Campaign not found');
  if (c.status === 'finalized') throw ApiError.conflict('Finalized campaigns cannot be edited', 'FINALIZED');
  Object.assign(c, req.body);
  await c.save();
  await audit(req, 'campaign.update', { entity: 'Campaign', entityId: c._id });
  res.json({ success: true, data: { campaign: publicCampaign(c) } });
});
exports.campaignResults = asyncHandler(async (req, res) => {
  const c = await Campaign.findById(req.params.id);
  if (!c) throw ApiError.notFound('Campaign not found');
  const cats = await Category.find({ status: { $ne: 'archived' } }).sort({ displayOrder: 1 });
  const results = [];
  for (const cat of cats) {
    const r = await ranking.getRanking({ campaign: c, categoryId: cat._id, scope: 'national' }, { fresh: true });
    results.push({ category: { id: cat._id, name: cat.name }, provisional: r.provisional, totalValidVotes: r.totalValidVotes, entries: r.entries });
  }
  const pending = await Payment.countDocuments({ campaignId: c._id, status: { $in: ['created', 'requires_reconciliation', 'refund_pending', 'refund_failed'] } });
  res.json({ success: true, data: { campaign: publicCampaign(c), results, openPaymentItems: pending } });
});
exports.finalizeCampaign = asyncHandler(async (req, res) => {
  const force = req.body.force && req.user.role === 'superadmin';
  const out = await ranking.finalizeCampaign(req.params.id, { req, force, graceMinutes: env.FINALIZE_GRACE_MINUTES });
  res.json({ success: true, data: out });
});
exports.publishCampaign = asyncHandler(async (req, res) => {
  const c = await Campaign.findOneAndUpdate({ _id: req.params.id, status: 'finalized' }, { $set: { published: true, publishedAt: new Date() } }, { new: true });
  if (!c) throw ApiError.conflict('Only finalized campaigns can be published', 'NOT_FINALIZED');
  await audit(req, 'campaign.publish', { entity: 'Campaign', entityId: c._id });
  res.json({ success: true, data: { campaign: publicCampaign(c) } });
});
exports.correctRanking = asyncHandler(async (req, res) => {
  const out = await ranking.correctCategoryRanking(req.params.id, req.body.categoryId, { reason: req.body.reason, req });
  res.json({ success: true, data: out });
});
exports.snapshots = asyncHandler(async (req, res) => {
  const snaps = await RankingSnapshot.find({ campaignId: req.params.id, scope: 'national', state: '' }).sort({ revision: -1 }).populate('categoryId', 'name');
  res.json({ success: true, data: { snapshots: snaps.map((s) => ({ id: s._id, category: s.categoryId?.name, revision: s.revision, finalizedAt: s.finalizedAt, correctionReason: s.correctionReason, totalValidVotes: s.totalValidVotes, entries: s.entries })) } });
});
exports.runReconcile = asyncHandler(async (req, res) => {
  const out = await reconcile.runAll(new Date());
  await audit(req, 'jobs.reconcile', { meta: out });
  res.json({ success: true, data: out });
});
exports.runTick = asyncHandler(async (req, res) => {
  const out = await scheduler.tick(new Date());
  await audit(req, 'jobs.tick', { meta: out });
  res.json({ success: true, data: out });
});

/* ------------------------------ Votes (fraud review) ------------------------------ */

exports.disqualifyVote = asyncHandler(async (req, res) => {
  const v = await Vote.findOneAndUpdate({ _id: req.params.id, status: 'confirmed' },
    { $set: { status: 'disqualified', disqualifiedReason: req.body.reason, disqualifiedBy: req.user._id, disqualifiedAt: new Date() } }, { new: true });
  if (!v) throw ApiError.notFound('Confirmed vote not found');
  ranking.clearRankingCache();
  const camp = await Campaign.findById(v.campaignId);
  await audit(req, 'vote.disqualify', { entity: 'Vote', entityId: v._id, reason: req.body.reason, meta: { campaign: camp?.key } });
  res.json({ success: true, data: { note: camp?.status === 'finalized' ? 'Campaign is finalized: publish an audited ranking correction for the affected category.' : 'Vote excluded from totals.' } });
});

/* ------------------------------ Users ------------------------------ */

const userDto = (u) => ({ id: u._id, name: u.name, email: contactOf(u.email), role: u.role, status: u.status, emailVerified: u.emailVerified, state: u.state, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, suspensionReason: u.suspensionReason });
exports.users = asyncHandler(async (req, res) => {
  const { q, role, status } = req.query;
  const filter = { ...(role && { role }), ...(status && { status }), ...(q && { $or: [{ name: new RegExp(escapeRegex(q), 'i') }, { email: new RegExp(escapeRegex(q), 'i') }] }) };
  const { skip, limit } = page(req.query);
  const [items, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), User.countDocuments(filter)]);
  res.json({ success: true, data: paged(items.map(userDto), total, req.query) });
});
async function targetUser(req) {
  const u = await User.findById(req.params.id);
  if (!u) throw ApiError.notFound('User not found');
  if (String(u._id) === String(req.user._id)) throw ApiError.forbidden('You cannot perform this action on yourself');
  if (u.role === 'superadmin' || (u.role === 'admin' && req.user.role !== 'superadmin')) throw ApiError.forbidden('Insufficient privileges for this account');
  return u;
}
exports.suspendUser = asyncHandler(async (req, res) => {
  const u = await targetUser(req);
  u.status = 'suspended'; u.suspensionReason = req.body.reason; u.tokenVersion += 1; // ends all sessions
  await u.save();
  await audit(req, 'user.suspend', { entity: 'User', entityId: u._id, reason: req.body.reason });
  res.json({ success: true });
});
exports.unsuspendUser = asyncHandler(async (req, res) => {
  const u = await targetUser(req);
  u.status = 'active'; u.suspensionReason = undefined;
  await u.save();
  await audit(req, 'user.unsuspend', { entity: 'User', entityId: u._id });
  res.json({ success: true });
});
exports.changeRole = asyncHandler(async (req, res) => {
  const u = await targetUser(req);
  const from = u.role; u.role = req.body.role; u.tokenVersion += 1;
  await u.save();
  await audit(req, 'user.role', { entity: 'User', entityId: u._id, meta: { from, to: u.role } });
  res.json({ success: true });
});
exports.createAdmin = asyncHandler(async (req, res) => {
  if (await User.exists({ email: req.body.email })) throw ApiError.conflict('Email already registered', 'EMAIL_TAKEN');
  const u = await User.create({ name: req.body.name, email: req.body.email, role: req.body.role, emailVerified: true, passwordHash: await bcrypt.hash(req.body.password, 12) });
  await audit(req, 'admin.create', { entity: 'User', entityId: u._id, meta: { role: u.role } });
  res.status(201).json({ success: true, data: { id: u._id } });
});

/* ------------------------------ Payments & receipts ------------------------------ */

exports.payments = asyncHandler(async (req, res) => {
  const { status, campaign, from, to, minInr, maxInr } = req.query;
  const filter = {};
  if (status) filter.status = { $in: status.split(',') };
  if (campaign) { const c = await Campaign.findOne({ key: campaign }); filter.campaignId = c?._id || null; }
  if (from || to) filter.createdAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  if (minInr !== undefined || maxInr !== undefined) filter.amountPaise = { ...(minInr !== undefined && { $gte: minInr * 100 }), ...(maxInr !== undefined && { $lte: maxInr * 100 }) };
  const { skip, limit } = page(req.query);
  const [items, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'name email').populate('celebrityId', 'name code').populate('categoryId', 'name').populate('campaignId', 'key'),
    Payment.countDocuments(filter),
  ]);
  res.json({ success: true, data: paged(items.map((p) => ({
    id: p._id, status: p.status, method: p.method, amountInr: p.amountPaise / 100, createdAt: p.createdAt, paidAt: p.paidAt, campaign: p.campaignId?.key,
    user: p.userId && { id: p.userId._id, name: p.userId.name, email: p.userId.email }, celebrity: p.celebrityId?.name, category: p.categoryId?.name,
    razorpayOrderId: p.razorpayOrderId, razorpayPaymentId: p.razorpayPaymentId, voteId: p.voteId, receiptId: p.receiptId,
    failureReason: p.failureReason, reconciliationReason: p.reconciliationReason, refund: p.refund,
  })), total, req.query) });
});
exports.refund = asyncHandler(async (req, res) => {
  const p = await Payment.findById(req.params.id);
  if (!p) throw ApiError.notFound('Payment not found');
  const out = await paymentService.refundPayment(p, { reason: req.body.reason, initiatedBy: req.user._id });
  await audit(req, 'payment.refund', { entity: 'Payment', entityId: p._id, reason: req.body.reason, meta: { amountPaise: p.amountPaise } });
  res.json({ success: true, data: { status: out.status } });
});
exports.receiptsList = asyncHandler(async (req, res) => {
  const { skip, limit } = page(req.query);
  const [items, total] = await Promise.all([Receipt.find().sort({ issuedAt: -1 }).skip(skip).limit(limit), Receipt.countDocuments()]);
  res.json({ success: true, data: paged(items.map((r) => ({ id: r._id, receiptNo: r.receiptNo, issuedAt: r.issuedAt, celebrity: r.snapshot.celebrityName, category: r.snapshot.categoryName, amountInr: r.snapshot.amountPaise / 100, userMasked: r.snapshot.userMasked })), total, req.query) });
});
exports.webhookEvents = asyncHandler(async (_req, res) => {
  const items = await WebhookEvent.find().sort({ receivedAt: -1 }).limit(100);
  res.json({ success: true, data: { events: items } });
});

/* ------------------------------ Nominations ------------------------------ */

exports.nominations = asyncHandler(async (req, res) => {
  const filter = req.query.status ? { status: req.query.status } : {};
  const { skip, limit } = page(req.query);
  const [items, total] = await Promise.all([Nomination.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('categoryId', 'name').populate('possibleDuplicates', 'name code'), Nomination.countDocuments(filter)]);
  res.json({ success: true, data: paged(items.map((n) => ({ id: n._id, name: n.name, category: n.categoryId?.name, categoryId: n.categoryId?._id, gender: n.gender || 'other', socialUrl: n.socialUrl || '', source: n.source || 'user', state: n.state, reason: n.reason, links: n.links, status: n.status, createdAt: n.createdAt, possibleDuplicates: n.possibleDuplicates })), total, req.query) });
});
/** Admin adds a nomination directly (same short form as the public one, plus the private social link). */
exports.createNomination = asyncHandler(async (req, res) => {
  const { name, categoryId, gender, state, reason, socialUrl } = req.body;
  if (!(await Category.exists({ _id: categoryId, status: { $ne: 'archived' } }))) throw ApiError.unprocessable('Invalid category', 'CATEGORY_INVALID');
  const nameNormalized = normalizeName(name);
  if (await Celebrity.exists({ nameNormalized, categoryId, status: { $ne: 'archived' } })) throw ApiError.conflict('This celebrity is already on FameVote in that category', 'ALREADY_LISTED');
  if (await Nomination.exists({ nameNormalized, categoryId, status: 'pending' })) throw ApiError.conflict('This celebrity is already waiting for review', 'ALREADY_NOMINATED');
  const n = await Nomination.create({ nominatedBy: req.user._id, name, nameNormalized, categoryId, gender, state, reason, socialUrl, source: 'admin' });
  await audit(req, 'nomination.create', { entity: 'Nomination', entityId: n._id });
  res.status(201).json({ success: true, data: { id: n._id } });
});
exports.reviewNomination = asyncHandler(async (req, res) => {
  const n = await Nomination.findById(req.params.id);
  if (!n) throw ApiError.notFound('Nomination not found');
  if (n.status !== 'pending') throw ApiError.conflict('This nomination was already reviewed', 'ALREADY_REVIEWED');
  const { decision, note, celebrityId } = req.body;
  if (decision === 'approve') {
    const dup = await Celebrity.findOne({ nameNormalized: n.nameNormalized, categoryId: n.categoryId, status: { $ne: 'archived' } });
    if (dup) throw ApiError.conflict('A celebrity with this name already exists in the category', 'POSSIBLE_DUPLICATE');
    const c = await Celebrity.create({ name: n.name, categoryId: n.categoryId, state: n.state, gender: n.gender || 'other', socialUrl: n.socialUrl || undefined, slug: await uniqueSlug(Celebrity, slugify(n.name)), status: 'inactive', createdBy: req.user._id, bio: '' });
    n.celebrityId = c._id; // created inactive: an admin completes the profile (image, bio) and activates it
  } else if (decision === 'duplicate' && celebrityId) n.celebrityId = celebrityId;
  n.status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'duplicate';
  n.reviewedBy = req.user._id; n.reviewedAt = new Date(); n.reviewNote = note;
  await n.save();
  Notification.create({ userId: n.nominatedBy, type: 'nomination_update', title: `Nomination ${n.status}`, body: `Your nomination of ${n.name} was ${n.status}.`, link: '/nominate' }).catch(() => {});
  await audit(req, 'nomination.review', { entity: 'Nomination', entityId: n._id, reason: note, meta: { decision } });
  res.json({ success: true, data: { celebrityId: n.celebrityId } });
});

/* ------------------------------ Settings, banners, announcements ------------------------------ */

exports.getSettings = asyncHandler(async (_req, res) => {
  const s = await Settings.get();
  res.json({ success: true, data: { voteAmountInr: s.voteAmountInr, allowCustomAmount: s.allowCustomAmount !== false, cutoffTime: s.cutoffTime, currency: 'INR', allowedRangeInr: [0, 7], banners: s.banners, announcements: s.announcements, razorpayConfigured: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET), minGatewayInr: paymentService.MIN_GATEWAY_PAISE / 100 } });
});
exports.updateSettings = asyncHandler(async (req, res) => {
  const s = await Settings.get();
  const before = { voteAmountInr: s.voteAmountInr, allowCustomAmount: s.allowCustomAmount, cutoffTime: s.cutoffTime };
  if (req.body.allowCustomAmount !== undefined) s.allowCustomAmount = req.body.allowCustomAmount;
  if (req.body.voteAmountInr !== undefined) {
    const inr = req.body.voteAmountInr;
    if (inr > 0 && inr * 100 < paymentService.MIN_GATEWAY_PAISE) throw ApiError.unprocessable('Amount is below the payment gateway minimum', 'AMOUNT_BELOW_MINIMUM');
    if (inr > 0 && !(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET)) throw ApiError.conflict('Configure Razorpay before enabling a paid amount', 'PAYMENTS_UNAVAILABLE');
    s.voteAmountInr = inr;
  }
  if (req.body.cutoffTime) s.cutoffTime = req.body.cutoffTime; // applies to campaigns created from now on
  s.updatedBy = req.user._id;
  await s.save();
  await audit(req, 'settings.update', { entity: 'Settings', meta: { before, after: { voteAmountInr: s.voteAmountInr, allowCustomAmount: s.allowCustomAmount, cutoffTime: s.cutoffTime } } });
  res.json({ success: true, data: { voteAmountInr: s.voteAmountInr, allowCustomAmount: s.allowCustomAmount, cutoffTime: s.cutoffTime } });
});
exports.addAnnouncement = asyncHandler(async (req, res) => {
  const s = await Settings.get();
  s.announcements.push({ message: req.body.message });
  await s.save();
  await audit(req, 'announcement.create');
  res.status(201).json({ success: true });
});
exports.removeAnnouncement = asyncHandler(async (req, res) => {
  await Settings.updateOne({ key: 'global' }, { $pull: { announcements: { _id: req.params.id } } });
  await audit(req, 'announcement.delete', { entityId: req.params.id });
  res.json({ success: true });
});
exports.addBanner = asyncHandler(async (req, res) => {
  const s = await Settings.get();
  const image = req.file ? await cloud.uploadImage(req.file, 'banner') : undefined;
  s.banners.push({ ...req.body, image });
  await s.save();
  await audit(req, 'banner.create');
  res.status(201).json({ success: true });
});
exports.removeBanner = asyncHandler(async (req, res) => {
  const s = await Settings.get();
  const b = s.banners.id(req.params.id);
  if (!b) throw ApiError.notFound('Banner not found');
  await cloud.destroyImage(b.image?.publicId);
  b.deleteOne();
  await s.save();
  await audit(req, 'banner.delete', { entityId: req.params.id });
  res.json({ success: true });
});
exports.broadcast = asyncHandler(async (req, res) => {
  const n = await Notification.create({ userId: null, ...req.body, status: 'published' });
  await audit(req, 'notification.broadcast', { entity: 'Notification', entityId: n._id });
  res.status(201).json({ success: true });
});
exports.uploadAsset = asyncHandler(async (req, res) => {
  const img = await cloud.uploadImage(req.file, 'campaign');
  await audit(req, 'asset.upload');
  res.status(201).json({ success: true, data: img });
});

/* ------------------------------ Audit & reports ------------------------------ */

exports.audit = asyncHandler(async (req, res) => {
  const filter = req.query.action ? { action: new RegExp(`^${escapeRegex(req.query.action)}`) } : {};
  const { skip, limit } = page(req.query);
  const [items, total] = await Promise.all([AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('actorId', 'name email'), AuditLog.countDocuments(filter)]);
  res.json({ success: true, data: paged(items.map((a) => ({ id: a._id, action: a.action, entity: a.entity, entityId: a.entityId, reason: a.reason, meta: a.meta, actor: a.actorId && { name: a.actorId.name, email: a.actorId.email }, role: a.actorRole, at: a.createdAt })), total, req.query) });
});

const csvCell = (v) => {
  let s = v === undefined || v === null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) => [header.join(','), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(','))].join('\r\n');

exports.report = asyncHandler(async (req, res) => {
  const { type, campaign } = req.query;
  const camp = campaign ? await Campaign.findOne({ key: campaign }) : null;
  if (campaign && !camp) throw ApiError.notFound('Campaign not found');
  let header; let rows;
  if (type === 'votes') {
    header = ['campaign', 'category', 'celebrity', 'celebrityCode', 'state', 'status', 'receiptNo', 'at'];
    const votes = await Vote.find(camp ? { campaignId: camp._id } : {}).sort({ createdAt: -1 }).limit(50_000).populate('campaignId', 'key').populate('categoryId', 'name').populate('celebrityId', 'name code').populate('receiptId', 'receiptNo');
    rows = votes.map((v) => ({ campaign: v.campaignId?.key, category: v.categoryId?.name, celebrity: v.celebrityId?.name, celebrityCode: v.celebrityId?.code, state: v.state, status: v.status, receiptNo: v.receiptId?.receiptNo, at: v.createdAt }));
  } else if (type === 'payments') {
    header = ['campaign', 'status', 'method', 'amountInr', 'razorpayOrderId', 'razorpayPaymentId', 'createdAt', 'paidAt', 'reconciliationReason'];
    const pays = await Payment.find(camp ? { campaignId: camp._id } : {}).sort({ createdAt: -1 }).limit(50_000).populate('campaignId', 'key');
    rows = pays.map((p) => ({ campaign: p.campaignId?.key, status: p.status, method: p.method, amountInr: p.amountPaise / 100, razorpayOrderId: p.razorpayOrderId, razorpayPaymentId: p.razorpayPaymentId, createdAt: p.createdAt, paidAt: p.paidAt, reconciliationReason: p.reconciliationReason }));
  } else if (type === 'rankings') {
    if (!camp) throw ApiError.badRequest('campaign is required for rankings reports');
    header = ['category', 'scope', 'state', 'group', 'rank', 'celebrity', 'votes', 'revision'];
    const snaps = await RankingSnapshot.find({ campaignId: camp._id }).populate('categoryId', 'name');
    rows = snaps.flatMap((s) => s.entries.map((e) => ({ category: s.categoryId?.name, scope: s.scope, state: s.state.split('~')[0], group: s.state.includes('~') ? s.state.split('~')[1] : 'all', rank: e.rank, celebrity: e.name, votes: e.votes, revision: s.revision })));
  } else {
    header = ['at', 'action', 'actorRole', 'entity', 'entityId', 'reason'];
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(50_000);
    rows = logs.map((a) => ({ at: a.createdAt, action: a.action, actorRole: a.actorRole, entity: a.entity, entityId: a.entityId, reason: a.reason }));
  }
  await audit(req, 'report.export', { meta: { type, campaign } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="famevote-${type}${campaign ? `-${campaign}` : ''}.csv"`);
  res.send(toCsv(header, rows));
});
