const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { handleWebhook } = require('../services/paymentService');

// Mounted with express.raw(), so req.body is the untouched Buffer needed for HMAC verification.
router.post('/', asyncHandler(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw ApiError.badRequest('Empty webhook body');
  const result = await handleWebhook(req.body, req.get('x-razorpay-signature'), req.get('x-razorpay-event-id'));
  res.status(200).json({ success: true, duplicate: Boolean(result.duplicate) });
}));

module.exports = router;
