const { z, objectId, stateCode, pagination, slugify } = require('./common');

const { GENDERS } = require('../utils/gender');
const socialUrl = z.string().trim().url().max(300).refine((u) => /^https?:\/\//i.test(u), 'Use a full http(s) link');
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(80);

exports.category = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slug.optional(),
  description: z.string().trim().max(500).default(''),
  icon: z.string().trim().max(40).default('star'),
  status: z.enum(['active', 'inactive']).default('active'),
  displayOrder: z.number().int().min(0).max(1000).optional(),
  rules: z.object({ showOnHome: z.boolean().optional(), allowNominations: z.boolean().optional() }).optional(),
});
exports.categoryUpdate = exports.category.partial().extend({ status: z.enum(['active', 'inactive', 'archived']).optional() });
exports.reorder = z.object({ order: z.array(objectId).min(1).max(100) });

exports.celebrity = z.object({
  name: z.string().trim().min(2).max(120),
  categoryId: objectId,
  gender: z.enum(GENDERS).default('other'),
  bio: z.string().trim().max(2000).default(''),
  socialUrl: z.preprocess((v) => (v === '' ? undefined : v), socialUrl.optional()), // admin only, never public
  state: stateCode.nullable().optional(),
  region: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'inactive']).default('active'),
  aiDrafted: z.boolean().optional(), // the admin reviewed and submitted an AI draft
  force: z.boolean().optional(), // acknowledge possible duplicates
});
exports.celebrityUpdate = exports.celebrity.partial().extend({ gender: z.enum(GENDERS).optional(), socialUrl: z.preprocess((v) => (v === '' ? null : v), socialUrl.nullable().optional()) })
  .extend({ status: z.enum(['active', 'inactive', 'archived']).optional() });
exports.celebrityList = z.object({ ...pagination, q: z.string().trim().max(80).optional(), category: objectId.optional(), gender: z.enum(GENDERS).optional(), status: z.enum(['active', 'inactive', 'archived']).optional() });

exports.campaignUpdate = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(500).optional(),
});
exports.finalize = z.object({ force: z.boolean().optional() });
exports.correction = z.object({ categoryId: objectId, reason: z.string().trim().min(10).max(500) });

exports.settings = z.object({ voteAmountInr: z.number().int().min(0).max(7).optional(), allowCustomAmount: z.boolean().optional(), cutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/).optional() });
exports.announcement = z.object({ message: z.string().trim().min(5).max(300) });
exports.banner = z.object({ title: z.string().trim().min(2).max(100), subtitle: z.string().trim().max(200).optional(), link: z.string().trim().max(300).optional() });
exports.broadcast = z.object({ title: z.string().trim().min(3).max(140), body: z.string().trim().max(600).default(''), type: z.enum(['campaign', 'announcement']).default('announcement') });

exports.userList = z.object({ ...pagination, q: z.string().trim().max(80).optional(), role: z.enum(['user', 'moderator', 'admin', 'superadmin']).optional(), status: z.enum(['active', 'suspended']).optional() });
exports.suspend = z.object({ reason: z.string().trim().min(5).max(500) });
exports.roleChange = z.object({ role: z.enum(['user', 'moderator', 'admin']) });
exports.createAdmin = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email(), password: z.string().min(10).max(128), role: z.enum(['moderator', 'admin']) });

exports.paymentList = z.object({
  ...pagination,
  status: z.string().trim().max(40).optional(), campaign: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  minInr: z.coerce.number().min(0).max(7).optional(), maxInr: z.coerce.number().min(0).max(7).optional(),
});
exports.refund = z.object({ reason: z.string().trim().min(5).max(300) });
exports.disqualify = z.object({ reason: z.string().trim().min(10).max(500) });
// Admins can add a nomination themselves: same short form as the public one plus the private social link.
exports.nominationCreate = z.object({
  name: z.string().trim().min(2).max(120), categoryId: objectId, gender: z.enum(GENDERS), state: stateCode.optional(),
  reason: z.string().trim().max(300).default(''), socialUrl: z.preprocess((v) => (v === '' ? undefined : v), socialUrl.optional()),
});
exports.nominationReview = z.object({ decision: z.enum(['approve', 'reject', 'duplicate']), note: z.string().trim().max(500).optional(), celebrityId: objectId.optional() });
exports.nominationList = z.object({ ...pagination, status: z.enum(['pending', 'approved', 'rejected', 'duplicate']).optional() });
exports.auditList = z.object({ ...pagination, action: z.string().trim().max(60).optional() });
exports.reportType = z.object({ type: z.enum(['votes', 'payments', 'rankings', 'audit']), campaign: z.string().regex(/^\d{4}-\d{2}$/).optional() });

exports.ai = {
  autocomplete: z.object({ query: z.string().trim().min(2).max(80) }),
  biography: z.object({ name: z.string().trim().min(2).max(120), category: z.string().trim().max(80).optional(), facts: z.string().trim().max(1200).optional() }),
  category: z.object({ name: z.string().trim().min(2).max(120), details: z.string().trim().max(800).default('') }),
  nomination: z.object({ nominationId: objectId }),
  duplicates: z.object({ name: z.string().trim().min(2).max(120) }),
  seo: z.object({ name: z.string().trim().min(2).max(120), category: z.string().trim().max(80).optional(), bio: z.string().trim().max(600).optional() }),
  announcement: z.object({ kind: z.enum(['opening', 'closing', 'results']), campaignTitle: z.string().trim().max(120).optional(), notes: z.string().trim().max(400).optional() }),
  nlSearch: z.object({ query: z.string().trim().min(3).max(200) }),
  faq: z.object({ question: z.string().trim().min(3).max(200) }),
};
exports.slugify = slugify;
