const env = require('../config/env');
const { Campaign, Settings } = require('../models');
const ApiError = require('../utils/ApiError');
const { istParts, campaignKey, nextMonth, campaignWindow, monthLabel } = require('../utils/time');

/**
 * Effective status is derived from the SERVER clock + the stored window, so vote acceptance
 * is correct even if the scheduler has not run (restart, outage). The persisted `status`
 * is kept in sync by syncStatuses() for querying/UX, and only 'finalized' is authoritative
 * from storage.
 */
function effectiveStatus(campaign, now = new Date()) {
  if (campaign.status === 'finalized') return 'finalized';
  if (now < campaign.startsAt) return 'upcoming';
  if (now <= campaign.endsAt) return 'active';
  return 'closed';
}

async function currentCutoff() {
  const s = await Settings.get();
  return s.cutoffTime || env.CAMPAIGN_CUTOFF_TIME;
}

/** Idempotent: safe to call from many instances / repeatedly. */
async function ensureCampaign(year, month) {
  const key = campaignKey(year, month);
  const existing = await Campaign.findOne({ key });
  const cutoffTime = await currentCutoff();
  const { startsAt, endsAt } = campaignWindow(year, month, cutoffTime);
  if (existing) {
    // Campaigns created under an older schedule (voting until the last day) are moved to the current rule:
    // voting ends on the second-last day, the last day is results day. Finalized campaigns are history and never change.
    if (existing.status !== 'finalized' && (existing.endsAt.getTime() !== endsAt.getTime() || existing.startsAt.getTime() !== startsAt.getTime())) {
      return Campaign.findOneAndUpdate({ _id: existing._id, status: { $ne: 'finalized' } }, { $set: { startsAt, endsAt, cutoffTime } }, { new: true });
    }
    return existing;
  }
  try {
    return await Campaign.findOneAndUpdate(
      { key },
      {
        $setOnInsert: {
          key, year, month, startsAt, endsAt, cutoffTime,
          title: `${monthLabel(year, month)} Campaign`,
          description: `Vote for your favourite celebrities in ${monthLabel(year, month)}.`,
          status: 'upcoming',
        },
      },
      { upsert: true, new: true }
    );
  } catch (e) {
    if (e.code === 11000) return Campaign.findOne({ key }); // lost the creation race
    throw e;
  }
}

/** Makes sure the current and next IST-month campaigns exist. */
async function ensureCampaigns(now = new Date()) {
  const { year, month } = istParts(now);
  const next = nextMonth(year, month);
  const [current, upcoming] = await Promise.all([ensureCampaign(year, month), ensureCampaign(next.year, next.month)]);
  return { current, upcoming };
}

/** Persist status transitions implied by the clock. Idempotent bulk updates. */
async function syncStatuses(now = new Date()) {
  const opened = await Campaign.updateMany({ status: 'upcoming', startsAt: { $lte: now }, endsAt: { $gte: now } }, { $set: { status: 'active' } });
  const closed = await Campaign.updateMany({ status: { $in: ['upcoming', 'active'] }, endsAt: { $lt: now } }, { $set: { status: 'closed' } });
  return { opened: opened.modifiedCount, closed: closed.modifiedCount };
}

async function getCurrentCampaign(now = new Date()) {
  const { current } = await ensureCampaigns(now);
  return current;
}

function assertVotingOpen(campaign, at = new Date()) {
  const st = effectiveStatus(campaign, at);
  if (st === 'active') return;
  const map = {
    upcoming: ['CAMPAIGN_NOT_STARTED', 'Voting for this campaign has not started yet'],
    closed: ['CAMPAIGN_CLOSED', 'Voting for this campaign has closed'],
    finalized: ['CAMPAIGN_CLOSED', 'This campaign has been finalized'],
  };
  const [code, msg] = map[st];
  throw ApiError.conflict(msg, code, { status: st, startsAt: campaign.startsAt, endsAt: campaign.endsAt });
}

const publicCampaign = (c, now = new Date()) => ({
  id: c._id, key: c.key, title: c.title, description: c.description, year: c.year, month: c.month,
  startsAt: c.startsAt, endsAt: c.endsAt, status: effectiveStatus(c, now), finalized: c.status === 'finalized',
  published: c.published, finalizedAt: c.finalizedAt, serverTime: now,
});

module.exports = {
  effectiveStatus, ensureCampaign, ensureCampaigns, syncStatuses, getCurrentCampaign, assertVotingOpen, publicCampaign, currentCutoff,
};
