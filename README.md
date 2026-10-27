# FameVote — Your Vote. Their Fame.

Monthly celebrity voting and rankings for India. MERN stack: React + Vite + Tailwind (client), Express + Mongoose (server), MongoDB Atlas, Cloudinary, Razorpay, Gemini.

```
famevote/
  client/   React SPA (Vercel)         server/   Express API (Render)
  render.yaml   
```

## Run locally (no Docker)

```bash
cd server && cp .env.example .env     # set MONGODB_URI, Cloudinary credentials and other secrets
npm install
npm run seed                          # unified seed: core setup, celebrity records/images, clearly labeled demo results
npm run dev                           # API on :5000
cd ../client && cp .env.example .env && npm install && npm run dev   # SPA on :5173 (proxies /api)
```
Secrets: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` (run three times).
Admin portal: `/admin/login` with `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` used by the seed script.

**Celebrity seed and portraits.** `npm run seed` runs the full seed workflow. When Cloudinary credentials are configured, it first searches Wikimedia Commons for confidently matched portraits with reusable CC0/Public Domain/CC BY/CC BY-SA licenses, uploads images to Cloudinary, then attaches saved image URLs to the matching celebrity records. If no suitable open-license match is found, the existing Wikipedia lead-image fallback may be attempted. Existing profile data and admin-uploaded images are preserved. Review image attribution/license details in `server/seed-assets/image-manifest.json` before public launch.

Image bytes are fetched into server memory and streamed to Cloudinary. The workflow does not write image files into `server/seed-assets/images`. A manifest can cache successful Cloudinary URLs so repeated seeding skips work. Wikipedia requests use retries/backoff for temporary rate limits; if a page has no suitable lead image, the profile keeps its initials placeholder until an admin uploads a photo.
```bash
cd server
npm run seed                  # all-in-one, idempotent seed for dev or production
npm run seed:celebrities      # retry missing celebrity records/portraits
npm run seed:celebrities -- --no-images  # create missing records without image fetching
npm run images:manifest       # (re)build the manifest; no network
npm run images:fetch-open     # retry openly licensed Commons portraits
```
Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in `server/.env` before image uploads. The manifest stores source page, attribution/licence note and Cloudinary URL; confirm reuse rights for each image before public launch. No portraits are bundled in the ZIP; images are fetched into Cloudinary when you run the commands.

**Email (Brevo REST API).** Set `BREVO_API_KEY`, `EMAIL_FROM_EMAIL` (a sender/domain verified in Brevo) and `EMAIL_FROM_NAME`. Without a key, links print to the server console in development only.

**Google sign-in.** Create a Web OAuth client in Google Cloud Console, add each exact client URL as an *Authorized JavaScript origin* (local: `http://localhost:5173`; production: your Vercel HTTPS domain), then set the same client ID as `GOOGLE_CLIENT_ID` in `server/.env` and `VITE_GOOGLE_CLIENT_ID` in `client/.env`. Rebuild/redeploy the client after changing the Vite variable; it is embedded at build time. Do not put a Google client secret in the browser. The server verifies Google's ID token; no client secret is needed. For local dev the origin is `http://localhost:5173` (also add `http://localhost`). The browser warning "Cross-Origin-Opener-Policy policy would block the window.postMessage call" comes from the popup and is avoided by serving the SPA with `Cross-Origin-Opener-Policy: same-origin-allow-popups` (already set in `client/vite.config.js` and `client/vercel.json`). `POST /api/auth/google` answers 422 when the request body is not a valid Google credential; the validator now accepts the common field names, and a real 401/503 tells you if the token or `GOOGLE_CLIENT_ID` is wrong.

**Light / dark theme.** The header toggle saves the choice in `localStorage` (`fv-theme`); with nothing saved the site follows the device setting, live. A tiny inline script in `index.html` sets the theme before first paint (no flash).

## Install notes
`npm install` used to run `mongodb-memory-server`'s postinstall, which downloads a ~100 MB mongod binary (npm hides its output behind the spinner). It is no longer a dependency; `npm run test:mem` installs it on demand. Also replaced: `multer` 1.x -> 2.x, `pdfkit` 0.15 -> 0.20 (drops `crypto-js` and `jpeg-exif`), `node-cron` 4, `google-auth-library` 10 (Node >= 18); the `node-domexception` deprecation is overridden with `@nolyfill/domexception`. If an install is still slow on your network, diagnose with `npm ci --foreground-scripts --loglevel=info` and `npm config get registry`.

## Tests
```bash
cd server
npm test                                    # unit tests; integration tests are SKIPPED without a replica set
MONGODB_URI_TEST="<atlas test cluster uri>" npm test   # integration tests against a throwaway Atlas database
npm run test:mem                            # integration tests with an in-memory replica set (downloads a mongod binary once)
```
Integration tests need a MongoDB **replica set** (an Atlas cluster works; use a dedicated test database). If none is reachable they are reported as *skipped*, never as passed.
They cover the 17 acceptance scenarios (one vote per category, concurrency, free/paid flows, webhook idempotency, receipts, IST schedule, finalization, rankings, authorization, AI failure, reconciliation, restarts). Razorpay is replaced by a fake gateway; no real payments are made.

## Business rules (where they are enforced)
| Rule | Enforcement |
|---|---|
| One vote per user / category / campaign | Unique index `Vote{userId,campaignId,categoryId}`; disqualified votes keep their slot |
| One vote per payment, one receipt per vote | Unique `Vote.paymentId`, `Receipt.voteId`; `Payment.activeKey` blocks parallel attempts |
| Amount ₹0–₹7 (whole rupees), INR only | Schema + validator + server setting; client amount is never read |
| Paid vote only after verified payment | HMAC signature check **and** Razorpay API fetch; webhook signature + `WebhookEvent` idempotency ledger |
| Campaign window | Server clock vs stored `startsAt/endsAt` (IST). 00:00:00 on day 1 → 23:59:59.999 on the second-last day; the last day is results day (auto-finalized after 1 h, auto-published). Scheduler only syncs state; it never decides acceptance |
| Late payment | Judged by gateway payment time; after close ⇒ no vote, `requires_reconciliation`, auto-refund (`AUTO_REFUND`), retried by the job |
| Rankings | Aggregated from confirmed votes. India Top 15, State Top 10 per category. State = voter's state **at vote time** |
| Ties | Share a rank (1,2,2,4), alphabetical within the tie |
| Finalization | Atomic claim, only after close + grace period + no pending payments; immutable snapshots; corrections add a new revision with reason + audit log |
| Receipts | Immutable snapshot, HMAC verification reference, owner-only access, PDF |

## Setup guides
**MongoDB Atlas** – create a cluster (M0 works, it is a replica set), a database user with `readWrite` on `famevote` only, restrict Network Access to Render's outbound IPs (or temporarily 0.0.0.0/0 while testing), enable backups on paid tiers, copy the SRV string into `MONGODB_URI`. Indexes are built automatically at startup.

**Razorpay (test mode first)** – Dashboard → Test Mode → API Keys → set `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` (`rzp_test_…`). Webhooks → add `https://<render-url>/api/webhooks/razorpay`, secret → `RAZORPAY_WEBHOOK_SECRET`, events: `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`, `refund.failed`. **Check Razorpay's current minimum order amount and your account's eligibility before enabling a price; the API refuses paid amounts below ₹1.** Admin → Settings (super admin only) sets the amount.

**Cloudinary** – set the three credentials on the server only. Uploads go through the API (JPEG/PNG/WebP ≤ 5 MB, magic-byte checked).

**Gemini** – create a key in Google AI Studio, set `GEMINI_API_KEY`; choose a model currently available on the free tier in `GEMINI_MODEL` and check its rate limits. AI output is draft-only; every AI feature has a manual fallback and a quota circuit breaker.

**Render** – New → Blueprint from `render.yaml` (or Web Service, root `server`, build `npm ci`, start `npm start`, health check `/health`). Use a paid instance: free instances sleep and pause the scheduler (the clock still guards voting, and startup recovery re-syncs).
**Vercel** – import the repo, root `client`, framework Vite, env `VITE_API_URL=https://<render-url>`; `vercel.json` provides the SPA fallback. Set `CLIENT_URL` on Render to the Vercel origin (cookies are `SameSite=None; Secure`).

## API (all under `/api`, JSON `{success, data}` / `{success:false, error:{code,message,details?}}`)
Auth: `POST /auth/register|login|logout|forgot-password|reset-password|change-password`, `GET /auth/session` (always 200, `{user:null}` for guests, so browsing logs no 401s), `GET /auth/me` (401 when logged out), `PATCH /auth/profile`
Public: `GET /meta`, `/categories`, `/celebrities?category&state&q&page`, `/celebrities/:idOrSlug`, `/campaigns[/current]`, `/rankings?campaign&category&scope=national|state&state`, `/rankings/home`, `/winners[?campaign]`, `/receipts/verify?receiptNo&ref`, `/faq`, `POST /faq/ask`
Voting: `GET /votes/eligibility?categoryId`, `POST /votes` (free flow, optional `Idempotency-Key`), `GET /votes/mine`, `POST /payments/order`, `POST /payments/verify`, `POST /payments/:id/cancel`, `GET /payments/mine|:id`
Me: `GET /receipts[/:id[/pdf]]`, `/me/dashboard|favorites|notifications`, `PUT /me/avatar`, `POST /nominations`, `GET /nominations/mine`
Webhook: `POST /webhooks/razorpay` (raw body, HMAC verified)
Admin (`/admin`, separate cookie; the admin session is only probed on admin screens via `GET /admin/auth/session`; roles moderator < admin < superadmin): dashboard, categories, celebrities (+images), campaigns (results, snapshots, finalize, publish, correct), jobs, vote disqualification, users, payments (+refund), receipts, nominations, settings, announcements, banners, notifications, audit logs, CSV reports, `/ai/*` assistants. **There is deliberately no endpoint to mark a payment as paid.**

## Test report (what was actually run)
| Area | Result |
|---|---|
| Server unit tests (`npm test`) | **114 passed, 0 failed** (adds 30 for group rankings, phone numbers, one-time codes with a stubbed store, validators, admin-only social link, seed data shape; also includes Google sign-in controller with stubbed DB + Google, sample-data planner, image pipeline with mocked providers, HTTP cache policy, production config guard) |
| Server integration tests (voting, payments, webhooks, receipts, admin RBAC, schedule) | **Not run here: 59 skipped** (need a MongoDB replica set; run `MONGODB_URI_TEST=... npm test` or `npm run test:mem`) |
| Browser checks, desktop 1280 and phone 390, mocked API (gender filters, rankings, phone login, short nomination form, admin add/edit with photo upload, admin nomination, overflow) | **76/76 passed** (also checks: no photos below the home hero, rankings leader card + vote button). Not run against a real backend |
| Client production build (`npx vite build`) | Passed |
| Responsive audit, public pages x 5 widths x dark/light | **110/110 passed** (320/375/768/1024/1280) (no horizontal overflow, theme applied, no runtime errors) with a mocked API |
| axe-core, 11 pages x 390/820 px x dark/light | 0 violations (mocked API) |
| Google button flow (stubbed Google script, mocked API) | 7/7 passed: renders, posts the credential, redirects, blocks sign-up without a state, shows a notice when the server has no client ID. **Not** tested against real Google. |
| Sample-data seed against a database | **Not run here** (no MongoDB): the planner logic is unit-tested; the inserts and finalization need a real run (`npm run seed:demo -- --rebuild`) |
| PDF receipt rendered and inspected (2 samples incl. long names); QR scannability not tested with a scanner | Passed (visual) |
| Voting journey (guest → login → free vote → receipt → next category) | 9/9 passed with a mocked API; not against a real backend |
| Real Google sign-in, real Razorpay checkout/webhook, Cloudinary upload, live Wikipedia lookups, deployment on Vercel/Render/Atlas | **Unverified**: need your credentials/network; the sandbox could not reach those services |
| Slow `npm install` | Cause removed (see Install notes) but **not reproducible here**; confirm on your network |

## Receipts and loading behaviour
- The PDF receipt is a fan-style ticket (A5): confetti, initials badge, a category-specific tagline ("Lights. Camera. Vote."), a "VOTE COUNTED!" stamp, a QR code to the verify page and the receipt number/verification reference. The on-screen receipt and the ticket shown right after voting use the same look. Taglines live in `server/src/data/fanCopy.js` and `client/src/lib/fanCopy.js`.
- `useAsync(fn, deps, { key, ttl, keepPrevious })` is backed by a shared request cache: requests with a `key` are de-duplicated, served from memory while fresh and shown stale-while-revalidate, so revisiting a page or category does not flash skeletons or refetch (categories used to be requested by five pages). A confirmed vote clears the affected keys with `bustCache`.
- The category picker applies a chosen category only after its sheet has finished closing, and the hero preloads every category's podium photos.

## Gender sub-groups, phone sign-in, admin-only fields

- **Male / Female / Others** exist inside every category. One vote per category per month is unchanged; the groups are filters and separate leaderboards (Vote, Rankings, Winners). A group with nobody listed is hidden. Celebrities created before this feature read as "Others" until an admin sets a group; `npm run seed:celebrities` fills the group for seeded records that have none.
- Group boards for finalized months are stored in `RankingSnapshot.state` as `~female` / `TN~female` (no index change, old snapshots stay valid). Months finalized before this change have no group snapshots, so their group boards are computed from the confirmed votes.
- **Phone sign-in** (6-digit code by SMS, 5-minute expiry, 5 tries, 30 s resend, 5 codes/hour/number). Set `SMS_PROVIDER` to `twilio` or `msg91` plus its keys; with `none` the option is hidden. Phone-only accounts get a reserved placeholder e-mail (`…@phone.famevote.invalid`) so the existing unique e-mail index is unchanged; it is never shown.
- **Social profile link** (`socialUrl`) exists on celebrities and nominations, is entered only by admins, and no public endpoint returns it (covered by a unit test).

## Google sign-in checklist
Both values must be the **same** Web client ID: `GOOGLE_CLIENT_ID` (server `.env`) and `VITE_GOOGLE_CLIENT_ID` (client, set at build time, so redeploy the client after changing it). In Google Cloud Console add every origin the site is served from (for example `http://localhost:5173` and your Vercel URL) under *Authorized JavaScript origins*; no redirect URI is needed. The server logs the exact rejection reason (`[google] ID token rejected: ...`, e.g. an audience mismatch). `/api/meta` reports `googleSignIn: false` when the server has no client ID, and the button is replaced by a notice. A Google sign-in for an e-mail that already has a password account links the two and removes the old password (accounts are not e-mail verified, so the password could have been pre-registered by someone else); staff accounts are never linked.

## Caching, config guards and assets
- Every `/api` response is `Cache-Control: no-store` except public GETs that opt in with `publicCache` (meta, categories, celebrities list, campaigns, rankings, winners: 10–60 s + stale-while-revalidate). Error responses are always `no-store`.
- In production the server refuses to boot if the three secrets are not distinct, contain the `replace-with` placeholder, or if `CLIENT_URL` is not https / is localhost, or `SERVER_URL` is localhost.
- Portraits are served through Cloudinary with `f_auto,q_auto`, a 4:5 crop, a responsive `srcset` (160-720 px) and a tiny blurred preview, so phones download a few KB per avatar.
- Client: leave `VITE_API_URL` empty in dev (Vite proxy). Set `VITE_SITE_URL` in production so `og:image` and canonical URLs are absolute.
- `client/public` has the OG image, PWA manifest, app icons and `robots.txt`.

## Production checklist
- [ ] Secrets set, distinct, ≥32 chars; no `.env` committed
- [ ] `CLIENT_URL` exactly matches the Vercel origin; login works cross-site (cookies)
- [ ] Razorpay: test-mode order → pay → vote + receipt; webhook delivery shows 200; refund path exercised; then switch to live keys
- [ ] Amount set in Admin → Settings; verified against Razorpay minimums
- [ ] Super admin created, default password changed, seed `--demo` NOT run in production
- [ ] Atlas: least-privilege user, IP allow-list, backups
- [ ] Scheduler running (one instance is enough; multiple are safe)
- [ ] After the first month closes: reconcile → finalize → publish
- [ ] Mobile pass at 360/390/768/1280 px; Lighthouse on Home and Vote


### Wikipedia-only celebrity portraits

Configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in `server/.env`. The unified `npm run seed` searches for openly licensed Wikimedia Commons portraits, uploads image bytes from memory to Cloudinary, then attaches matching manifest URLs to the corresponding celebrity records. No local portrait files are written. Some profiles may retain placeholders when no confidently matched, suitably licensed image is available; review `server/seed-assets/image-manifest.json` for attribution and license details.

### Sample data (preview)

`npm run seed` finishes with `seed-demo.js`, which builds a finished September and a live October from a small pool of **60 sample voters** (weighted towards the larger states; use `--voters=N` for more): confirmed votes (one per voter per category, dated inside each campaign, weighted so categories have a clear leader), free payments, receipts, favourites and a few pending nominations. September is finalized through the real finalization service and published; October stays open with provisional rankings, so real votes simply add to it.

- `npm run seed:demo -- --rebuild` replaces an older, smaller sample set (the plain command skips when enough sample data exists). `--voters=600` changes the pool size.
- `npm run seed:demo:purge` removes **only** sample records (accounts with `authProviders: ['demo']` and an `@demo.famevote.test` address, plus their votes, payments, receipts, favourites, nominations and the September snapshots) and refuses if a finalized campaign contains real votes. Real users, votes, payments and receipts are never read or changed.
- The public campaign titles no longer say "Demo Results". While any sample account exists, `/api/meta` returns `sampleData: true`; the footer then shows a one-line "preview" note and `/verify-receipt` marks sample receipts. The notice disappears after the purge. **Do not publish sample votes as genuine results**: purge before a real launch.
- Sample e-mails use the reserved `.test` domain, so no message can ever reach a real person.

**Email policy:** Registration and sign-in do not send verification emails. Password-reset emails may still use Brevo when `BREVO_API_KEY` is configured. Google sign-in still requires a valid Google ID token with a verified Google email.

### Responsive auth form and UI consistency follow-up (2026-10-20)
- Registration uses a compact viewport-aware layout: name/email share a row where there is enough width, controls have tighter spacing, and the mobile bottom navigation/footer are hidden on auth routes so they do not push the form below the fold.
- The form keeps a natural overflow fallback for short screens, large text/zoom, validation messages, and the on-screen keyboard; forcing a hard fixed height would hide controls and harm accessibility.
- Review performed on shared theme tokens, auth route layout, state selector fallback, hard-coded white usage, route presence, and secret-file exclusion. Backend JavaScript syntax and project JSON files passed static checks.
- **This follow-up was not browser-tested at every viewport:** dependency installation did not provide a runnable Vite binary in this environment, so a fresh production build, visual screenshot audit, axe-core run, and end-to-end flows could not be repeated after these edits. Run `npm ci && npm run build` in `client`, and `npm ci && npm test` in `server` before deployment.



### Open-license celebrity portraits (recommended for the public site)

The original Wikipedia summary lookup now prefers `originalimage` over the thumbnail URL, fixing a host-validation false negative. For a license-filtered search, configure Cloudinary and run from `server`:

```powershell
npm run images:fetch-open
npm run seed:celebrities
```

This searches Wikimedia Commons and only uploads confidently matched images whose metadata reports CC0, Public Domain, CC BY, or CC BY-SA; it excludes NC/ND licenses. It downloads images into memory and uploads them to your Cloudinary account, so no large image bundle is needed. The manifest records the file-page URL, creator/attribution, license, and license URL. Review the manifest and Commons file pages before launch. Some celebrities may be skipped if no confidently matched open-license portrait is found. Use `-- --force` to re-check existing entries, or `-- --only=shah-rukh-khan,alia-bhatt` to limit a run.
