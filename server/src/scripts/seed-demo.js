
/**
 * FameVote sample-data seed.
 *
 * Creates a finalized September campaign and an open October campaign.
 *
 * Commands:
 *   npm run seed:demo
 *   npm run seed:demo -- --rebuild
 *   npm run seed:demo -- --voters=600
 *   npm run seed:demo:purge
 *
 * Demo users are identified by authProviders: ['demo'] and
 * email addresses ending in @demo.famevote.test.
 *
 * Back up your database before running seed or purge commands.
 */

require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');

const { connectDB } = require('../config/db');

const {
  User,
  Category,
  Celebrity,
  Campaign,
  Vote,
  Payment,
  Receipt,
  Favorite,
  Nomination,
  Notification,
  RankingSnapshot
} = require('../models');

const {
  campaignWindow,
  monthLabel,
  istParts
} = require('../utils/time');

const { STATE_CODES, stateName } = require('../utils/states');

const {
  randomToken,
  receiptVerificationRef,
  maskEmail
} = require('../utils/crypto');

const { finalizeCampaign } = require('../services/rankingService');
const { slotKey } = require('../services/voteService');
const { ensureCampaigns } = require('../services/campaignService');

const {
  buildVoters,
  planVotes,
  DEMO_PROVIDER,
  DEMO_DOMAIN,
  rng
} = require('../services/demoPlan');

const CELEBRITIES = require('../data/celebrities');

const arg = (name) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1];

const flag = (name) => process.argv.includes(`--${name}`);

const VOTERS = Math.max(
  20,
  Math.min(5000, Number(arg('voters')) || 60)
);

const oid = () => new mongoose.Types.ObjectId();

const chunks = (arr, n = 500) =>
  Array.from(
    { length: Math.ceil(arr.length / n) },
    (_, i) => arr.slice(i * n, (i + 1) * n)
  );

async function insertAll(Model, docs) {
  for (const part of chunks(docs)) {
    if (part.length) {
      await Model.insertMany(part, { ordered: true });
    }
  }
}

function demoEmailRegex() {
  const escapedDomain = DEMO_DOMAIN.replace(/\./g, '\\.');
  return new RegExp(`@${escapedDomain}$`, 'i');
}

function demoUserQuery() {
  return {
    authProviders: DEMO_PROVIDER,
    email: demoEmailRegex()
  };
}

/* ------------------------------ purge ------------------------------ */

async function purge() {
  const demoUsers = await User.find(demoUserQuery()).select('_id');
  const ids = demoUsers.map((user) => user._id);

  if (!ids.length) {
    console.log('[PURGE] No sample accounts found.');
    return { users: 0 };
  }

  // Before touching snapshots, refuse to modify a finalized campaign
  // if it also contains votes from non-demo users.
  const touchedCampaignIds = await Vote.distinct('campaignId', {
    userId: { $in: ids }
  });

  for (const campaignId of touchedCampaignIds) {
    const campaign = await Campaign.findById(campaignId);

    if (campaign?.status !== 'finalized') continue;

    const realVotes = await Vote.countDocuments({
      campaignId,
      userId: { $nin: ids }
    });

    if (realVotes > 0) {
      throw new Error(
        `${campaign.key} is finalized and contains non-demo votes. ` +
        'Refusing to remove its snapshots. Nothing has been deleted.'
      );
    }
  }

  // Remove snapshots only for finalized campaigns that contain no
  // non-demo votes. Reopen these campaigns so they can be finalized again.
  for (const campaignId of touchedCampaignIds) {
    const campaign = await Campaign.findById(campaignId);

    if (campaign?.status !== 'finalized') continue;

    await RankingSnapshot.collection.deleteMany({ campaignId });

    await Campaign.updateOne(
      { _id: campaignId },
      {
        $set: {
          status: 'closed',
          published: false
        },
        $unset: {
          finalizedAt: 1,
          finalizedBy: 1,
          publishedAt: 1
        }
      }
    );
  }

  const receipts = await Receipt.deleteMany({
    userId: { $in: ids }
  });

  const votes = await Vote.deleteMany({
    userId: { $in: ids }
  });

  const payments = await Payment.deleteMany({
    userId: { $in: ids }
  });

  await Favorite.deleteMany({
    userId: { $in: ids }
  });

  await Nomination.deleteMany({
    nominatedBy: { $in: ids }
  });

  await Notification.deleteMany({
    userId: { $in: ids }
  });

  await User.deleteMany({
    _id: { $in: ids }
  });

  try {
    require('../services/rankingService').cache?.clear?.();
  } catch {
    // The ranking cache may not be exposed in every configuration.
  }

  console.log(
    `[PURGE] Removed ${ids.length} sample users, ` +
    `${votes.deletedCount} votes, ` +
    `${payments.deletedCount} payments, ` +
    `${receipts.deletedCount} receipts.`
  );

  return { users: ids.length };
}

/* ------------------------------ campaigns ------------------------------ */

async function ensureCampaign(year, month, live) {
  const { startsAt, endsAt } = campaignWindow(year, month);
  const key = `${year}-${String(month).padStart(2, '0')}`;

  let campaign = await Campaign.findOne({ key });

  if (!campaign) {
    campaign = await Campaign.create({
      key,
      year,
      month,
      title: `${monthLabel(year, month)} Campaign`,
      description: '',
      startsAt,
      endsAt,
      status: live ? 'active' : 'closed',
      published: false
    });
  } else {
    // Remove wording left by older versions of the demo seed.
    const patch = {};

    if (/demo results/i.test(campaign.title || '')) {
      patch.title = `${monthLabel(year, month)} Campaign`;
    }

    if (/SYNTHETIC DEMO DATA/.test(campaign.description || '')) {
      patch.description = '';
    }

    if (Object.keys(patch).length) {
      Object.assign(campaign, patch);
      await campaign.save();
    }
  }

  return campaign;
}

/* ------------------------------ seed ------------------------------ */

async function main() {
  await connectDB();

  if (flag('purge')) {
    await purge();
    return;
  }

  if (flag('rebuild')) {
    await purge();
  } else {
    const existingDemoUsers = await User.find(demoUserQuery()).select('_id');
    const existingCount = existingDemoUsers.length;

    if (existingCount > 0) {
      if (
        existingCount >= VOTERS * 0.9 &&
        existingCount <= VOTERS * 1.1
      ) {
        console.log(
          `[SKIP] ${existingCount} sample voters already exist. ` +
          'Use --rebuild to regenerate the sample data.'
        );
        return;
      }

      console.log(
        `[INFO] Found ${existingCount} sample voters; ${VOTERS} requested. ` +
        'Rebuilding the sample dataset.'
      );

      await purge();
    }
  }

  await ensureCampaigns();

  const now = new Date();
  const { year } = istParts(now);

  const categories = await Category.find({
    status: { $ne: 'archived' }
  }).sort({ displayOrder: 1 });

  if (!categories.length) {
    throw new Error(
      'No categories found. Run `npm run seed` (core setup) first.'
    );
  }

  const planCategories = [];

  for (const category of categories) {
    const celebrities = await Celebrity.find({
      categoryId: category._id,
      status: 'active'
    }).sort({ createdAt: 1, name: 1 });

    // Use the configured lineup to keep popularity ordering stable.
    const lineup = (CELEBRITIES[category.slug] || []).map(
      (entry) => entry[0]
    );

    planCategories.push({
      cat: category,
      celebs: celebrities.map((celebrity) => ({
        id: String(celebrity._id),
        doc: celebrity,
        state: celebrity.state || null,
        order: Math.max(
          0,
          lineup.indexOf(celebrity.name) === -1
            ? lineup.length
            : lineup.indexOf(celebrity.name)
        )
      }))
    });
  }

  const septemberWindow = campaignWindow(year, 9);
  const octoberWindow = campaignWindow(year, 10);

  const firstJoin = new Date(
    septemberWindow.startsAt.getTime() - 20 * 864e5
  );

  const lastJoin = new Date(
    Math.min(
      now.getTime() - 3600e3,
      octoberWindow.endsAt.getTime()
    )
  );

  const voters = buildVoters({
    count: VOTERS,
    stateCodes: STATE_CODES,
    firstJoin,
    lastJoin
  });

  const users = voters.map((voter) => ({
    _id: oid(),
    name: voter.name,
    email: voter.email,
    state: voter.state,
    emailVerified: true,
    authProviders: [DEMO_PROVIDER],
    createdAt: voter.joinedAt,
    updatedAt: voter.joinedAt,
    lastLoginAt: new Date(
      Math.min(
        now.getTime(),
        voter.joinedAt.getTime() + 3 * 864e5
      )
    )
  }));

  await insertAll(User, users);

  console.log(
    `[USERS] Created ${users.length} sample voters across ` +
    `${new Set(users.map((user) => user.state)).size} states/UTs.`
  );

  const totals = {
    votes: 0,
    payments: 0,
    receipts: 0
  };

  for (const [month, live] of [
    [9, false],
    [10, true]
  ]) {
    const campaign = await ensureCampaign(year, month, live);

    if (campaign.status === 'finalized') {
      console.log(
        `[SKIP] ${campaign.key} is already finalized; not adding votes.`
      );
      continue;
    }

    const plan = planVotes({
      campaignKey: campaign.key,
      voters,
      categories: planCategories.map(({ cat, celebs }) => ({
        slug: cat.slug,
        celebs
      })),
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      now
    });

    const categoryBySlug = new Map(
      planCategories.map((entry) => [entry.cat.slug, entry])
    );

    const celebrityById = new Map(
      planCategories.flatMap((entry) =>
        entry.celebs.map((celebrity) => [
          celebrity.id,
          celebrity.doc
        ])
      )
    );

    const yearMonth =
      `${campaign.year}${String(campaign.month).padStart(2, '0')}`;

    const usedReceiptNumbers = new Set();
    const payments = [];
    const votes = [];
    const receipts = [];

    for (const plannedVote of plan) {
      const user = users[plannedVote.voterIdx];
      const categoryEntry = categoryBySlug.get(
        plannedVote.categorySlug
      );

      const celebrity = celebrityById.get(
        plannedVote.celebrityId
      );

      if (!user || !categoryEntry || !celebrity) {
        throw new Error(
          `Invalid demo vote plan for category "${plannedVote.categorySlug}".`
        );
      }

      const category = categoryEntry.cat;

      const paymentId = oid();
      const voteId = oid();
      const receiptId = oid();

      /*
       * FIX: the Payment model has a unique compound index on
       * { userId, idempotencyKey }. Never leave idempotencyKey null.
       *
       * This key is deterministic for a demo user's campaign/category
       * operation and distinct across categories and campaigns.
       */
      const idempotencyKey = [
        'demo',
        campaign.key,
        String(user._id),
        String(category._id)
      ].join(':');

      let receiptNo;

      do {
        receiptNo =
          `FV-${yearMonth}-${randomToken(4).toUpperCase()}`;
      } while (usedReceiptNumbers.has(receiptNo));

      usedReceiptNumbers.add(receiptNo);

      payments.push({
        _id: paymentId,
        userId: user._id,
        campaignId: campaign._id,
        categoryId: category._id,
        celebrityId: celebrity._id,
        state: user.state,
        amountPaise: 0,
        currency: 'INR',
        method: 'free',
        status: 'paid',
        paidAt: plannedVote.at,

        // Required for the unique userId/idempotencyKey index.
        idempotencyKey,

        activeKey: slotKey(
          user._id,
          campaign._id,
          category._id
        ),

        voteId,
        receiptId,
        createdAt: plannedVote.at,
        updatedAt: plannedVote.at
      });

      votes.push({
        _id: voteId,
        userId: user._id,
        campaignId: campaign._id,
        categoryId: category._id,
        celebrityId: celebrity._id,
        state: user.state,
        paymentId,
        receiptId,
        status: 'confirmed',
        createdAt: plannedVote.at,
        updatedAt: plannedVote.at
      });

      receipts.push({
        _id: receiptId,
        receiptNo,
        verificationRef: receiptVerificationRef({
          receiptNo,
          voteId,
          userId: user._id,
          celebrityId: celebrity._id
        }),
        userId: user._id,
        voteId,
        paymentId,
        campaignId: campaign._id,
        issuedAt: plannedVote.at,
        createdAt: plannedVote.at,
        updatedAt: plannedVote.at,

        snapshot: {
          userName: user.name,
          userMasked: maskEmail(user.email),
          celebrityId: celebrity._id,
          celebrityCode: celebrity.code,
          celebrityName: celebrity.name,
          categoryId: category._id,
          categoryName: category.name,
          campaignLabel: monthLabel(
            campaign.year,
            campaign.month
          ),
          state: user.state,
          stateName: stateName(user.state),
          amountPaise: 0,
          currency: 'INR',
          transactionStatus: 'completed',
          paymentMethod: 'free'
        }
      });
    }

    await insertAll(Payment, payments);
    await insertAll(Vote, votes);
    await insertAll(Receipt, receipts);

    totals.votes += votes.length;
    totals.payments += payments.length;
    totals.receipts += receipts.length;

    console.log(
      `[CAMPAIGN] ${campaign.key}: ${votes.length} votes from ` +
      `${new Set(plan.map((entry) => entry.voterIdx)).size} voters.`
    );

    if (live) {
      campaign.status = 'active';
      campaign.published = false;
      await campaign.save();
    } else {
      if (campaign.status !== 'closed') {
        campaign.status = 'closed';
        await campaign.save();
      }

      await finalizeCampaign(campaign._id, {
        force: true,
        now
      });

      const finalizedCampaign = await Campaign.findById(
        campaign._id
      );

      if (!finalizedCampaign) {
        throw new Error(
          `Campaign ${campaign.key} disappeared during finalization.`
        );
      }

      finalizedCampaign.published = true;
      finalizedCampaign.publishedAt = new Date(
        campaign.endsAt.getTime() + 36e5
      );

      await finalizedCampaign.save();

      console.log(
        `[CAMPAIGN] ${campaign.key}: finalized through the real ` +
        'finalization service and published.'
      );
    }
  }

  /* Favourites for the sample dashboard and celebrity pages. */

  const random = rng(99);
  const favourites = [];
  const seenFavourites = new Set();

  const everyCelebrity = planCategories.flatMap(
    (entry) => entry.celebs
  );

  users.forEach((user) => {
    if (!everyCelebrity.length || random() > 0.35) {
      return;
    }

    const favouriteCount = 1 + Math.floor(random() * 3);

    for (let index = 0; index < favouriteCount; index += 1) {
      const celebrity =
        everyCelebrity[
          Math.floor(random() * everyCelebrity.length)
        ];

      const key = `${user._id}:${celebrity.id}`;

      if (seenFavourites.has(key)) continue;

      seenFavourites.add(key);

      favourites.push({
        userId: user._id,
        celebrityId: celebrity.doc._id,
        createdAt: new Date(
          now.getTime() - random() * 20 * 864e5
        )
      });
    }
  });

  await insertAll(Favorite, favourites);

  /* Sample nominations for the admin review queue. */

  const nominees = [
    [
      'Ranveer Singh Sandhu',
      'actors',
      'Popular on stage and in short films across Punjab, and deserves a place in the lineup.'
    ],
    [
      'Pallavi Rao',
      'singers-musicians',
      'Independent singer with a large regional following and several chart appearances.'
    ],
    [
      'Kunal Deshpande',
      'influencers-content-creators',
      'Creates explainers about Indian history that reach millions each month.'
    ],
    [
      'Mitali Das',
      'athletes-sports-personalities',
      'Rising national-level athlete who has represented the country in recent championships.'
    ],
    [
      'Arvind Nambiar',
      'comedians',
      'Stand-up comedian known for sharp observational sets in Malayalam and English.'
    ]
  ];

  const nominations = nominees.map(([name, slug, reason], index) => {
    const user = users[(index * 7) % users.length];

    return {
      nominatedBy: user._id,
      name,
      nameNormalized: name.toLowerCase(),
      categoryId:
        categories.find((category) => category.slug === slug)?._id ||
        categories[0]._id,
      state: user.state,
      reason,
      links: [],
      status: 'pending',
      createdAt: new Date(
        now.getTime() - (index + 1) * 36e5 * 9
      )
    };
  });

  await insertAll(Nomination, nominations);

  console.log(
    `\n[SUMMARY] ${users.length} sample voters, ` +
    `${totals.votes} votes, ${totals.payments} payments, ` +
    `${totals.receipts} receipts, ${favourites.length} favourites, ` +
    `${nominations.length} nominations.`
  );

  console.log(
    'September is finalized and published; October is open with ' +
    'provisional rankings. Remove sample data with: ' +
    'npm run seed:demo:purge'
  );
}

main()
  .catch((error) => {
    console.error('[SEED FAILED]', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
