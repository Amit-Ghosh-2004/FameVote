const router = require('express').Router();
const validate = require('../middleware/validate');
const { requireAuth, optionalSession } = require('../middleware/auth');
const { authLimiter, aiLimiter, uploadLimiter } = require('../middleware/security');
const { upload } = require('../services/cloudinaryService');
const { idParam } = require('../validators/common');
const authC = require('../controllers/authController');
const authV = require('../validators/auth');
const a = require('../controllers/adminController');
const ai = require('../controllers/aiController');
const v = require('../validators/admin');

/* Separate admin session: its own cookie, secret, 8h expiry. */
router.post('/auth/login', authLimiter, validate({ body: authV.login }), authC.adminLogin);
router.post('/auth/logout', authC.logout(true));
router.get('/auth/session', optionalSession({ admin: true }), authC.session);
router.get('/auth/me', requireAuth({ admin: true }), authC.me);

const mod = requireAuth({ admin: true, minRole: 'moderator' });
const adm = requireAuth({ admin: true, minRole: 'admin' });
const sup = requireAuth({ admin: true, minRole: 'superadmin' });
const img = [uploadLimiter, upload.single('image')];

router.get('/dashboard', mod, a.dashboard);

/* Categories: view = moderator, manage = admin */
router.get('/categories', mod, a.categories);
router.post('/categories', adm, validate({ body: v.category }), a.createCategory);
router.put('/categories/reorder', adm, validate({ body: v.reorder }), a.reorderCategories);
router.patch('/categories/:id', adm, validate({ params: idParam, body: v.categoryUpdate }), a.updateCategory);
router.delete('/categories/:id', adm, validate({ params: idParam }), a.deleteCategory);
router.put('/categories/:id/image', adm, ...img, validate({ params: idParam }), a.categoryImage);

/* Celebrities: moderators may manage profiles */
router.get('/celebrities', mod, validate({ query: v.celebrityList }), a.celebrities);
router.post('/celebrities', mod, validate({ body: v.celebrity }), a.createCelebrity);
router.patch('/celebrities/:id', mod, validate({ params: idParam, body: v.celebrityUpdate }), a.updateCelebrity);
router.put('/celebrities/:id/image', mod, ...img, validate({ params: idParam }), a.celebrityImage);
router.get('/celebrities/:id/ranking', mod, validate({ params: idParam }), a.celebrityRanking);

/* Campaigns */
router.get('/campaigns', mod, a.campaigns);
router.patch('/campaigns/:id', adm, validate({ params: idParam, body: v.campaignUpdate }), a.updateCampaign);
router.get('/campaigns/:id/results', mod, validate({ params: idParam }), a.campaignResults);
router.get('/campaigns/:id/snapshots', mod, validate({ params: idParam }), a.snapshots);
router.post('/campaigns/:id/finalize', sup, validate({ params: idParam, body: v.finalize }), a.finalizeCampaign);
router.post('/campaigns/:id/publish', adm, validate({ params: idParam }), a.publishCampaign);
router.post('/campaigns/:id/correct', sup, validate({ params: idParam, body: v.correction }), a.correctRanking);
router.post('/jobs/reconcile', adm, a.runReconcile);
router.post('/jobs/tick', sup, a.runTick);

/* Fraud review: only superadmin; votes are never deleted, only disqualified with a reason */
router.post('/votes/:id/disqualify', sup, validate({ params: idParam, body: v.disqualify }), a.disqualifyVote);

/* Users */
router.get('/users', mod, validate({ query: v.userList }), a.users);
router.post('/users/:id/suspend', adm, validate({ params: idParam, body: v.suspend }), a.suspendUser);
router.post('/users/:id/unsuspend', adm, validate({ params: idParam }), a.unsuspendUser);
router.patch('/users/:id/role', sup, validate({ params: idParam, body: v.roleChange }), a.changeRole);
router.post('/admins', sup, validate({ body: v.createAdmin }), a.createAdmin);

/* Payments: view = admin, refund = superadmin. There is intentionally NO endpoint to mark a payment as paid. */
router.get('/payments', adm, validate({ query: v.paymentList }), a.payments);
router.post('/payments/:id/refund', sup, validate({ params: idParam, body: v.refund }), a.refund);
router.get('/receipts', adm, validate({ query: v.celebrityList.pick({ page: true, limit: true }) }), a.receiptsList);
router.get('/webhook-events', adm, a.webhookEvents);

/* Nominations */
router.get('/nominations', mod, validate({ query: v.nominationList }), a.nominations);
router.post('/nominations', mod, validate({ body: v.nominationCreate }), a.createNomination);
router.post('/nominations/:id/review', mod, validate({ params: idParam, body: v.nominationReview }), a.reviewNomination);

/* Settings (payment amount is superadmin only), banners, announcements, notifications */
router.get('/settings', adm, a.getSettings);
router.patch('/settings', sup, validate({ body: v.settings }), a.updateSettings);
router.post('/announcements', adm, validate({ body: v.announcement }), a.addAnnouncement);
router.delete('/announcements/:id', adm, validate({ params: idParam }), a.removeAnnouncement);
router.post('/banners', adm, ...img, validate({ body: v.banner }), a.addBanner);
router.delete('/banners/:id', adm, validate({ params: idParam }), a.removeBanner);
router.post('/notifications', adm, validate({ body: v.broadcast }), a.broadcast);
router.post('/uploads', adm, ...img, a.uploadAsset);

/* Audit & reports */
router.get('/audit-logs', adm, validate({ query: v.auditList }), a.audit);
router.get('/reports', adm, validate({ query: v.reportType }), a.report);

/* Gemini assistants: draft-only, rate limited, with manual fallbacks */
router.post('/ai/autocomplete', aiLimiter, mod, validate({ body: v.ai.autocomplete }), ai.autocomplete);
router.post('/ai/biography', aiLimiter, mod, validate({ body: v.ai.biography }), ai.biography);
router.post('/ai/category', aiLimiter, mod, validate({ body: v.ai.category }), ai.suggestCategory);
router.post('/ai/nomination', aiLimiter, mod, validate({ body: v.ai.nomination }), ai.summarizeNomination);
router.post('/ai/duplicates', aiLimiter, mod, validate({ body: v.ai.duplicates }), ai.duplicates);
router.post('/ai/seo', aiLimiter, mod, validate({ body: v.ai.seo }), ai.seo);
router.post('/ai/announcement', aiLimiter, adm, validate({ body: v.ai.announcement }), ai.announcement);
router.post('/ai/search', aiLimiter, mod, validate({ body: v.ai.nlSearch }), ai.nlSearch);

module.exports = router;
