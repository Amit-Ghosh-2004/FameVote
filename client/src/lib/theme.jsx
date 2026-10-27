import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const KEY = 'fv-theme';
const COLORS = { dark: '#0C0B10', light: '#FAF7F2' };
// Kept at module level: a MediaQueryList that nothing references can be garbage-collected and stop firing.
const MQ = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
const mq = () => MQ;

function saved() { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; } catch { return null; } }
function system() { return mq()?.matches ? 'light' : 'dark'; }

export function applyTheme(t) {
  const root = document.documentElement;
  root.dataset.theme = t;
  root.style.colorScheme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[t]);
}

/** Saved choice wins; with nothing saved the theme follows the OS and keeps following it live. */
export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || saved() || system());
  useEffect(() => {
    const m = mq(); if (!m) return undefined;
    const on = () => { if (!saved()) { const t = system(); applyTheme(t); setTheme(t); } };
    on(); // catch up if the OS setting changed before this listener attached
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* private mode: still switches for this visit */ }
    applyTheme(next); setTheme(next);
  }, [theme]);
  return { theme, toggle };
}

export function ThemeToggle({ className = '' }) {
  const { theme, toggle } = useTheme();
  const toLight = theme === 'dark';
  return (
    <button type="button" onClick={toggle} aria-label={toLight ? 'Switch to light theme' : 'Switch to dark theme'} title={toLight ? 'Light theme' : 'Dark theme'}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-ink/80 transition hover:bg-ink/10 ${className}`}>
      {toLight ? <Sun className="h-[18px] w-[18px]" aria-hidden="true" /> : <Moon className="h-[18px] w-[18px]" aria-hidden="true" />}
    </button>
  );
}
