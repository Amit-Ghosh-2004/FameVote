/**
 * In-memory cache for PUBLIC, non-personalised read data only (categories, meta, rankings, celebrity lists/profiles, winners).
 *
 * Never put anything per-user in here: voting eligibility, payments, receipts, sessions, favourites, notifications.
 *
 * Properties:
 *  - short TTL per call,
 *  - single-flight: concurrent misses for one key share ONE loader run (protects the database from stampedes),
 *  - tag invalidation with generation counters: a loader that started BEFORE an invalidation can never store its (stale)
 *    result afterwards, and callers arriving after an invalidation never join a pre-invalidation in-flight load,
 *  - bounded size (oldest entries are evicted first),
 *  - errors are never cached.
 *
 * It is per-process. With several instances an invalidation only reaches the instance that handled the write; the other
 * instances serve the old value for at most the entry's TTL (10 s for rankings). That bound is the documented trade-off.
 */
const crypto = require('crypto');

function createCache({ maxEntries = 500, now = Date.now } = {}) {
  const entries = new Map(); // key -> { val, exp, tags }
  const inflight = new Map(); // key -> { promise, tags }
  const tagKeys = new Map(); // tag -> Set(key)   (keys of stored entries AND in-flight loads)
  const generation = new Map(); // tag -> number
  const stats = { hits: 0, misses: 0, shared: 0, invalidations: 0 };
  let epoch = 0; // bumped by clear(): loads started before a clear never store

  const gen = (tag) => generation.get(tag) || 0;
  const link = (key, tags) => { for (const t of tags) { if (!tagKeys.has(t)) tagKeys.set(t, new Set()); tagKeys.get(t).add(key); } };
  const unlink = (key, tags) => { for (const t of tags) { const s = tagKeys.get(t); if (s) { s.delete(key); if (!s.size) tagKeys.delete(t); } } };
  const drop = (key) => { const e = entries.get(key); if (e) { entries.delete(key); unlink(key, e.tags); } };

  function set(key, val, ttlMs, tags) {
    drop(key);
    entries.set(key, { val, exp: now() + ttlMs, tags });
    link(key, tags);
    while (entries.size > maxEntries) drop(entries.keys().next().value); // Map iterates in insertion order = oldest first
  }

  /** get(key, ttlMs, loader, { tags }) -> value. ttlMs <= 0 bypasses the cache entirely. */
  async function get(key, ttlMs, loader, { tags = [] } = {}) {
    if (!(ttlMs > 0)) return loader();
    const hit = entries.get(key);
    if (hit) {
      if (hit.exp > now()) { stats.hits += 1; return hit.val; }
      drop(key);
    }
    const running = inflight.get(key);
    if (running) { stats.shared += 1; return running.promise; }

    stats.misses += 1;
    const startedAt = new Map(tags.map((t) => [t, gen(t)]));
    const startEpoch = epoch;
    const promise = (async () => {
      try {
        const val = await loader();
        if (epoch === startEpoch && tags.every((t) => gen(t) === startedAt.get(t))) set(key, val, ttlMs, tags); // not invalidated while loading
        return val;
      } finally {
        const cur = inflight.get(key);
        if (cur && cur.promise === promise) { inflight.delete(key); if (!entries.has(key)) unlink(key, tags); }
      }
    })();
    inflight.set(key, { promise, tags });
    link(key, tags);
    return promise;
  }

  /** Invalidate every entry carrying ANY of the given tags (and detach in-flight loads so their result is not stored). */
  function invalidate(...tags) {
    for (const tag of tags.flat()) {
      stats.invalidations += 1;
      generation.set(tag, gen(tag) + 1);
      for (const key of [...(tagKeys.get(tag) || [])]) {
        drop(key);
        const f = inflight.get(key);
        if (f) { inflight.delete(key); unlink(key, f.tags); }
      }
    }
  }

  function clear() {
    entries.clear(); inflight.clear(); tagKeys.clear();
    epoch += 1; // loads that are still running cannot repopulate with pre-clear data
  }

  return { get, invalidate, clear, size: () => entries.size, stats: () => ({ ...stats, size: entries.size }) };
}

/* ------------------------------ Shared instance + tag vocabulary ------------------------------ */

const cache = createCache({ maxEntries: 500 });

const TAGS = {
  rankings: 'rankings', // every ranking-derived value (home, category boards, celebrity standing)
  ranking: (categoryId) => `rankings:${categoryId}`, // one category's board
  catalog: 'catalog', // categories, celebrity lists + profiles
  meta: 'meta', // settings, banners, announcements, campaigns
  winners: 'winners', // finalized/published results
};

/** A vote was confirmed / disqualified in this category: its boards, the home page and standings change. */
const invalidateRankings = (categoryId) => cache.invalidate(TAGS.rankings, ...(categoryId ? [TAGS.ranking(categoryId)] : []));
/** Admin edits to categories / celebrities. Standings embed celebrity data, so rankings go too. */
const invalidateCatalog = () => cache.invalidate(TAGS.catalog, TAGS.rankings);
/** Settings, banners, announcements, campaign windows/status. */
const invalidateMeta = () => cache.invalidate(TAGS.meta);
/** Campaign finalized / published / corrected. */
const invalidateResults = () => cache.invalidate(TAGS.winners, TAGS.rankings, TAGS.meta);
const invalidateAll = () => cache.clear();

/* ------------------------------ HTTP helpers ------------------------------ */

const weakEtag = (body) => `W/"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 27)}"`;

/** Stable key from a route name + the (already validated) query object. */
function keyOf(name, query = {}) {
  const parts = Object.keys(query).sort().filter((k) => query[k] !== undefined && query[k] !== '').map((k) => `${k}=${query[k]}`);
  return parts.length ? `${name}?${parts.join('&')}` : name;
}

/**
 * Serve a public JSON body from the cache. The serialised body AND its ETag are cached, so a warm hit does no database
 * work, no JSON.stringify and no hashing; clients revalidating with If-None-Match get a 304 from Express.
 * `build()` returns the object to send (same `{ success, data }` shape the endpoint always had).
 */
async function sendCachedJson(req, res, { key, ttlMs, tags = [] }, build) {
  const entry = await cache.get(key, ttlMs, async () => {
    const json = JSON.stringify(await build());
    return { json, etag: weakEtag(json) };
  }, { tags });
  res.set('ETag', entry.etag);
  res.type('application/json').send(entry.json); // Express answers 304 itself when If-None-Match matches (req.fresh)
}

module.exports = { createCache, cache, TAGS, invalidateRankings, invalidateCatalog, invalidateMeta, invalidateResults, invalidateAll, keyOf, weakEtag, sendCachedJson };
