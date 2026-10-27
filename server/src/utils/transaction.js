const mongoose = require('mongoose');

let supportsTransactions = null;

async function detectTransactions() {
  if (supportsTransactions !== null) return supportsTransactions;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    supportsTransactions = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    supportsTransactions = false;
  }
  return supportsTransactions;
}

/**
 * Runs fn(session) inside a multi-document transaction when the deployment supports it
 * (MongoDB Atlas always does). Otherwise runs fn(null): callers must then rely on unique
 * indexes + the reconciliation job (see services/reconcileService.js) for consistency.
 */
async function withTransaction(fn) {
  if (!(await detectTransactions())) return fn(null);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { withTransaction, detectTransactions };
