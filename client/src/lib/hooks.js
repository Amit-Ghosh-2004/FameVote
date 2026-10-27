import { useCallback, useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------------------------------------------------------
 * Shared request cache.
 * Root cause of the flicker / repeated loading: every page and every dependency change started its own request and
 * replaced the content with skeletons, even for data fetched a second earlier (categories alone were requested by
 * five different pages). Requests that pass a `key` are now de-duplicated while in flight, served instantly from
 * memory while fresh, and shown stale-while-revalidate after that.
 * ---------------------------------------------------------------------------------------------------------------- */
const store = new Map();   // key -> { data, at }
const flights = new Map(); // key -> Promise
export function bustCache(prefix = '') { for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k); }
function load(key, fn, force) {
  if (!force && flights.has(key)) return flights.get(key);
  const p = fn().then((data) => { store.set(key, { data, at: Date.now() }); return data; }).finally(() => flights.delete(key));
  flights.set(key, p);
  return p;
}

/**
 * Fetch helper with loading/error state; re-runs when deps change.
 *  opts.key           cache key (include every parameter). Without it nothing is cached.
 *  opts.ttl           ms a cached value is considered fresh (default 30s); stale values show while revalidating.
 *  opts.keepPrevious  keep the last result on screen while new params load (pagination, search): `fetching` is true.
 * `loading` is true only when there is nothing to show yet, so pages swap skeletons in once instead of flashing.
 */
export function useAsync(fn, deps = [], opts = {}) {
  const { key, ttl = 30000, keepPrevious = false } = opts;
  const cached = key ? store.get(key) : null;
  const [state, setState] = useState(() => ({ data: cached?.data ?? null, error: null, loading: !cached, fetching: !cached }));
  const fnRef = useRef(fn); fnRef.current = fn;
  const keyRef = useRef(key); keyRef.current = key;

  const run = useCallback((force = false) => {
    let live = true;
    const k = keyRef.current; const hit = k ? store.get(k) : null;
    if (hit && !force) {
      const fresh = Date.now() - hit.at < ttl;
      setState({ data: hit.data, error: null, loading: false, fetching: !fresh });
      if (fresh) return () => {};
    } else {
      setState((s) => ({ data: keepPrevious && s.data ? s.data : null, error: null, loading: !(keepPrevious && s.data), fetching: true }));
    }
    const req = k ? load(k, () => fnRef.current(), force) : fnRef.current();
    req.then((data) => live && setState({ data, error: null, loading: false, fetching: false }),
      (error) => live && setState((s) => (hit && !force ? { ...s, fetching: false } : { data: null, error, loading: false, fetching: false })));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ttl, keepPrevious]);

  /** Refresh without flashing skeletons; keeps the old data if the refresh fails. */
  const refresh = useCallback(() => {
    const k = keyRef.current;
    (k ? load(k, () => fnRef.current(), true) : fnRef.current()).then((data) => setState({ data, error: null, loading: false, fetching: false }), () => {});
  }, []);
  // The effect depends on deps (not only the key) so un-keyed callers keep working exactly as before.
  useEffect(() => run(), [run, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: () => run(true), refresh };
}

/** Calls `fn` every `ms` while the tab is visible (and once when it becomes visible again). */
export function usePoll(fn, ms = 30000, enabled = true) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') ref.current(); };
    const t = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [ms, enabled]);
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Countdown driven by the SERVER time offset so a wrong device clock cannot mislead the user. */
export function useCountdown(targetIso, serverTimeIso) {
  const offset = useRef(0);
  useEffect(() => { if (serverTimeIso) offset.current = new Date(serverTimeIso).getTime() - Date.now(); }, [serverTimeIso]);
  const calc = () => Math.max(0, new Date(targetIso).getTime() - (Date.now() + offset.current));
  const [ms, setMs] = useState(calc);
  useEffect(() => {
    if (!targetIso) return undefined;
    setMs(calc());
    const t = setInterval(() => setMs(calc()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIso, serverTimeIso]);
  const s = Math.floor(ms / 1000);
  return { ms, days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60, done: ms === 0 };
}

export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true); s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}
