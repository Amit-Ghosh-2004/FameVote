const router = require('express').Router();
const validate = require('../middleware/validate');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { voteLimiter, authLimiter, aiLimiter, uploadLimiter, publicCache } = require('../middleware/security');
const { upload } = require('../services/cloudinaryService');
const ai = require('../controllers/aiController');
const adminV = require('../validators/admin');
const v = require('../validators/public');
const { z, idParam } = require('../validators/common');
const pub = require('../controllers/publicController');
const usr = require('../controllers/userController');

/* ---- Public data ---- */
router.get('/meta', publicCache(15), pub.meta);
router.get('/categories', publicCache(30), pub.categories);
router.get('/celebrities', publicCache(30), validate({ query: v.celebrityList }), pub.celebrities);
router.get('/celebrities/:idOrSlug', optionalAuth, pub.celebrity);
router.get('/campaigns', publicCache(30), pub.campaigns);
router.get('/campaigns/current', publicCache(15), pub.currentCampaign);
router.get('/rankings/home', publicCache(10), pub.homeRankings);
router.get('/rankings', publicCache(10), validate({ query: v.rankings }), pub.rankings);
router.get('/winners', publicCache(60), validate({ query: v.winners }), pub.winners);
router.get('/receipts/verify', authLimiter, validate({ query: v.receiptVerify }), usr.verifyReceipt);

/* ---- FAQ (answers come only from the verified rules list) ---- */
router.get('/faq', ai.faq);
router.post('/faq/ask', aiLimiter, validate({ body: adminV.ai.faq }), ai.faqAsk);

/* ---- Voting (authenticated users) ---- */
router.get('/votes/eligibility', requireAuth(), validate({ query: v.eligibility }), usr.eligibility);
router.post('/votes', voteLimiter, requireAuth({ verified: true }), validate({ body: v.vote }), usr.castFreeVote);
router.get('/votes/mine', requireAuth(), usr.myVotes);

/* ---- Payments ---- */
router.post('/payments/order', voteLimiter, requireAuth({ verified: true }), validate({ body: v.vote }), usr.createOrder);
router.post('/payments/verify', voteLimiter, requireAuth({ verified: true }), validate({ body: v.verifyPayment }), usr.verifyPayment);
router.get('/payments/mine', requireAuth(), usr.myPayments);
router.get('/payments/:id', requireAuth(), validate({ params: idParam }), usr.paymentStatus);
router.post('/payments/:id/cancel', requireAuth(), validate({ params: idParam }), usr.cancelPayment);

/* ---- Receipts (owner only) ---- */
router.get('/receipts', requireAuth(), usr.myReceipts);
router.get('/receipts/:id', requireAuth(), validate({ params: idParam }), usr.receipt);
router.get('/receipts/:id/pdf', requireAuth(), validate({ params: idParam }), usr.receiptPdf);

/* ---- Dashboard ---- */
router.get('/me/dashboard', requireAuth(), usr.dashboard);
router.put('/me/avatar', uploadLimiter, requireAuth(), upload.single('image'), usr.avatar);
router.get('/me/favorites', requireAuth(), usr.favorites);
router.post('/me/favorites', requireAuth(), validate({ body: v.favorite }), usr.addFavorite);
router.delete('/me/favorites/:id', requireAuth(), validate({ params: idParam }), usr.removeFavorite);
router.get('/me/notifications', requireAuth(), usr.notifications);
router.post('/me/notifications/read', requireAuth(), usr.markNotificationsRead);

/* ---- Nominations ---- */
router.post('/nominations', requireAuth({ verified: true }), validate({ body: v.nomination }), usr.nominate);
router.get('/nominations/mine', requireAuth(), usr.myNominations);

module.exports = router;
