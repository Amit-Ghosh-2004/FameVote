# FameVote SEO and domain configuration

## Canonical website address

Use `https://www.famevote.online` as the canonical site URL. The root domain
`https://famevote.online` should remain attached to the same Vercel project and
redirect to the `www` hostname (Vercel currently reports a 308 redirect).

In Vercel, set the frontend project's build environment variable:

- `VITE_SITE_URL=https://www.famevote.online`

Redeploy after changing the environment variable. Keep the Hostinger `www`
CNAME and apex A record aligned with the exact values shown in Vercel's Domains
screen. Do not remove mail-related DNS records.

## SEO implementation

- `src/main.jsx` mounts `SeoManager` inside `BrowserRouter`, so it runs on all
  routes, including admin routes.
- `SeoManager` updates the title, description, robots directive, canonical URL,
  Open Graph metadata and WebPage JSON-LD as routes change.
- Celebrity profile pages use `useDocTitle` after their profile data loads.
- Auth, dashboard, admin, voting, nomination and receipt routes are marked
  `noindex`. Unknown routes (404s) are also marked `noindex`.
- `robots.txt` allows crawling so search engines can read route-level `noindex`
  directives. It is not an access-control mechanism.
- `sitemap.xml` contains the stable public pages. Dynamic celebrity profile URLs
  are not enumerated in this static sitemap; add a generated sitemap once the
  production celebrity catalogue can be fetched reliably during deployment.

## Google Search Console

1. Verify the `www.famevote.online` property (a Domain property is also useful).
2. Submit `https://www.famevote.online/sitemap.xml`.
3. Inspect the homepage, rankings, winners, and a representative celebrity
   profile URL.
4. Check that canonical URLs resolve to `www.famevote.online`.

## Trust-page publication checklist

The About, Contact, Privacy, Terms and Voting Rules pages are included. The
Contact, Privacy and Terms pages contain operator-action reminders. Before
promoting the service, publish a monitored support address and have the privacy
and terms copy reviewed and completed with the operator's real legal identity,
actual processors, retention periods, governing law and effective date. Do not
publish invented company or contact details.
