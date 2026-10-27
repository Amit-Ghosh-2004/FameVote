const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^[a-z0-9-]+$/ },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    icon: { type: String, trim: true, maxlength: 40, default: 'star' }, // lucide icon name
    image: { url: String, publicId: String },
    displayOrder: { type: Number, default: 0, index: true },
    status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active', index: true },
    // Display / eligibility rules configurable by admins
    rules: {
      showOnHome: { type: Boolean, default: true },
      allowNominations: { type: Boolean, default: true },
    },
    // Set the first time any vote is recorded in this category; blocks hard deletion.
    hasHistoricalData: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Category', categorySchema);
