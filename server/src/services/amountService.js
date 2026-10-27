const ApiError = require('../utils/ApiError');

const MIN_INR = 0;
const MAX_INR = 7;

/**
 * The transaction amount for one vote, in whole rupees. The server is the only authority:
 * - custom amounts ON : the voter may pick any whole rupee 0..7 (defaults to the admin's amount);
 * - custom amounts OFF: the admin's amount is used and any different request is rejected.
 * An amount never changes how a vote counts: one vote per user, per category, per campaign.
 */
function resolveAmountInr(settings, requested) {
  const base = settings.voteAmountInr;
  if (!Number.isInteger(base) || base < MIN_INR || base > MAX_INR) throw ApiError.unavailable('Voting amount is misconfigured', 'AMOUNT_INVALID');
  if (requested === undefined || requested === null) return base;
  if (!Number.isInteger(requested) || requested < MIN_INR || requested > MAX_INR) throw ApiError.unprocessable(`Amount must be a whole number from ₹${MIN_INR} to ₹${MAX_INR}`, 'AMOUNT_INVALID');
  if (settings.allowCustomAmount === false && requested !== base) throw ApiError.unprocessable('Custom amounts are turned off right now', 'CUSTOM_AMOUNT_DISABLED');
  return requested;
}

module.exports = { resolveAmountInr, MIN_INR, MAX_INR };
