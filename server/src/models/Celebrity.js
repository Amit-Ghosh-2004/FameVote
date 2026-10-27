const mongoose = require('mongoose');
const { STATE_CODES } = require('../utils/states');
const { GENDERS } = require('../utils/gender');
const { randomToken } = require('../utils/crypto');

const celebritySchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true }, // public celebrity ID, e.g. CEL-7F3A9C
    name: { type: String, required: true, trim: true, maxlength: 120 },
    nameNormalized: { type: String, index: true }, // for duplicate detection
    slug: { type: String, required: true, unique: true, lowercase: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    gender: { type: String, enum: GENDERS, default: 'other', index: true }, // subcategory inside the category; records from before subcategories read as 'other'
    bio: { type: String, trim: true, maxlength: 2000, default: '' },
    image: { url: String, publicId: String, credit: String, source: String, license: String, attribution: String }, // credit = source page of the photo
    seeded: { type: Boolean, default: false }, // true = created by the seed script (sample lineup), never by a user or admin
    // Celebrity's own home state/region (display only; rankings use the voter's state)
    state: { type: String, enum: [...STATE_CODES, null], default: null },
    region: { type: String, trim: true, maxlength: 80 },
    socialLinks: { type: Map, of: String },
    // ADMIN ONLY: social-media profile used to verify identity. Never returned by any public endpoint.
    socialUrl: { type: String, trim: true, maxlength: 300 },
    status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active', index: true },
    aiDrafted: { type: Boolean, default: false },
    aiApproved: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

celebritySchema.index({ categoryId: 1, status: 1 });
celebritySchema.index({ categoryId: 1, gender: 1, status: 1 });

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

celebritySchema.pre('validate', function (next) {
  if (!this.code) this.code = `CEL-${randomToken(4).toUpperCase()}`;
  if (this.isModified('name') || !this.nameNormalized) this.nameNormalized = normalize(this.name);
  next();
});

module.exports = mongoose.model('Celebrity', celebritySchema);
module.exports.normalizeName = normalize;
