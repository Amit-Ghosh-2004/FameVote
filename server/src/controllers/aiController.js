const { Celebrity, Category, Campaign, Nomination, Payment, User } = require('../models');
const { normalizeName } = require('../models/Celebrity');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { escapeRegex } = require('../utils/crypto');
const { ROLE_LEVEL } = require('../middleware/auth');
const { generateJson, withFallback, clip } = require('../services/aiService');
const { audit } = require('../services/auditService');
const FAQ = require('../data/faq');

const SYSTEM_BASE = 'You assist administrators of FameVote, an Indian celebrity voting platform. Return ONLY valid JSON. Never invent facts about real people: use only the facts supplied, and say when information is missing. You cannot approve payments, create votes, change rankings, issue refunds or decide fraud.';

function lev(a, b) {
  const m = a.length; const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const similarity = (a, b) => (a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0);

/* 1. Autocomplete: database suggestions always work; AI optionally proposes profile fields. */
exports.autocomplete = asyncHandler(async (req, res) => {
  const q = clip(req.body.query, 80);
  const local = await Celebrity.find({ name: new RegExp(`^${escapeRegex(q)}`, 'i') }).limit(6).select('name code categoryId').populate('categoryId', 'name');
  const cats = await Category.find({ status: { $ne: 'archived' } }).select('name slug');
  const out = await withFallback('autocomplete',
    () => generateJson({ feature: 'autocomplete', system: SYSTEM_BASE,
      prompt: `Admin is typing a celebrity name: "${q}". Suggest up to 5 well-known Indian public figures whose names start with or closely match this text. Categories available: ${cats.map((c) => c.slug).join(', ')}. JSON: {"suggestions":[{"name":string,"categorySlug":string,"stateHint":string|null,"oneLine":string}]}. Mark every suggestion as unverified.` }),
    async () => ({ suggestions: [] }));
  await audit(req, 'ai.autocomplete');
  res.json({ success: true, ...out, existing: local.map((c) => ({ id: c._id, name: c.name, code: c.code, category: c.categoryId?.name })) });
});

/* 2. Biography generator (draft only; a human must submit it via the normal edit form). */
exports.biography = asyncHandler(async (req, res) => {
  const { name, category, facts } = req.body;
  const out = await withFallback('biography',
    () => generateJson({ feature: 'biography', system: SYSTEM_BASE,
      prompt: `Write a neutral biography of at most 70 words for "${clip(name, 120)}" (category: ${clip(category, 80)}). Use ONLY these supplied facts: ${clip(facts, 1200) || '(none supplied)'}. If facts are thin, keep it short and generic. JSON: {"bio":string,"missingFacts":[string]}` }),
    async () => ({ bio: `${name} is listed in the ${category || 'celebrity'} category on FameVote.`, missingFacts: ['Career highlights', 'Notable works', 'Home state'] }));
  await audit(req, 'ai.biography', { meta: { name: clip(name, 80) } });
  res.json({ success: true, ...out });
});

/* 3. Category suggestion. */
exports.suggestCategory = asyncHandler(async (req, res) => {
  const cats = await Category.find({ status: 'active' }).select('name slug description');
  const { name, details } = req.body;
  const out = await withFallback('category',
    () => generateJson({ feature: 'category', system: SYSTEM_BASE,
      prompt: `Pick the best category for "${clip(name, 120)}" given: ${clip(details, 800)}. Categories: ${JSON.stringify(cats.map((c) => ({ slug: c.slug, name: c.name })))}. JSON: {"suggestions":[{"slug":string,"confidence":"high"|"medium"|"low","reason":string}]} (max 3, slugs must come from the list).` }),
    async () => {
      const text = `${name} ${details}`.toLowerCase();
      const rules = [[/actor|actress|film|movie|bollywood/, 'actors'], [/sing|music|album|song|band/, 'singers-musicians'], [/youtube|instagram|influenc|creator|vlog/, 'influencers-content-creators'], [/cricket|football|athlete|olympic|sport/, 'athletes-sports-personalities'], [/anchor|host|tv|television|serial/, 'tv-personalities'], [/comed|stand-up|standup/, 'comedians'], [/model|ramp|fashion/, 'models']];
      const hit = rules.find(([re]) => re.test(text));
      return { suggestions: [{ slug: hit ? hit[1] : 'other', confidence: hit ? 'low' : 'low', reason: hit ? 'Keyword match' : 'No clear signal' }] };
    });
  const valid = new Set(cats.map((c) => c.slug));
  out.data.suggestions = (out.data.suggestions || []).filter((s) => valid.has(s.slug)); // never trust AI-invented slugs
  res.json({ success: true, ...out });
});

/* 4. Nomination summarizer (no nominator identity is sent to the model). */
exports.summarizeNomination = asyncHandler(async (req, res) => {
  const n = await Nomination.findById(req.body.nominationId).populate('categoryId', 'name');
  if (!n) throw ApiError.notFound('Nomination not found');
  const missing = []; if (!n.state) missing.push('state'); if (!n.links?.length) missing.push('supporting links'); if (n.reason.length < 80) missing.push('detailed reason');
  const out = await withFallback('nomination',
    () => generateJson({ feature: 'nomination', system: SYSTEM_BASE,
      prompt: `Summarize this nomination in 2 sentences and list missing fields. Name: ${clip(n.name, 120)}. Category: ${n.categoryId?.name}. State: ${n.state || 'not given'}. Reason: ${clip(n.reason, 900)}. Links: ${n.links.length}. JSON: {"summary":string,"missingFields":[string],"concerns":[string]}` }),
    async () => ({ summary: clip(n.reason, 220), missingFields: missing, concerns: [] }));
  out.data.missingFields = [...new Set([...(out.data.missingFields || []), ...missing])];
  res.json({ success: true, ...out });
});

/* 5. Duplicate suggestions: local fuzzy matching is authoritative; AI only adds commentary. */
exports.duplicates = asyncHandler(async (req, res) => {
  const norm = normalizeName(req.body.name);
  const pool = await Celebrity.find({ status: { $ne: 'archived' } }).select('name nameNormalized code categoryId state').populate('categoryId', 'name').limit(5000);
  const matches = pool.map((c) => ({ c, n: c.nameNormalized || normalizeName(c.name) }))
    .map(({ c, n }) => ({ c, score: Math.max(similarity(norm, n), n.includes(norm) || norm.includes(n) ? 0.9 : 0) }))
    .filter((m) => m.score >= 0.75).sort((a, b) => b.score - a.score).slice(0, 8)
    .map((m) => ({ id: m.c._id, name: m.c.name, code: m.c.code, category: m.c.categoryId?.name, state: m.c.state, score: Number(m.score.toFixed(2)) }));
  res.json({ success: true, ai: false, feature: 'duplicates', draft: true, data: { matches, note: 'Matches are computed locally from existing records; review each one before deciding.' } });
});

/* 6. SEO assistant. */
exports.seo = asyncHandler(async (req, res) => {
  const { name, category, bio } = req.body;
  const out = await withFallback('seo',
    () => generateJson({ feature: 'seo', system: SYSTEM_BASE,
      prompt: `Draft SEO metadata for the FameVote profile of "${clip(name, 120)}" (${clip(category, 80)}). Bio: ${clip(bio, 500)}. JSON: {"title":string (<=60 chars),"description":string (<=155 chars),"keywords":[string] (max 8)}` }),
    async () => ({ title: `Vote for ${name} | FameVote`, description: `Vote for ${name} in the ${category || 'celebrity'} category on FameVote. See live India and state rankings.`.slice(0, 155), keywords: [name, category, 'FameVote', 'celebrity voting', 'India rankings'].filter(Boolean) }));
  res.json({ success: true, ...out });
});

/* 7. Announcement generator (draft; publishing is a separate human action). */
exports.announcement = asyncHandler(async (req, res) => {
  const { kind, campaignTitle, notes } = req.body;
  const out = await withFallback('announcement',
    () => generateJson({ feature: 'announcement', system: SYSTEM_BASE,
      prompt: `Draft a short (max 40 words) ${kind} announcement for the FameVote "${clip(campaignTitle, 120)}". Notes: ${clip(notes, 400)}. Friendly, no invented dates or numbers. JSON: {"message":string,"notificationTitle":string}` }),
    async () => ({ message: `${campaignTitle || 'The monthly campaign'}: ${kind === 'opening' ? 'voting is now open!' : kind === 'closing' ? 'voting closes soon, cast your votes!' : 'results are in!'}`, notificationTitle: campaignTitle || 'FameVote update' }));
  res.json({ success: true, ...out });
});

/* 9. Admin natural-language search: AI proposes a whitelisted filter; the SERVER runs the query. */
const ENTITIES = { celebrity: 0, category: 0, campaign: 0, nomination: 1, payment: 2, user: 2 }; // value = minimum role level
function heuristicParse(q) {
  const t = q.toLowerCase();
  const entity = /payment|refund|transaction|paid|failed/.test(t) ? 'payment' : /user|account|suspend/.test(t) ? 'user' : /nominat/.test(t) ? 'nomination' : /campaign|month/.test(t) ? 'campaign' : /categor/.test(t) ? 'category' : 'celebrity';
  const status = (t.match(/\b(active|inactive|archived|pending|approved|rejected|paid|failed|refunded|suspended|finalized|closed|upcoming|created|expired|requires_reconciliation)\b/) || [])[1];
  const text = t.replace(/\b(show|find|list|me|all|the|with|status|payments?|users?|celebrit(y|ies)|categories|category|campaigns?|nominations?)\b/g, '').trim();
  return { entity, status, text: text || undefined };
}
exports.nlSearch = asyncHandler(async (req, res) => {
  const q = clip(req.body.query, 200);
  const out = await withFallback('nl-search',
    () => generateJson({ feature: 'nl-search', system: SYSTEM_BASE,
      prompt: `Convert this admin search into a filter. Query: "${q}". JSON: {"entity":"celebrity|category|campaign|nomination|payment|user","status":string|null,"text":string|null}` }),
    async () => heuristicParse(q));
  const f = out.data;
  const need = ENTITIES[f.entity];
  if (need === undefined) throw ApiError.badRequest('Could not understand that search', 'UNPARSEABLE');
  if (ROLE_LEVEL[req.user.role] < Math.max(need, 1)) throw ApiError.forbidden('Your role cannot search that kind of record');

  const text = f.text ? new RegExp(escapeRegex(String(f.text).slice(0, 60)), 'i') : null;
  const status = f.status ? String(f.status).slice(0, 30) : null;
  let rows = [];
  switch (f.entity) {
    case 'celebrity': rows = await Celebrity.find({ ...(text && { name: text }), ...(status && { status }) }).limit(25).select('name code status'); break;
    case 'category': rows = await Category.find({ ...(text && { name: text }), ...(status && { status }) }).limit(25).select('name slug status'); break;
    case 'campaign': rows = await Campaign.find({ ...(text && { title: text }), ...(status && { status }) }).sort({ startsAt: -1 }).limit(25).select('key title status'); break;
    case 'nomination': rows = await Nomination.find({ ...(text && { name: text }), ...(status && { status }) }).limit(25).select('name status'); break;
    case 'payment': rows = await Payment.find({ ...(status && { status }) }).sort({ createdAt: -1 }).limit(25).select('status amountPaise razorpayPaymentId createdAt'); break;
    case 'user': rows = await User.find({ ...(text && { $or: [{ name: text }, { email: text }] }), ...(status && { status }) }).limit(25).select('name email status role'); break;
    default: break;
  }
  res.json({ success: true, ai: out.ai, interpreted: { entity: f.entity, status, text: f.text || null }, results: rows, note: 'AI only interpreted the query; results come from a fixed, permission-checked database query.' });
});

/* 8. FAQ assistant (public): answers come ONLY from the verified FAQ list. */
exports.faq = (_req, res) => res.json({ success: true, data: { faq: FAQ.map(({ id, q, a }) => ({ id, q, a })) } });

exports.faqAsk = asyncHandler(async (req, res) => {
  const question = clip(req.body.question, 200).toLowerCase();
  const scored = FAQ.map((f) => ({ f, s: f.keywords.filter((k) => question.includes(k)).length })).sort((a, b) => b.s - a.s);
  const best = scored[0];
  const manual = () => (best.s > 0 ? { answer: best.f.a, source: best.f.id } : { answer: 'I could not find that in the verified FameVote rules. Please check the How It Works and Voting Integrity pages.', source: null });
  const out = await withFallback('faq',
    () => generateJson({ feature: 'faq', system: 'You answer questions about the FameVote platform using ONLY the verified rules provided. If the answer is not in the rules, say you do not know. Return ONLY JSON: {"answer":string,"source":string|null}',
      prompt: `Rules:\n${FAQ.map((f) => `[${f.id}] ${f.a}`).join('\n')}\n\nQuestion: ${question}` }),
    async () => manual());
  res.json({ success: true, ai: out.ai, data: { answer: out.data.answer, source: out.data.source } });
});
