const { z, objectId, stateCode, pagination, search } = require('./common');
const { GENDERS } = require('../utils/gender');
const gender = z.enum(GENDERS);

exports.celebrityList = z.object({
  ...pagination,
  category: z.string().trim().max(80).optional(), // slug or id
  state: stateCode.optional(),
  gender: gender.optional(),
  q: search,
  sort: z.enum(['name', 'newest']).default('name'),
});
exports.rankings = z.object({
  campaign: z.string().trim().regex(/^(current|\d{4}-\d{2})$/).default('current'),
  category: z.string().trim().min(1).max(80),
  scope: z.enum(['national', 'state']).default('national'),
  state: stateCode.optional(),
  gender: gender.optional(), // omitted = everyone in the category
});
exports.winners = z.object({ campaign: z.string().trim().regex(/^\d{4}-\d{2}$/).optional() });
exports.vote = z.object({ categoryId: objectId, celebrityId: objectId, amountInr: z.number().int().min(0).max(7).optional() });
exports.eligibility = z.object({ categoryId: objectId });
exports.verifyPayment = z.object({
  razorpay_order_id: z.string().min(5).max(64),
  razorpay_payment_id: z.string().min(5).max(64),
  razorpay_signature: z.string().min(10).max(200),
});
exports.nomination = z.object({
  name: z.string().trim().min(2).max(120),
  categoryId: objectId,
  state: stateCode.optional(),
  gender,
  reason: z.string().trim().max(300).default(''), // optional: one line on why they deserve a place
  links: z.array(z.string().url().max(300)).max(5).default([]), // kept for older clients; the form no longer asks for it
});
exports.receiptVerify = z.object({ receiptNo: z.string().trim().min(8).max(40), ref: z.string().trim().min(8).max(64) });
exports.favorite = z.object({ celebrityId: objectId });
