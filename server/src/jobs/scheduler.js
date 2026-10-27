const cron = require('node-cron');
const env = require('../config/env');
const { Campaign } = require('../models');
const { ensureCampaigns, syncStatuses } = require('../services/campaignService');
const { finalizeCampaign } = require('../services/rankingService');
const reconcile = require('../services/reconcileService');

let task = null;
let running = false;

/**
 * One scheduler pass. EVERY step is idempotent and uses atomic claims, so it is safe to:
 *  - run on several instances at once,
 *  - run again after a restart (startup recovery calls it immediately),
 *  - run late (the clock, not the job, decides whether voting is open).
 */
async function tick(now = new Date()) {
  const out = {};
  await ensureCampaigns(now);
  out.status = await syncStatuses(now);

  // Clear finalization locks left behind by a crash (snapshots are idempotent, so a retry is safe).
  const stuck = await Campaign.updateMany({ finalizing: true, finalizingAt: { $lt: new Date(now.getTime() - 10 * 60_000) } }, { $set: { finalizing: false } });
  out.unlocked = stuck.modifiedCount;

  out.reconcile = await reconcile.runAll(now);

  if (env.AUTO_FINALIZE_AFTER_HOURS > 0) {
    const cutoff = new Date(now.getTime() - env.AUTO_FINALIZE_AFTER_HOURS * 3600_000);
    const due = await Campaign.find({ status: 'closed', endsAt: { $lt: cutoff }, finalizing: { $ne: true } });
    out.finalized = [];
    for (const c of due) {
      try {
        await finalizeCampaign(c._id, { now, graceMinutes: env.FINALIZE_GRACE_MINUTES });
        out.finalized.push(c.key);
        // Results day: winners go live as soon as the month is finalized (admins can still correct with an audited revision).
        if (env.AUTO_PUBLISH_RESULTS) await Campaign.updateOne({ key: c.key, status: 'finalized', published: { $ne: true } }, { $set: { published: true, publishedAt: now } });
      } catch (e) {
        if (!['ALREADY_FINALIZED', 'FINALIZING', 'PENDING_PAYMENTS'].includes(e.code)) console.error('[scheduler] auto-finalize failed', c.key, e.message);
      }
    }
  }
  return out;
}

async function safeTick() {
  if (running) return;
  running = true;
  try { await tick(); } catch (e) { console.error('[scheduler] tick failed', e); } finally { running = false; }
}

async function start() {
  await safeTick(); // startup recovery
  task = cron.schedule('* * * * *', safeTick, { timezone: env.CAMPAIGN_TIMEZONE });
  console.log('[scheduler] started (every minute, recovery on boot)');
}

function stop() { if (task) task.stop(); }

module.exports = { start, stop, tick };
