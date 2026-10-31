import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const SITE = (import.meta.env.VITE_SITE_URL || 'https://www.famevote.online').replace(/\/$/, '');
const BRAND = 'FameVote';
const DEFAULT_DESCRIPTION = 'Discover Indian celebrity fan rankings, explore categories and follow monthly community voting on FameVote, an independent fan-voting platform.';

const routeMeta = [
  [/^\/$/, { title: 'FameVote – Indian Celebrity Fan Voting & Rankings', description: DEFAULT_DESCRIPTION, type: 'website' }],
  [/^\/rankings\/?$/, { title: 'Indian Celebrity Rankings – FameVote', description: 'Explore FameVote national and state celebrity fan rankings across actors, singers, athletes, creators and more.', type: 'website' }],
  [/^\/winners\/?$/, { title: 'Monthly Celebrity Voting Winners – FameVote', description: 'Explore published monthly celebrity voting results and winners on FameVote.', type: 'website' }],
  [/^\/how-it-works\/?$/, { title: 'How FameVote Works – Voting Guide', description: 'Learn how FameVote accounts, monthly campaigns, category voting, rankings and vote receipts work.', type: 'article' }],
  [/^\/voting-integrity\/?$/, { title: 'Voting Integrity & Fairness – FameVote', description: 'Understand FameVote vote validation, duplicate-vote prevention, result finalization and receipt verification.', type: 'article' }],
  [/^\/about\/?$/, { title: 'About FameVote – Independent Fan Voting Platform', description: 'Learn about FameVote, an independent platform for community-led celebrity fan voting and rankings.', type: 'article' }],
  [/^\/contact\/?$/, { title: 'Contact & Support – FameVote', description: 'Find information about contacting FameVote for account, voting, privacy and platform questions.', type: 'article' }],
  [/^\/privacy\/?$/, { title: 'Privacy Policy – FameVote', description: 'Read how FameVote handles account information, voting records, receipts and website data.', type: 'article' }],
  [/^\/terms\/?$/, { title: 'Terms & Conditions – FameVote', description: 'Read the terms that apply when using the FameVote website and fan-voting features.', type: 'article' }],
  [/^\/voting-rules\/?$/, { title: 'Voting Rules & Guidelines – FameVote', description: 'Read FameVote campaign eligibility, monthly voting limits, result and participation rules.', type: 'article' }],
];

const PRIVATE = [/^\/admin(?:\/|$)/, /^\/dashboard(?:\/|$)/, /^\/login\/?$/, /^\/register\/?$/, /^\/forgot-password\/?$/, /^\/reset-password\/?$/, /^\/vote\/?$/, /^\/nominate\/?$/, /^\/verify-receipt\/?$/];

function setMeta(selector, attr, value) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement('meta');
    const [key, val] = selector.match(/\[(name|property)="([^"]+)"\]/).slice(1);
    node.setAttribute(key, val);
    document.head.appendChild(node);
  }
  node.setAttribute('content', value);
}

function setLink(rel, href) {
  let node = document.head.querySelector(`link[rel="${rel}"]`);
  if (!node) { node = document.createElement('link'); node.rel = rel; document.head.appendChild(node); }
  node.href = href;
}

export default function SeoManager() {
  const { pathname } = useLocation();
  useEffect(() => {
    const path = pathname || '/';
    const isPrivate = PRIVATE.some((re) => re.test(path));
    const isCelebrity = /^\/celebrity\/[^/]+\/?$/.test(path);
    const match = routeMeta.find(([re]) => re.test(path))?.[1];
    const isNotFound = !isPrivate && !isCelebrity && !match;
    const title = isNotFound ? 'Page Not Found – FameVote' : (isCelebrity ? 'Celebrity Profile & Fan Rankings – FameVote' : (match?.title || 'FameVote – Indian Celebrity Fan Voting & Rankings'));
    const description = isNotFound
      ? 'The page you requested could not be found on FameVote.'
      : (isCelebrity
        ? 'Explore this celebrity profile, current fan ranking and monthly community voting information on FameVote.'
        : (match?.description || DEFAULT_DESCRIPTION));
    const canonical = `${SITE}${path === '/' ? '/' : path.replace(/\/+$/, '')}`;
    document.title = title;
    setMeta('meta[name="description"]', 'name', description);
    setMeta('meta[name="robots"]', 'name', (isPrivate || isNotFound) ? 'noindex, nofollow' : 'index, follow, max-image-preview:large');
    setMeta('meta[property="og:type"]', 'property', isCelebrity ? 'profile' : (match?.type || 'website'));
    setMeta('meta[property="og:url"]', 'property', canonical);
    setMeta('meta[property="og:title"]', 'property', title);
    setMeta('meta[property="og:description"]', 'property', description);
    setMeta('meta[name="twitter:title"]', 'name', title);
    setMeta('meta[name="twitter:description"]', 'name', description);
    setLink('canonical', canonical);

    const old = document.getElementById('famevote-page-schema');
    if (old) old.remove();
    if (!isPrivate && !isNotFound) {
      const schema = document.createElement('script');
      schema.id = 'famevote-page-schema';
      schema.type = 'application/ld+json';
      schema.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description,
        url: canonical,
        isPartOf: { '@type': 'WebSite', name: BRAND, url: `${SITE}/` },
        publisher: { '@type': 'Organization', name: BRAND, url: `${SITE}/` },
      });
      document.head.appendChild(schema);
    }
  }, [pathname]);
  return null;
}
