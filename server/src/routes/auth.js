const router = require('express').Router();
const c = require('../controllers/authController');
const v = require('../validators/auth');
const validate = require('../middleware/validate');
const { requireAuth, optionalSession } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');

router.post('/register', authLimiter, validate({ body: v.register }), c.register);
router.post('/login', authLimiter, validate({ body: v.login }), c.login);
router.post('/google', authLimiter, validate({ body: v.google }), c.googleLogin);
router.post('/phone/send', authLimiter, validate({ body: v.phoneSend }), c.phoneSend);
router.post('/phone/verify', authLimiter, validate({ body: v.phoneVerify }), c.phoneVerify);
router.post('/logout', c.logout(false));
router.get('/session', optionalSession(), c.session);
router.get('/me', requireAuth(), c.me);
router.post('/forgot-password', authLimiter, validate({ body: v.forgot }), c.forgotPassword);
router.post('/reset-password', authLimiter, validate({ body: v.reset }), c.resetPassword);
router.patch('/profile', requireAuth(), validate({ body: v.profile }), c.updateProfile);
router.post('/change-password', authLimiter, requireAuth(), validate({ body: v.changePassword }), c.changePassword);

module.exports = router;
