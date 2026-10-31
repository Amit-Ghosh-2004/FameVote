import { useEffect } from 'react';

const BASE = 'FameVote';
/** Sets route-specific browser and social metadata once dynamic profile data is available. */
export function useDocTitle(title) {
  useEffect(() => {
    if (!title) return;
    const value = `${title} – Celebrity Profile & Fan Rankings · ${BASE}`;
    const description = `Explore ${title}'s profile, fan ranking and monthly community voting on FameVote, an independent fan-voting platform.`;
    document.title = value;
    const update = (selector, attr, content) => {
      let el = document.head.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        const match = selector.match(/\[(name|property)="([^"]+)"\]/);
        el.setAttribute(match[1], match[2]);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };
    update('meta[name="description"]', 'name', description);
    update('meta[property="og:title"]', 'property', value);
    update('meta[property="og:description"]', 'property', description);
    const canonical = `https://www.famevote.online${window.location.pathname}`;
    let canonicalLink = document.head.querySelector('link[rel="canonical"]');
    if (!canonicalLink) { canonicalLink = document.createElement('link'); canonicalLink.rel = 'canonical'; document.head.appendChild(canonicalLink); }
    canonicalLink.href = canonical;
    update('meta[property="og:url"]', 'property', canonical);
    update('meta[name="twitter:title"]', 'name', value);
    update('meta[name="twitter:description"]', 'name', description);
  }, [title]);
}

const ROUTES = [
  [/^\/$/, ''], [/^\/rankings/, 'Rankings'], [/^\/vote/, 'Vote'], [/^\/winners/, 'Winners'], [/^\/how-it-works/, 'How it works'],
  [/^\/voting-integrity/, 'Voting integrity'], [/^\/verify-receipt/, 'Verify a receipt'], [/^\/nominate/, 'Nominate a celebrity'],
  [/^\/login/, 'Log in'], [/^\/register/, 'Create account'], [/^\/forgot-password/, 'Forgot password'], [/^\/reset-password/, 'Reset password'],
  [/^\/dashboard\/receipts/, 'Receipt'], [/^\/dashboard/, 'My account'],
];
export const titleForPath = (path) => ROUTES.find(([re]) => re.test(path))?.[1];
