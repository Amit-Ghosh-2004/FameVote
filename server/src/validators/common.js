const { z } = require('zod');
const { STATE_CODES } = require('../utils/states');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const stateCode = z.enum(STATE_CODES);
const pagination = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
const idParam = z.object({ id: objectId });
const search = z.string().trim().max(80).optional();

const slugify = (s) => s.toLowerCase().trim().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

module.exports = { z, objectId, stateCode, pagination, idParam, search, slugify };
