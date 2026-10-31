import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, MousePointerClick, Receipt, Search, ShieldCheck, Sparkles, Trophy, Vote as VoteIcon, Wallet } from 'lucide-react';
import { api, unwrap, fmtNum } from '../lib/api';
import { useAsync, useCountdown, useDebounced } from '../lib/hooks';
import { useAuth } from '../lib/AuthContext';
import { statusText } from '../components/Layout';
import { CategoryIcon, Podium, Portrait, Skeleton } from '../components/ui';
import { HOME_PEOPLE, CATEGORY_IMAGE } from '../lib/homeImages';

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

/* The rotating word in the headline, by category slug (falls back to the lower-cased name). */
const WORD = {
  actors: 'actor',
  'singers-musicians': 'singer',
  'influencers-content-creators': 'creator',
  'athletes-sports-personalities': 'athlete',
  'tv-personalities': 'TV star',
  comedians: 'comedian',
  models: 'model',
  other: 'star',
};
const CAT_LABEL = {
  actors: 'Actors', 'singers-musicians': 'Singers & Musicians', 'influencers-content-creators': 'Influencers & Content Creators',
  'athletes-sports-personalities': 'Athletes & Sports', 'tv-personalities': 'TV Personalities', comedians: 'Comedians', models: 'Models', other: 'Icons',
};
/* Static faces: the hero never waits for the API. */
const PEOPLE = HOME_PEOPLE.map((p, i) => ({ ...p, celebrityId: `home-${i}`, categoryName: CAT_LABEL[p.category] }));
const SLOGANS = ['Vote for your favourites', 'Live rankings', 'Monthly winners', 'Every vote counts', 'Fan-powered results'];
const FALLBACK_WORDS = ['actor', 'singer', 'athlete', 'comedian', 'creator', 'model'];

/* Three vertical lanes for desktop: tile heights and speeds differ so the wall never looks like a grid. */
const LANES = [
  { reverse: false, speed: 26, h: ['h-60', 'h-80', 'h-56', 'h-72'] },
  { reverse: true, speed: 32, h: ['h-80', 'h-56', 'h-72', 'h-60'] },
  { reverse: false, speed: 29, h: ['h-56', 'h-72', 'h-60', 'h-80'] },
];

/* Category bento: where each tile sits (index = display order). */
const TILE_SPAN = {
  0: 'col-span-2 min-h-[210px] lg:row-span-2',
  3: 'lg:col-span-2',
  7: 'col-span-2 lg:col-span-1',
};

const STEPS = [
  { icon: MousePointerClick, title: 'Pick a category', text: 'Actors, singers, athletes, comedians and more. Each one has its own leaderboard.', preview: 'pick' },
  { icon: VoteIcon, title: 'Vote for your star', text: 'Swipe right or tap Vote. One vote per category, every month. You choose what to pay.', preview: 'vote' },
  { icon: Receipt, title: 'Keep your receipt', text: 'Every vote gets a receipt. Anyone can check it on the verify page.', preview: 'receipt' },
];

/* ------------------------------------------------------------------ */
/*  Motion helpers (requestAnimationFrame, paused when off-screen)     */
/* ------------------------------------------------------------------ */

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Runs `step(dtSeconds)` every frame while `el` is on screen and the tab is visible. */
function useFrame(ref, step, deps) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let raf = 0;
    let last = performance.now();
    let on = true;
    const tick = (now) => {
      const dt = Math.min(now - last, 64) / 1000;
      last = now;
      step(el, dt);
      raf = requestAnimationFrame(tick);
    };
    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => { on = e.isIntersecting; if (on) start(); else stop(); }, { rootMargin: '120px' }) : null;
    io?.observe(el.parentElement || el);
    start();
    return () => { stop(); io?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Endless scroller. Children must be rendered twice so the loop is seamless. */
function Loop({ axis = 'y', speed = 30, reverse = false, className = '', children }) {
  const ref = useRef(null);
  const off = useRef(0);
  useFrame(ref, (el, dt) => {
    const half = (axis === 'y' ? el.offsetHeight : el.offsetWidth) / 2;
    if (half <= 0) return;
    off.current = (off.current + (reverse ? -1 : 1) * speed * dt) % half;
    if (off.current < 0) off.current += half;
    el.style.transform = axis === 'y' ? `translate3d(0,${-off.current}px,0)` : `translate3d(${-off.current}px,0,0)`;
  }, [axis, speed, reverse]);
  return <div ref={ref} className={`${axis === 'y' ? 'flex flex-col' : 'flex w-max'} will-change-transform ${className}`}>{children}</div>;
}

/** Marquee that drifts on its own and also speeds up (or reverses) with page scroll. */
function ScrollLoop({ speed = 20, boost = 0.4, children }) {
  const ref = useRef(null);
  const st = useRef({ off: 0, vel: 0, y: typeof window === 'undefined' ? 0 : window.scrollY });
  useFrame(ref, (el, dt) => {
    const s = st.current;
    const y = window.scrollY;
    s.vel += (y - s.y - s.vel) * 0.15; /* smoothed scroll speed */
    s.y = y;
    const half = el.offsetWidth / 2;
    if (half <= 0) return;
    s.off = (s.off + speed * dt + s.vel * boost) % half;
    if (s.off < 0) s.off += half;
    el.style.transform = `translate3d(${-s.off}px,0,0)`;
  }, [speed, boost]);
  return <div ref={ref} className="flex w-max will-change-transform">{children}</div>;
}

/* ------------------------------------------------------------------ */
/*  Small building blocks                                              */
/* ------------------------------------------------------------------ */

function StatusPill({ camp, next, serverTime }) {
  const target = camp?.status === 'upcoming' ? camp.startsAt : camp?.status === 'active' ? camp.endsAt : next?.startsAt;
  const c = useCountdown(target, serverTime);
  if (!camp) return <Skeleton className="h-8 w-56 !rounded-full" />;
  const open = camp.status === 'active';
  const closed = !open && camp.status !== 'upcoming';
  const text = closed && next ? `Next round opens in ${c.days}d ${c.hours}h` : statusText(camp, c);
  return (
    <span role="timer" aria-label={text} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs font-semibold text-ink backdrop-blur-sm">
      <span className={`h-2 w-2 rounded-full ${open ? 'animate-pulse bg-mint' : 'bg-ink/40'}`} aria-hidden="true" />
      <span className="tnum">{text}</span>
    </span>
  );
}

/** Photo card (hero wall): the person's name and category sit tilted on the bottom edge. */
function Tile({ person, className = '' }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#26261f] to-[#0f0f0c] shadow-[0_18px_40px_-20px_rgba(30,50,10,.5)] ring-1 ring-ink/10 ${className}`}>
      <Portrait src={person.image} name={person.name} sizes="240px" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
      <span className="absolute bottom-3 left-3 right-2 block -rotate-[4deg] text-white">
      </span>
    </div>
  );
}

function SearchBox() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const res = useAsync(() => (dq.length >= 2 ? unwrap(api.get('/celebrities', { params: { q: dq, limit: 6 } })) : Promise.resolve(null)), [dq]);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink/45" aria-hidden="true" />
      <input type="search" enterKeyHint="search" className="input !pl-12" placeholder="Search for a celebrity" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search celebrities" />
      {dq.length >= 2 && (
        <div className="glass absolute inset-x-0 z-20 mt-2 overflow-hidden rounded-3xl shadow-sheet">
          {res.loading ? <div className="p-3"><Skeleton className="h-12" /></div>
            : res.data?.items?.length ? res.data.items.map((c) => (
              <Link key={c.id} to={`/celebrity/${c.slug || c.id}`} className="flex min-h-[64px] items-center gap-3 border-b border-line px-4 py-2 last:border-0 active:bg-ink/[.05]">
                <span className="h-12 w-10 shrink-0 overflow-hidden rounded-xl bg-sand"><Portrait src={c.image} name={c.name} sizes="48px" /></span>
                <span className="min-w-0"><span className="block truncate font-semibold">{c.name}</span><span className="block text-xs text-ink/60">{c.category?.name}</span></span>
              </Link>))
              : <div className="p-5 text-center text-[15px]"><p className="font-semibold">No one by that name yet</p><Link to="/nominate" className="btn-ghost mt-3">Nominate them</Link></div>}
        </div>
      )}
    </div>
  );
}

/** Live leaderboard: pick a category, see today's top three. */
function LiveBoard({ previews, loading }) {
  const [slug, setSlug] = useState(null);
  const active = previews.find((p) => p.category.slug === slug) || previews[0];
  return (
    <div className="stage rounded-[28px] p-4 shadow-lift sm:p-6" aria-label="Live leaderboard">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[14px] font-bold"><span className="h-2 w-2 animate-pulse rounded-full bg-mint" aria-hidden="true" />Live leaderboard</p>
        {active && <Link to={`/rankings?category=${active.category.slug}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink/75 hover:text-ink">Full ranking<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>}
      </div>
      <div className="hide-scroll fade-x -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6" role="tablist" aria-label="Category">
        {loading ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[42px] w-24 shrink-0 !rounded-full" />)
          : previews.map((p) => <button key={p.category.slug} type="button" role="tab" aria-selected={active?.category.slug === p.category.slug} onClick={() => setSlug(p.category.slug)} className="chip">{p.category.name}</button>)}
      </div>
      <div className="mt-5 min-h-[250px]">
        {loading ? <Skeleton className="h-[250px] w-full" />
          : active?.entries?.length ? <Podium entries={active.entries} />
          : <p className="py-16 text-center text-[15px] text-ink/70">No votes yet. Be the first.</p>}
      </div>
      {active && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-3 text-[13px] text-ink/70">
          <span><span className="font-bold text-ink tnum">{fmtNum(active.totalValidVotes)}</span> votes so far</span>
          <Link to={`/vote?category=${active.category.slug}`} className="btn-pop !min-h-[44px] !px-5">Vote in {active.category.name}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </div>
      )}
    </div>
  );
}

const Cell = ({ v, l }) => (
  <div className="flex-1 rounded-2xl border border-line bg-ink/[.05] px-2 py-3.5 text-center">
    <span className="font-heading block text-[32px] font-extrabold leading-none tnum sm:text-[40px]">{String(v).padStart(2, '0')}</span>
    <span className="font-mono mt-1.5 block text-[11px] uppercase tracking-wider text-ink/60">{l}</span>
  </div>
);

/** The deadline, big. Server-time driven, so a wrong phone clock cannot mislead. */
function Countdown({ camp, next, serverTime }) {
  const target = camp?.status === 'upcoming' ? camp.startsAt : camp?.status === 'active' ? camp.endsAt : next?.startsAt;
  const c = useCountdown(target, serverTime);
  const title = camp?.status === 'active' ? 'Voting closes in' : camp?.status === 'upcoming' ? 'Voting opens in' : next ? 'Next round opens in' : 'Voting has closed';
  return (
    <div role="timer" aria-label={title}>
      <p className="font-mono text-[11px] uppercase tracking-[.18em] text-brand">{title}</p>
      {target ? (
        <div className="mt-3 flex gap-2 sm:gap-3">
          <Cell v={c.days} l="days" /><Cell v={c.hours} l="hours" /><Cell v={c.minutes} l="min" /><Cell v={c.seconds} l="sec" />
        </div>) : <Skeleton className="mt-3 h-20" />}
    </div>
  );
}

/** One category tile: the leader's photo, who leads, and whether you have voted. */
function CategoryTile({ p, voted, className = '', big }) {
  const lead = p.entries?.[0];
  const has = lead && lead.votes > 0;
  return (
    <Link to={`/vote?category=${p.category.slug}`} className={`group relative isolate flex min-h-[108px] overflow-hidden lg:min-h-[150px] rounded-3xl border border-line bg-surface text-ink ring-1 ring-line transition duration-300 hover:-translate-y-1 hover:ring-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${className}`}>
      {(CATEGORY_IMAGE[p.category.slug] || lead?.image) && <span className={`absolute inset-y-0 right-0 -z-20 block [mask-image:linear-gradient(to_right,transparent,#000_38%)] [-webkit-mask-image:linear-gradient(to_right,transparent,#000_38%)] ${big ? 'w-[62%] lg:w-[48%]' : className.includes('lg:col-span-2') ? 'w-[62%] lg:w-[36%]' : 'w-[62%]'}`}><Portrait src={CATEGORY_IMAGE[p.category.slug] || lead?.image} name="" sizes={big ? '(min-width:1024px) 30vw, 70vw' : '(min-width:1024px) 20vw, 40vw'} className="transition duration-500 group-hover:scale-105" /></span>}
      <span className="absolute inset-0 -z-10 bg-gradient-to-t from-surface/90 via-surface/10 to-transparent" aria-hidden="true" />
      {voted && <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-mint px-2.5 py-1 text-[11.5px] font-bold text-[#0f2a1e]"><Check className="h-3 w-3" strokeWidth={3.5} aria-hidden="true" />Voted</span>}
      <span className="mt-auto block w-full min-w-0 max-w-[78%] p-2.5 sm:p-5">
        <span className={`mb-1 grid place-items-center rounded-xl bg-brand text-on transition-transform duration-300 group-hover:scale-105 sm:mb-2 ${big ? 'h-9 w-9 sm:h-12 sm:w-12' : 'h-8 w-8 sm:h-9 sm:w-9'}`}><CategoryIcon name={p.category.icon} className={big ? 'h-6 w-6' : 'h-[18px] w-[18px]'} /></span>
        <span className={`block font-heading font-extrabold leading-tight [text-wrap:balance] ${big ? 'text-[18px] sm:text-4xl' : 'text-[15px] sm:text-xl'}`}>{p.category.name}</span>
        <span className="mt-1 block truncate text-[12.5px] text-ink/70">{has ? `${lead.name} leads` : 'No votes yet'}</span>
        <span className="mt-1 hidden items-center gap-1 text-xs font-bold text-gold sm:inline-flex">Vote<ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" /></span>
      </span>
    </Link>
  );
}

/** Small previews used in the step cards (decorative). */
function StepPreview({ kind, lo, hi, lead }) {
  const box = 'rounded-2xl border border-line bg-paper/60 p-4 shadow-lg';
  if (kind === 'pick') {
    return (
      <div className={box} aria-hidden="true">
        <div className="flex flex-wrap gap-1.5">
          {['Actors', 'Singers', 'Athletes', 'Comedians'].map((t, i) => <span key={t} className={`rounded-full px-3 py-1.5 text-xs font-bold ${i === 0 ? 'bg-brand text-on' : 'bg-ink/10 text-ink/75'}`}>{t}</span>)}
        </div>
        <p className="font-mono mt-4 text-[11px] text-ink/60">8 leaderboards</p>
      </div>
    );
  }
  if (kind === 'vote') {
    return (
      <div className={`${box} flex items-center gap-3`} aria-hidden="true">
        <span className="h-16 w-[52px] shrink-0 overflow-hidden rounded-xl bg-sand"><Portrait src={lead?.image} name={lead?.name || ''} sizes="64px" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{lead?.name || 'Your favourite'}</p>
          <p className="font-mono mt-0.5 text-[11px] text-ink/60">₹{lo} to ₹{hi} per vote</p>
        </div>
        <span className="rounded-xl bg-brand px-3 py-2 text-xs font-bold text-on">Vote</span>
      </div>
    );
  }
  return (
    <div className={box} aria-hidden="true">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="serif-accent text-base !text-ink">Vote receipt</p>
          <p className="font-mono mt-1 text-[11px] text-ink/60">FV-2026-000123</p>
        </div>
        <ShieldCheck className="h-7 w-7 shrink-0 text-brand" />
      </div>
      <span className="stamp mt-3 !px-2.5 !py-0.5 !text-[12px]"><Check className="h-3.5 w-3.5" strokeWidth={3.5} />VOTE COUNTED</span>
    </div>
  );
}

/* ----------------------------------- page ----------------------------------- */

export default function Home() {
  const { meta, user } = useAuth();
  const cats = useAsync(() => unwrap(api.get('/categories')), [], { key: 'categories', ttl: 300000 });
  const home = useAsync(() => unwrap(api.get('/rankings/home')), [], { key: 'rankings/home', ttl: 15000 });
  const me = useAsync(() => (user ? unwrap(api.get('/me/dashboard')) : Promise.resolve(null)), [user?.id], { key: `me/dashboard:${user?.id || 'guest'}`, ttl: 10000 });
  const winners = useAsync(() => unwrap(api.get('/winners')), [], { key: 'winners', ttl: 60000 });

  const previews = useMemo(() => (home.data?.previews || []).filter((p) => p.category), [home.data]);
  const trending = home.data?.trending || [];
  const camp = meta?.campaign;
  const open = camp?.status === 'active';
  const remaining = new Set((me.data?.thisMonth?.categoriesRemaining || []).map((c) => c.id));
  const idBySlug = new Map((cats.data?.categories || []).map((c) => [c.slug, c.id]));
  const isVoted = (slug) => !!me.data && !!idBySlug.get(slug) && !remaining.has(idBySlug.get(slug));
  const total = previews.length;
  const votedCount = me.data ? previews.filter((p) => isVoted(p.category.slug)).length : 0;
  const nextUp = previews.find((p) => !isVoted(p.category.slug)) || previews[0];
  const [lo, hi] = meta?.amountRangeInr || [0, 7];
  const latest = winners.data?.campaigns?.[0];
  const votes = previews.reduce((n, p) => n + (p.totalValidVotes || 0), 0);

  /* rotating headline word + the photo behind it on phones */
  const [w, setW] = useState(0);
  const words = useMemo(() => {
    const list = previews.map((p) => ({ word: WORD[p.category.slug] || p.category.name.toLowerCase(), image: p.entries?.find((e) => e.image)?.image })).filter((x) => x.word);
    return list.length >= 3 ? list : FALLBACK_WORDS.map((word) => ({ word, image: null }));
  }, [previews]);
  useEffect(() => {
    if (reducedMotion()) return undefined;
    const t = setInterval(() => setW((i) => i + 1), 2400);
    return () => clearInterval(t);
  }, []);
  const word = words[w % words.length];

  /* faces for the hero wall, the steps and the nominate card: static, so they paint immediately */
  const people = PEOPLE;
  const lanes = useMemo(() => LANES.map((lane, li) => ({ ...lane, idx: Array.from({ length: 4 }, (_, i) => people[(li * 4 + i) % people.length]) })), [people]);
  const cols = useMemo(() => Array.from({ length: 4 }, (_, ci) => Array.from({ length: 4 }, (_, i) => people[(ci * 4 + i + (ci % 2) * 2) % people.length])), [people]);
  const names = people.slice(0, 8).map((p) => p.name);
  const faces = people.slice(0, 3);

  const box = 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8';
  const startHref = open ? (user && nextUp ? `/vote?category=${nextUp.category.slug}` : '/register') : '/rankings';
  const startText = open ? (user ? (votedCount > 0 && votedCount < total ? 'Keep voting' : 'Start voting') : 'Join free and vote') : 'See rankings';

  return (
    <div>
      {/* =====================================================
          HERO (always dark; all the motion lives here)
      ===================================================== */}
      <section className="dark-scope relative isolate flex min-h-[calc(100svh-4rem-5.5rem-env(safe-area-inset-bottom))] flex-col overflow-hidden sm:min-h-[calc(100svh-4.5rem-5.5rem-env(safe-area-inset-bottom))] lg:h-[100svh] lg:min-h-[600px]" aria-label="Vote for your favourite stars">
        <div className="hm-grid pointer-events-none absolute inset-0 z-0" aria-hidden="true" />
        <div className="pointer-events-none absolute -left-24 top-0 z-0 h-80 w-80 animate-drift rounded-full bg-brand/20 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-24 bottom-0 z-0 h-96 w-96 animate-drift rounded-full bg-gold/10 blur-3xl [animation-direction:reverse] [animation-duration:18s]" aria-hidden="true" />

        {/* Phones and tablets: a tilted wall of cards that keeps scrolling behind the text */}
        <div className="hm-vfade-b pointer-events-none absolute inset-x-0 top-0 z-0 h-[64%] overflow-hidden lg:hidden" aria-hidden="true">
          <div className="absolute -left-[14%] -top-[8%] grid h-[124%] w-[128%] -rotate-[8deg] grid-cols-4 grid-rows-[minmax(0,1fr)] gap-3 sm:gap-5">
            {cols.map((col, ci) => (
              <div key={ci} className="min-h-0 overflow-hidden">
                <Loop axis="y" speed={ci % 2 ? 22 : 28} reverse={ci % 2 === 1}>
                  {[...col, ...col].map((person, i) => (
                    <div key={i} className="pb-3 sm:pb-5"><Tile person={{ ...person, categoryName: '' }} className="aspect-[3/4]" /></div>
                  ))}
                </Loop>
              </div>
            ))}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-transparent from-[28%] via-paper/80 via-[58%] to-paper lg:hidden" aria-hidden="true" />

        {/* Desktop: photo wall pinned to the right edge and bleeding off-screen */}
        <div className="pointer-events-none absolute inset-x-0 top-0 bottom-0 z-0 hidden lg:block" aria-hidden="true">
          <div className="hm-vfade absolute inset-y-0 left-[44%] right-0">
            <div className="relative -my-[4%] mx-auto grid h-[108%] w-[84%] -rotate-[7deg] grid-cols-3 grid-rows-[minmax(0,1fr)] gap-3 xl:gap-5">
              {lanes.map(({ idx, reverse, speed, h }, li) => (
                <div key={li} className="min-h-0 overflow-hidden">
                  <Loop axis="y" speed={speed} reverse={reverse}>
                    {[...idx, ...idx].map((person, i) => (
                      <div key={i} className="pb-3 xl:pb-5"><Tile person={person} className={h[i % idx.length]} /></div>
                    ))}
                  </Loop>
                </div>
              ))}
            </div>
            <div className="hm-blur-top absolute inset-x-0 top-0 h-16 backdrop-blur-[2px]" />
            <div className="hm-blur-bottom absolute inset-x-0 bottom-0 h-16 backdrop-blur-[2px]" />
          </div>
        </div>

        <div className={`${box} relative z-10 mt-auto grid min-h-0 w-full flex-1 items-end gap-5 pb-4 pt-[22svh] sm:gap-8 sm:pt-[26svh] lg:mt-0 lg:grid-cols-[.85fr_1.15fr] lg:items-center lg:py-4 lg:pt-24`}>
          {/* ---- phone / tablet copy ---- */}
          <div className="hm-in min-w-0 pt-4 lg:pt-0 lg:hidden">
            <StatusPill camp={camp} next={meta?.nextCampaign} serverTime={meta?.serverTime} />
            <h1 className="mt-2 text-[clamp(2.1rem,9.5vw,3.25rem)] font-extrabold leading-[1.02] sm:mt-4 sm:text-[clamp(2.5rem,5.5vw+2svh,5.25rem)] sm:leading-[1.02] [text-shadow:0_2px_14px_rgb(var(--paper)/.6)]">
              Vote for your
              <br />
              favourite <span className="hm-word serif-accent">star</span>
            </h1>
            <p className="mt-3 max-w-[34ch] text-[14px] font-medium leading-[1.35rem] text-ink/85 sm:max-w-md [text-shadow:0_1px_8px_rgb(var(--paper)/.6)] sm:mt-5 sm:text-lg sm:leading-7">
              One vote per category, every month. Watch the rankings move live and keep a receipt for every vote.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 sm:mt-8 sm:gap-x-6 sm:gap-y-3">
              <Link to={startHref} className="btn-pop !min-h-10 px-5 text-sm sm:!min-h-12 sm:px-7 sm:text-base">{startText}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              <Link to="/rankings" className="group inline-flex min-h-10 items-center gap-2 text-sm font-bold text-ink sm:min-h-12">
                <span className="border-b border-ink/30 pb-0.5 group-hover:border-brand">View rankings</span>
                <ArrowRight className="h-4 w-4 text-brand transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </div>
          </div>

          {/* ---- desktop copy ---- */}
          <div className="hm-in hidden min-w-0 lg:block">
            <StatusPill camp={camp} next={meta?.nextCampaign} serverTime={meta?.serverTime} />
            <p className="eyebrow mt-7">The people decide</p>
            <h1 className="mt-3 text-[clamp(2.6rem,3.7vw+1.3svh,5rem)] font-extrabold leading-[1.02] tracking-[-0.04em]">
              Your<br />most favourite<br />stars.<br /><span className="serif-accent">Your vote.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg leading-7 text-ink/75">Vote for the people you love, follow the live rankings and see who takes the crown each month.</p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to={startHref} className="btn-pop !min-h-12 !rounded-full px-7">{open && !user ? 'Join and vote' : startText}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              <Link to="/rankings" className="btn-ghost !min-h-12 !rounded-full px-7">See the rankings</Link>
            </div>
            <p className="mt-6 flex items-center gap-5 text-[13.5px] text-ink/65">
              <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-mint" aria-hidden="true" />Live monthly rankings</span>
              {votes > 0 && <span><b className="font-semibold text-ink tnum">{fmtNum(votes)}</b> votes this round</span>}
            </p>
          </div>
        </div>

      </section>

      {/* =====================================================
          MARQUEE (drifts on its own, speeds up / reverses with page scroll)
      ===================================================== */}
      <div className="-mt-3 -rotate-[1.2deg] overflow-hidden bg-brand py-2.5 text-on sm:py-3.5 lg:-mt-4" aria-hidden="true">
        <ScrollLoop speed={40}>
          {[...SLOGANS, ...SLOGANS, ...SLOGANS, ...SLOGANS].map((t, i) => (
            <span key={i} className="font-heading mx-4 flex items-center gap-6 whitespace-nowrap text-[20px] font-extrabold tracking-[-0.03em] sm:mx-6 sm:gap-12 sm:text-[28px]">{t}<span className="text-[.8em]">✳</span></span>
          ))}
        </ScrollLoop>
      </div>

      {/* =====================================================
          LIVE LEADERBOARD + COUNTDOWN
      ===================================================== */}
      <section className={`${box} py-10 sm:py-20`} aria-labelledby="live">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] lg:gap-14">
          <div>
            <h2 id="live" className="text-[1.7rem] font-extrabold leading-tight sm:text-4xl lg:text-5xl">
              Who is winning <span className="serif-accent">right now</span>
            </h2>
            <p className="mt-2 max-w-md text-sm text-ink/65 sm:mt-4 sm:text-base">Every category has its own live top three. Votes are counted until the end of the second-last day; the last day is results day.</p>
            <div className="mt-6"><Countdown camp={camp} next={meta?.nextCampaign} serverTime={meta?.serverTime} /></div>
            <Link to={startHref} className="btn-pop mt-6 w-full sm:w-auto">{startText}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </div>
          <LiveBoard previews={previews} loading={home.loading} />
        </div>
      </section>

      {/* =====================================================
          PICK A CATEGORY
      ===================================================== */}
      <section className={`${box} pb-6 sm:pb-20`} aria-labelledby="cats">
        <div className="flex flex-wrap items-end justify-between gap-2 sm:gap-4">
          <div>
            <h2 id="cats" className="max-w-xl text-[1.7rem] font-extrabold leading-tight sm:text-4xl lg:text-5xl">
              Whose side are <span className="serif-accent">you on?</span>
            </h2>
            <p className="mt-1 text-sm text-ink/65 sm:mt-2">Tap a tile to see the nominees and cast your vote.</p>
          </div>
          <div className="w-full sm:w-80"><SearchBox /></div>
        </div>

        <div className="mt-4 sm:mt-8">
          {home.loading ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[150px] !rounded-3xl" />)}</div>
            : home.error ? <p role="alert" className="py-8 text-[15px]">Could not load categories. <button className="font-semibold underline" onClick={home.reload}>Try again</button></p>
            : <div className="grid grid-cols-2 gap-2.5 sm:gap-4 max-lg:auto-rows-[108px] lg:auto-rows-[150px] lg:grid-cols-4">{previews.map((p, i) => <CategoryTile key={p.category.slug} p={p} big={i === 0} voted={isVoted(p.category.slug)} className={TILE_SPAN[i] || ''} />)}</div>}
        </div>
      </section>

      {/* =====================================================
          HOW VOTING WORKS
      ===================================================== */}
      <section className="band py-6 sm:py-20" aria-labelledby="how">
        <div className={box}>
          <div className="max-w-2xl">
            <h2 id="how" className="text-[1.7rem] font-extrabold leading-tight sm:text-4xl lg:text-5xl">From pick to <span className="serif-accent">receipt</span></h2>
            <p className="mt-1 hidden max-w-xl text-sm leading-6 text-ink/65 sm:mt-4 sm:block sm:text-base">Three steps. Every rule is enforced on the server, not in your browser.</p>
          </div>

          <div className="mt-3 grid gap-2 sm:mt-10 sm:gap-3 md:grid-cols-3 md:gap-5">
            {STEPS.map(({ icon: Icon, title, text, preview }, i) => (
              <article key={title} className="card flex flex-col p-3 sm:p-6">
                <div className="flex items-center gap-3 md:block md:items-start">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand text-on sm:h-12 sm:w-12"><Icon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" /></span>
                  <div className="min-w-0 md:mt-5">
                    <p className="font-mono text-[11px] text-brand">Step {i + 1} of {STEPS.length}</p>
                    <h3 className="text-base font-extrabold leading-tight sm:mt-0.5 sm:text-2xl">{title}</h3>
                    <p className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-ink/65 sm:mt-1 sm:line-clamp-none sm:text-sm sm:leading-6">{text}</p>
                  </div>
                </div>
                <div className="mt-auto hidden pt-6 md:block"><StepPreview kind={preview} lo={lo} hi={hi} lead={people[0]} /></div>
              </article>
            ))}
          </div>

          <p className="mt-3 flex items-start gap-3 rounded-2xl border border-line bg-ink/[.04] p-3 text-[13px] leading-5 sm:p-4 sm:text-sm sm:leading-6 text-ink/75 sm:mt-8 sm:items-center">
            <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-gold sm:mt-0" aria-hidden="true" />
            <span><b className="font-bold text-ink">Pay what you like, ₹{lo} to ₹{hi}.</b> Free is ₹{lo}. Every vote counts the same, free or paid.</span>
          </p>
        </div>
      </section>

      {/* =====================================================
          WINNERS + NOMINATE
      ===================================================== */}
      <section className={`${box} py-6 sm:py-20`} aria-label="Winners and nominations">
        <div className="nom grid overflow-hidden rounded-3xl bg-brand text-on md:grid-cols-2">
          <div className="p-4 sm:p-10 lg:p-14">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-paper sm:h-12 sm:w-12"><Sparkles className="h-6 w-6" aria-hidden="true" /></span>
            <h2 className="mt-3 text-[1.5rem] font-extrabold leading-tight sm:mt-6 sm:text-4xl lg:text-5xl">Can't find your star?</h2>
            <p className="mt-2 text-sm leading-6 opacity-90 sm:mt-3 sm:text-base sm:leading-7">Nominate them for the next round, or see who took the crown last time.</p>
            <ul className="mt-3 space-y-1.5 sm:mt-6 sm:space-y-3">
              {['Anyone can nominate, free', 'Eight categories, India and state rankings', 'Winners are final and published'].map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm font-semibold"><Check className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-ink p-1 text-paper" aria-hidden="true" />{t}</li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2 sm:mt-8 sm:gap-3">
              <Link to="/nominate" className="btn-light !min-h-12">Nominate someone<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              {latest && <Link to={`/winners?campaign=${latest.key}`} className="btn !min-h-12 border border-on/40 bg-transparent text-on hover:bg-black/10"><Trophy className="h-4 w-4" aria-hidden="true" />{latest.title.replace(' Campaign', '')} winners</Link>}
            </div>
          </div>

          <div className="nom-art relative min-h-[150px] overflow-hidden bg-[#1a1c0c] md:min-h-[230px] md:min-h-full" aria-hidden="true">
            <div className="absolute inset-0 flex items-center justify-center">
              {people.slice(0, 3).map((e, i) => (
                <span key={e.celebrityId} className="absolute block h-[118px] w-[92px] overflow-hidden rounded-2xl border border-white/20 bg-sand shadow-lift sm:h-[250px] sm:w-[190px] sm:rounded-3xl"
                  style={{ transform: `translateX(${(i - 1) * 78}px) rotate(${(i - 1) * 7}deg) translateY(${i === 1 ? 0 : 14}px)`, zIndex: i === 1 ? 3 : 1 }}>
                  <Portrait src={e.image} name={e.name} sizes="200px" />
                </span>
              ))}
            </div>
            <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper shadow-xl">
              <span className="h-2 w-2 animate-pulse rounded-full bg-mint" />{open ? 'Voting is open' : 'Rankings are live'}
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================
          FINAL CTA
      ===================================================== */}
      <section className={`${box} pb-12 sm:pb-24`} aria-label="Start voting">
        <div className="card relative overflow-hidden p-5 sm:p-10">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full border-[40px] border-brand/10" aria-hidden="true" />
          <div className="relative grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-8">
            <div>
              <h2 className="text-[1.7rem] font-extrabold leading-tight sm:text-4xl lg:text-5xl">Your vote decides <span className="serif-accent">who wins.</span></h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-ink/70 sm:mt-3 sm:text-base">It takes under a minute to join. Pick your favourite in each category and get your receipt.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link to={startHref} className="btn-pop !min-h-[54px] px-8 text-[16px]">{startText}<ArrowRight className="h-5 w-5" aria-hidden="true" /></Link>
              <Link to="/how-it-works" className="btn-ghost !min-h-[54px] px-8 text-[16px]">How it works</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
