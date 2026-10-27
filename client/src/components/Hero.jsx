import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useCountdown } from '../lib/hooks';
import { haptic } from '../lib/fx';
import { img, imgSet } from '../lib/api';
import { CategoryPicker, Podium, Skeleton } from './ui';

const PODIUM_SIZES = '(min-width:1024px) 150px, 30vw'; // keep in sync with <Podium>'s Portrait
const pad = (n) => String(n).padStart(2, '0');

/** Live countdown. `compact` is a single pill for phones; the default is four tiles. */
export function HeroTimer({ target, serverTime, label, compact = false }) {
  const c = useCountdown(target, serverTime);
  const dot = <span className="relative flex h-2 w-2 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-brand" /></span>;
  if (compact) {
    return (
      <div role="timer" aria-label={`${label} ${c.days} days ${c.hours} hours ${c.minutes} minutes`} className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1.5 text-[13px] backdrop-blur">
        {dot}<span className="truncate text-ink/70">{label}</span><span className="font-heading font-extrabold tnum">{c.days}d {pad(c.hours)}h {pad(c.minutes)}m {pad(c.seconds)}s</span>
      </div>
    );
  }
  const cell = (v, l) => (
    <div className="flex min-w-0 flex-1 flex-col items-center rounded-xl bg-ink/[.06] py-2.5">
      <span className="font-heading text-[30px] font-extrabold leading-none tnum">{pad(v)}</span><span className="mt-1 text-[11px] font-medium text-ink/55">{l}</span>
    </div>
  );
  return (
    <div role="timer" aria-label={label} className="rounded-2xl border border-line bg-surface/70 p-3 backdrop-blur">
      <p className="mb-2 flex items-center gap-2 px-0.5 text-[13px] font-semibold text-ink/75">{dot}{label}</p>
      <div className="flex gap-2">{cell(c.days, 'days')}{cell(c.hours, 'hrs')}{cell(c.minutes, 'min')}{cell(c.seconds, 'sec')}</div>
    </div>
  );
}

/**
 * The hero's main object: pick a category, see its podium, vote. Swipe the podium (or use the arrows) to flip categories.
 * previews: [{ category: {slug,name,icon}, entries: [...] }]
 */
export function HeroPodium({ previews, slug, onSlug, loading }) {
  const reduce = useReducedMotion();
  const active = previews.find((p) => p.category.slug === slug) || previews[0];
  const items = previews.map((p) => ({ slug: p.category.slug, name: p.category.name, icon: p.category.icon, count: p.entries?.length }));
  const go = (d) => { const i = Math.max(0, previews.indexOf(active)); onSlug(previews[(i + d + previews.length) % previews.length].category.slug); haptic(8); };
  const none = active?.entries?.every((e) => !e.votes);
  // Warm the browser cache with every category's podium photos (same srcset/sizes the podium uses), so switching
  // category swaps already-decoded images instead of showing a blank frame while they download.
  useEffect(() => {
    if (!previews.length) return undefined;
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 400));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const h = idle(() => previews.forEach((p) => (p.entries || []).slice(0, 3).forEach((e) => {
      if (!e.image) return; const im = new Image(); im.sizes = PODIUM_SIZES; if (imgSet(e.image)) im.srcset = imgSet(e.image); im.src = img(e.image, 360);
    })));
    return () => cancel(h);
  }, [previews]);
  return (
    <div>
      <CategoryPicker loading={loading || !active} items={items} active={active?.category.slug} onSelect={onSlug} />
      <motion.div className="mt-5 select-none" style={{ touchAction: 'pan-y' }} drag={reduce || previews.length < 2 ? false : 'x'} dragSnapToOrigin dragElastic={0.25}
        onDragEnd={(_, i) => { if (Math.abs(i.offset.x) > 70 || Math.abs(i.velocity.x) > 500) go(i.offset.x < 0 ? 1 : -1); }}>
        {loading || !active ? <Skeleton className="mx-auto h-[300px] w-full max-w-sm" />
          : active.entries?.length ? <div key={active.category.slug} className="mx-auto w-full max-w-sm"><Podium entries={active.entries} /></div>
          : <p className="rounded-2xl bg-sand p-5 text-center text-[15px]">No one is listed in {active.category.name} yet.</p>}
      </motion.div>
      {none && !loading && <p className="mt-3 text-center text-[13px] text-ink/60">No votes yet. Yours could crown the first leader.</p>}
      <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
        <Link to={`/vote?category=${active?.category.slug || ''}`} className="btn-pop !min-h-[54px] !rounded-2xl text-[16px]">Vote in {active?.category.name || 'this category'}<ArrowRight className="h-5 w-5" aria-hidden="true" /></Link>
        <Link to={`/rankings?category=${active?.category.slug || ''}`} className="btn-ghost !min-h-[54px] !rounded-2xl px-4 text-[15px]">Ranking</Link>
      </div>
    </div>
  );
}
