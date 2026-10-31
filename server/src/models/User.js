const mongoose = require('mongoose');
const { STATE_CODES } = require('../utils/states');
const { isPlaceholderEmail, maskPhone } = require('../utils/phone');

const ROLES = ['user', 'moderator', 'admin', 'superadmin'];

const imageSchema = new mongoose.Schema({ url: String, publicId: String }, { _id: false });

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    // Absent for accounts that only ever signed in with Google.
    passwordHash: { type: String, select: false },
    // E.164, e.g. +919876543210. Present only for accounts that signed in with a verified one-time code.
    phone: { type: String, unique: true, sparse: true, select: false },
    googleId: { type: String, unique: true, sparse: true, select: false },
    authProviders: { type: [String], default: ['password'] },
    role: { type: String, enum: ROLES, default: 'user', index: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    suspensionReason: { type: String, maxlength: 500 },
    // Email verification emails are disabled; account access is protected by password/Google authentication.
    emailVerified: { type: Boolean, default: true },
    verifyTokenHash: { type: String, select: false },
    verifyTokenExpires: { type: Date, select: false },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    // Voter's region. Snapshotted onto every Vote, so later changes never affect past rankings.
    state: { type: String, enum: [...STATE_CODES, null], default: null },
    // Required for adult-only paid voting; absent/invalid DOB fails closed at checkout.
    dateOfBirth: { type: Date, default: null },
    avatar: imageSchema,
    failedLogins: { type: Number, default: 0 },
    lockUntil: { type: Date },
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: Date,
    abuseReports: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    name: this.name,
    email: isPlaceholderEmail(this.email) ? null : this.email,
    phone: this.phone ? maskPhone(this.phone) : null,
    role: this.role,
    emailVerified: this.emailVerified,
    state: this.state,
    avatar: this.avatar?.url ? { url: this.avatar.url } : null,
    status: this.status,
    hasPassword: this.authProviders?.includes('password') ?? true,
    hasPhone: this.authProviders?.includes('phone') ?? false,
    hasGoogle: this.authProviders?.includes('google') ?? false,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
