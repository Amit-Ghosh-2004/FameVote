import { useEffect } from 'react';

const BASE = 'FameVote';
/** Sets the browser tab / history title. Pass nothing for the default brand title. */
export function useDocTitle(title) {
  useEffect(() => { document.title = title ? `${title} · ${BASE}` : `${BASE} - Your Vote. Their Fame.`; }, [title]);
}

const ROUTES = [
  [/^\/$/, ''], [/^\/rankings/, 'Rankings'], [/^\/vote/, 'Vote'], [/^\/winners/, 'Winners'], [/^\/how-it-works/, 'How it works'],
  [/^\/voting-integrity/, 'Voting integrity'], [/^\/verify-receipt/, 'Verify a receipt'], [/^\/nominate/, 'Nominate a celebrity'],
  [/^\/login/, 'Log in'], [/^\/register/, 'Create account'], [/^\/forgot-password/, 'Forgot password'], [/^\/reset-password/, 'Reset password'],
  [/^\/dashboard\/receipts/, 'Receipt'], [/^\/dashboard/, 'My account'],
];
export const titleForPath = (path) => ROUTES.find(([re]) => re.test(path))?.[1];
