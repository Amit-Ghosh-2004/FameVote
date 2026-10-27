const { Vote, Payment, Receipt, Favorite, Notification, Nomination, Celebrity, Category, Settings } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { normalizeName } = require('../models/Celebrity');
const { getCurrentCampaign, publicCampaign, effectiveStatus } = require('../services/campaignService');
const voteService = require('../services/voteService');
const paymentService = require('../services/paymentService');
const receiptService = require('../services/receiptService');
const { publicCelebrity } = require('./publicController');

const voteDto = (v) => ({
  id: v._id, status: v.status, createdAt: v.createdAt, state: v.state,
  celebrity: v.celebrityId?.name ? { id: v.celebrityId._id, name: v.celebrityId.name, code: v.celebrityId.code, image: v.celebrityId.image?.url, slug: v.celebrityId.slug } : v.celebrityId,
  category: v.categoryId?.name ? { id: v.categoryId._id, name: v.categoryId.name, slug: v.categoryId.slug } : v.categoryId,
  campaign: v.campaignId?.key ? { id: v.campaignId._id, key: v.campaignId.key, title: v.campaignId.title } : v.campaignId,
  receiptNo: v.receiptId?.receiptNo, receiptId: v.receiptId?._id || v.receiptId,
});

const paymentDto = (p) => ({
  id: p._id, amountInr: p.amountPaise / 100, currency: p.currency, method: p.method, status: p.status, createdAt: p.createdAt, paidAt: p.paidAt,
  razorpayPaymentId: p.razorpayPaymentId, voteId: p.voteId, receiptId: p.receiptId,
  refund: p.refund?.initiatedAt ? { status: p.status, amountInr: (p.refund.amountPaise || 0) / 100, at: p.refund.processedAt || p.refund.initiatedAt } : undefined,
  note: p.status === 'requires_reconciliation' || p.status === 'refund_pending' ? 'Your payment could not produce a vote and is being refunded.' : undefined,
});

/* ----------------------------- Voting ----------------------------- */

exports.eligibility = asyncHandler(async (req, res) => {
  const { categoryId } = req.query;
  const [campaign, settings] = await Promise.all([getCurrentCampaign(), Settings.get()]);
  const existing = await Vote.findOne({ userId: req.user._id, campaignId: campaign._id, categoryId }).populate('celebrityId', 'name code image slug');
  let canVote = true; let reason = null;
  if (existing) { canVote = false; reason = 'ALREADY_VOTED'; }
  else if (!req.user.state) { canVote = false; reason = 'STATE_REQUIRED'; }
  else if (effectiveStatus(campaign) !== 'active') { canVote = false; reason = effectiveStatus(campaign) === 'upcoming' ? 'CAMPAIGN_NOT_STARTED' : 'CAMPAIGN_CLOSED'; }
  res.json({ success: true, data: {
    canVote, reason, campaign: publicCampaign(campaign), amountInr: settings.voteAmountInr, allowCustomAmount: settings.allowCustomAmount !== false, rangeInr: [0, 7], paymentsAvailable: Boolean(require('../config/env').RAZORPAY_KEY_ID && require('../config/env').RAZORPAY_KEY_SECRET), currency: 'INR', free: settings.voteAmountInr === 0 && settings.allowCustomAmount === false,
    votedFor: existing ? { celebrity: existing.celebrityId?.name, at: existing.createdAt, receiptId: existing.receiptId } : null,
  } });
});

exports.castFreeVote = asyncHandler(async (req, res) => {
  const result = await voteService.submitFreeVote(req.user, { ...req.body, idempotencyKey: req.get('idempotency-key')?.slice(0, 80) });
  res.status(201).json({ success: true, data: { voteId: result.vote._id, receipt: receiptService.publicReceipt(result.receipt) } });
});

exports.myVotes = asyncHandler(async (req, res) => {
  const votes = await voteService.listMyVotes(req.user._id);
  res.json({ success: true, data: { votes: votes.map(voteDto) } });
});

/* ----------------------------- Payments ----------------------------- */

exports.createOrder = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await paymentService.createOrder(req.user, req.body) });
});

exports.verifyPayment = asyncHandler(async (req, res) => {
  const r = await paymentService.verifyClientPayment(req.user, req.body);
  const receipt = r.receipt?.receiptNo ? receiptService.publicReceipt(r.receipt) : undefined;
  res.json({ success: true, data: { status: r.status, reason: r.reason, receipt, receiptId: r.receipt?._id } });
});

exports.cancelPayment = asyncHandler(async (req, res) => {
  await paymentService.cancelPayment(req.user, req.params.id);
  res.json({ success: true });
});

exports.myPayments = asyncHandler(async (req, res) => {
  const items = await Payment.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: { payments: items.map(paymentDto) } });
});

/** Polling endpoint so the UI can show the final state after a delayed webhook. */
exports.paymentStatus = asyncHandler(async (req, res) => {
  const p = await Payment.findOne({ _id: req.params.id, userId: req.user._id }); // ownership enforced in the query
  if (!p) throw ApiError.notFound('Payment not found');
  res.json({ success: true, data: { payment: paymentDto(p) } });
});

/* ----------------------------- Receipts ----------------------------- */

async function ownReceipt(req) {
  const r = await Receipt.findOne({ _id: req.params.id, userId: req.user._id }); // IDOR-safe: owner in the query, 404 otherwise
  if (!r) throw ApiError.notFound('Receipt not found');
  return r;
}
exports.myReceipts = asyncHandler(async (req, res) => {
  const items = await Receipt.find({ userId: req.user._id }).sort({ issuedAt: -1 }).limit(200);
  res.json({ success: true, data: { receipts: items.map(receiptService.publicReceipt) } });
});
exports.receipt = asyncHandler(async (req, res) => res.json({ success: true, data: { receipt: receiptService.publicReceipt(await ownReceipt(req)) } }));
exports.receiptPdf = asyncHandler(async (req, res) => { await receiptService.streamReceiptPdf(await ownReceipt(req), res); });
exports.verifyReceipt = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await receiptService.verifyReceipt(req.query.receiptNo, req.query.ref) });
});

/* ----------------------------- Dashboard ----------------------------- */

exports.dashboard = asyncHandler(async (req, res) => {
  const campaign = await getCurrentCampaign();
  const [votes, unread, settings, categories] = await Promise.all([
    Vote.find({ userId: req.user._id, campaignId: campaign._id }).populate('celebrityId', 'name').populate('categoryId', 'name slug'),
    Notification.countDocuments({ userId: req.user._id, readAt: { $exists: false } }),
    Settings.get(), Category.find({ status: 'active' }).select('name slug'),
  ]);
  const votedIds = new Set(votes.map((v) => String(v.categoryId._id)));
  res.json({ success: true, data: {
    user: req.user.toSafeJSON(), campaign: publicCampaign(campaign), amountInr: settings.voteAmountInr, allowCustomAmount: settings.allowCustomAmount !== false, unreadNotifications: unread,
    eligibility: { emailVerified: true, stateSet: Boolean(req.user.state), votingOpen: effectiveStatus(campaign) === 'active',
      canVote: Boolean(req.user.state) && effectiveStatus(campaign) === 'active' },
    thisMonth: { votesCast: votes.length, categoriesRemaining: categories.filter((c) => !votedIds.has(String(c._id))).map((c) => ({ id: c._id, name: c.name, slug: c.slug })),
      votes: votes.map((v) => ({ category: v.categoryId.name, celebrity: v.celebrityId.name, at: v.createdAt })) },
  } });
});

exports.avatar = asyncHandler(async (req, res) => {
  const img = await require('../services/cloudinaryService').replaceImage(req.user, 'avatar', req.file, 'avatar');
  res.json({ success: true, data: { avatar: img.url } });
});

/* ----------------------------- Favorites ----------------------------- */

exports.favorites = asyncHandler(async (req, res) => {
  const favs = await Favorite.find({ userId: req.user._id }).sort({ createdAt: -1 }).populate({ path: 'celebrityId', populate: { path: 'categoryId', select: 'name slug' } });
  res.json({ success: true, data: { favorites: favs.filter((f) => f.celebrityId).map((f) => publicCelebrity(f.celebrityId)) } });
});
exports.addFavorite = asyncHandler(async (req, res) => {
  const celeb = await Celebrity.findOne({ _id: req.body.celebrityId, status: 'active' });
  if (!celeb) throw ApiError.notFound('Celebrity not found');
  await Favorite.updateOne({ userId: req.user._id, celebrityId: celeb._id }, { $setOnInsert: { userId: req.user._id, celebrityId: celeb._id } }, { upsert: true });
  res.status(201).json({ success: true });
});
exports.removeFavorite = asyncHandler(async (req, res) => {
  await Favorite.deleteOne({ userId: req.user._id, celebrityId: req.params.id });
  res.json({ success: true });
});

/* --------------------------- Notifications --------------------------- */

exports.notifications = asyncHandler(async (req, res) => {
  const items = await Notification.find({ status: 'published', $or: [{ userId: req.user._id }, { userId: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }] })
    .sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, data: { notifications: items.map((n) => ({ id: n._id, type: n.type, title: n.title, body: n.body, link: n.link, read: Boolean(n.readAt) || !n.userId, createdAt: n.createdAt })) } });
});
exports.markNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ userId: req.user._id, readAt: { $exists: false } }, { $set: { readAt: new Date() } });
  res.json({ success: true });
});

/* ---------------------------- Nominations ---------------------------- */

exports.nominate = asyncHandler(async (req, res) => {
  const { name, categoryId, state, reason, links, gender } = req.body;
  const category = await Category.findOne({ _id: categoryId, status: 'active', 'rules.allowNominations': { $ne: false } });
  if (!category) throw ApiError.unprocessable('This category is not accepting nominations', 'CATEGORY_INACTIVE');
  const nameNormalized = normalizeName(name);
  if (await Celebrity.exists({ nameNormalized, categoryId, status: { $ne: 'archived' } })) throw ApiError.conflict('This celebrity is already on FameVote in that category', 'ALREADY_LISTED');
  if (await Nomination.exists({ nameNormalized, categoryId, status: 'pending' })) throw ApiError.conflict('This celebrity has already been nominated and is awaiting review', 'ALREADY_NOMINATED');
  const pending = await Nomination.countDocuments({ nominatedBy: req.user._id, status: 'pending' });
  if (pending >= 10) throw ApiError.tooMany('You have too many nominations awaiting review', 'TOO_MANY_PENDING');
  const near = await Celebrity.find({ nameNormalized: { $regex: `^${nameNormalized.slice(0, 4)}` }, categoryId }).limit(5).select('_id');
  const n = await Nomination.create({ nominatedBy: req.user._id, name, nameNormalized, categoryId, state, gender, reason, links, possibleDuplicates: near.map((c) => c._id) });
  res.status(201).json({ success: true, data: { id: n._id, status: n.status } });
});
exports.myNominations = asyncHandler(async (req, res) => {
  const items = await Nomination.find({ nominatedBy: req.user._id }).sort({ createdAt: -1 }).limit(50).populate('categoryId', 'name');
  res.json({ success: true, data: { nominations: items.map((n) => ({ id: n._id, name: n.name, category: n.categoryId?.name, gender: n.gender, status: n.status, note: n.status === 'rejected' ? n.reviewNote : undefined, createdAt: n.createdAt })) } });
});

exports.paymentDto = paymentDto;
exports.voteDto = voteDto;
