import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Inbox, Laugh, Mic, Sparkles, Star, Trophy, Tv, Users2, X } from 'lucide-react';
import { img, imgSet, imgTiny } from '../lib/api';
import { useCountdown } from '../lib/hooks';

/* ----------------------------- loading / empty / error ----------------------------- */

export const Skeleton = ({ className = 'h-24' }) => (
  <div className={`skeleton ${className}`} aria-hidden="true" />
);

export const SkeletonGrid = ({ n = 6, className = 'aspect-[4/5]' }) => (
  <div
    className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4"
    aria-busy="true"
    aria-label="Loading"
  >
    {Array.from({ length: n }, (_, i) => (
      <div key={i}>
        <Skeleton className={`${className} !rounded-2xl`} />
        <Skeleton className="mt-3 h-4 w-2/3 !rounded-md" />
      </div>
    ))}
  </div>
);

export const SkeletonRows = ({ n = 6 }) => (
  <div className="divide-y divide-line" aria-busy="true" aria-label="Loading">
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className="flex items-center gap-3 py-3.5">
        <Skeleton className="h-6 w-7 !rounded-md" />
        <Skeleton className="h-11 w-11 !rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3 !rounded-md" />
          <Skeleton className="h-1 w-full !rounded-full" />
        </div>
      </div>
    ))}
  </div>
);

export function ErrorState({ message, onRetry }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 card px-6 py-10 text-center"
    >
      <AlertTriangle
        className="h-7 w-7 text-brand"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <p className="max-w-xs text-[15px] text-ink/80">
        {message || 'Something went wrong.'}
      </p>
      {onRetry && (
        <button className="btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, text, action }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-6 py-10 text-center">
      <Inbox
        className="h-7 w-7 text-ink/40"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <h3 className="mt-1 text-base font-bold">{title}</h3>
      {text && <p className="max-w-xs text-[15px] text-ink/65">{text}</p>}
      {action}
    </div>
  );
}

export const PageTitle = ({ title, sub, children }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0 max-w-2xl">
      <h1 className="text-[28px] font-bold leading-tight text-ink sm:text-4xl">
        {title}
      </h1>
      {sub && <p className="mt-2.5 max-w-prose text-[15px] text-ink/65">{sub}</p>}
    </div>
    {children}
  </div>
);

export const SectionHead = ({ title, sub, to, link }) => (
  <div className="mb-3 flex items-end justify-between gap-3 border-b border-line pb-3">
    <div>
      <h2 className="text-xl font-bold leading-tight">{title}</h2>
      {sub && <p className="mt-0.5 text-[13px] text-ink/60">{sub}</p>}
    </div>
    {to && (
      <Link
        to={to}
        className="inline-flex min-h-[40px] shrink-0 items-center gap-0.5 text-sm font-semibold text-brand"
      >
        {link || 'See all'}
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    )}
  </div>
);

/** Kept for call-sites: content simply renders; no decorative entrance animation. */
export function Reveal({ children, className = '', as: T = 'div', delay, ...rest }) {
  return <T className={className} {...rest}>{children}</T>;
}

/* ----------------------------- categories ----------------------------- */

const ICONS = {
  clapperboard: Clapperboard,
  mic: Mic,
  sparkles: Sparkles,
  trophy: Trophy,
  tv: Tv,
  laugh: Laugh,
  camera: Camera,
  star: Star,
};

export const CategoryIcon = ({ name, className = 'h-5 w-5' }) => {
  const I = ICONS[name] || Star;
  return <I className={className} strokeWidth={1.75} aria-hidden="true" />;
};

/** A row in the category index. Shows who leads right now. */
export function CategoryCard({ category, to, leader, voted }) {
  return (
    <Link
      to={to}
      className="flex min-h-[68px] items-center gap-3.5 py-3 transition active:bg-ink/[.03]"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-ink/15 bg-surface text-ink">
        <CategoryIcon name={category.icon} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-bold leading-tight">
          {category.name}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-ink/55">
          {leader?.votes > 0 ? (
            <>
              Leading: <span className="font-semibold text-ink/80">{leader.name}</span>
            </>
          ) : (
            category.description || 'Cast the first vote'
          )}
        </span>
      </span>

      {voted && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-mint">
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
          Voted
        </span>
      )}

      <ChevronRight className="h-4 w-4 shrink-0 text-ink/35" aria-hidden="true" />
    </Link>
  );
}

/* ----------------------------- portraits & cards ----------------------------- */

const hash = (s = '') =>
  [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);

export function Portrait({ src, name, className = '', eager = false, sizes = '(min-width:1024px) 220px, (min-width:640px) 30vw, 46vw' }) {
  const initials = name?.split(' ').map((w) => w[0]).slice(0, 2).join('');

  return src ? (
    <img
      src={img(src, 360)}
      srcSet={imgSet(src)}
      sizes={sizes}
      alt={name}
      style={imgTiny(src) ? { backgroundImage: `url(${imgTiny(src)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      loading={eager ? 'eager' : 'lazy'}
      fetchpriority={eager ? 'high' : undefined}
      decoding="async"
      draggable="false"
      className={`h-full w-full object-cover object-[50%_16%] ${className}`}
    />
  ) : (
    <div role="img" aria-label={name} className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-brand/30 to-gold/20 ${className}`}>
      <span className="font-semibold text-ink/60" style={{ fontSize: 'clamp(20px, 34%, 52px)' }}>{initials}</span>
    </div>
  );
}

/** Portrait card. With onVote the whole card opens the vote sheet and shows a clear "Vote" pill. */
export function CelebrityCard({ celeb, rank, votes, onVote, voted, disabled, className = '' }) {
  const inner = (
    <>
      <div className={`relative aspect-[3/4] overflow-hidden rounded-3xl bg-sand transition duration-300 group-hover:-translate-y-0.5 ${voted ? 'ring-2 ring-brand ring-offset-2 ring-offset-paper' : ''}`}>
        <Portrait src={celeb.image} name={celeb.name} className="transition duration-500 group-hover:scale-[1.05]" />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/75 to-transparent" aria-hidden="true" />
        {rank != null && <span className="absolute left-2.5 top-2.5 grid h-8 min-w-8 place-items-center rounded-full bg-black/55 px-2 text-sm font-bold text-white backdrop-blur tnum">{rank}</span>}
        {voted ? (
          <span className="absolute inset-x-2.5 bottom-2.5 flex items-center justify-center gap-1 rounded-full bg-brand py-2 text-[13px] font-semibold text-on"><Check className="h-4 w-4" strokeWidth={3} />Your pick</span>
        ) : onVote && !disabled ? (
          <span className="absolute inset-x-2.5 bottom-2.5 flex items-center justify-center gap-1.5 rounded-full bg-white/95 py-2 text-[13px] font-semibold text-[#1a1c0c] transition group-hover:bg-brand group-hover:text-on group-active:scale-95"><Check className="h-4 w-4" strokeWidth={3} />Vote</span>
        ) : null}
      </div>
      <span className="mt-2.5 block truncate text-[15.5px] font-semibold leading-tight">{celeb.name}</span>
      <p className="mt-0.5 truncate text-[13px] text-ink/60">{votes != null ? `${votes.toLocaleString('en-IN')} votes` : celeb.category?.name}</p>
    </>
  );

  const cls = `group block w-full text-left transition active:scale-[.985] ${disabled && !voted ? 'opacity-50' : ''} ${className}`;

  return onVote ? (
    <button type="button" className={cls} onClick={() => onVote(celeb)} disabled={disabled && !voted} aria-label={`${voted ? 'Your pick: ' : 'Vote for '}${celeb.name}`}>
      {inner}
    </button>
  ) : (
    <Link to={`/celebrity/${celeb.slug || celeb.id}`} className={cls}>
      {inner}
    </Link>
  );
}

/* ----------------------------- the top three ----------------------------- */

/**
 * The podium: three portrait cards with the name and votes on the photo, each standing on a rank plinth.
 * Rank 1 is in the middle, taller, with a gold ring and a gold marker above it.
 */
const STEP = { 1: 'h-[60px] sm:h-[84px]', 2: 'h-[44px] sm:h-[60px]', 3: 'h-[32px] sm:h-[44px]' };

/** Podium: three portraits, names underneath, and clean rank steps. Colours come from theme variables so it works in light and dark. */
export function Podium({ entries }) {
  const top = (entries || []).slice(0, 3);
  if (!top.length) return null;
  const order = top.length === 1 ? [top[0]] : top.length === 2 ? [top[1], top[0]] : [top[1], top[0], top[2]];

  return (
    <ol className="mx-auto flex max-w-[500px] items-end justify-center gap-2 sm:gap-3" aria-label="Current top three">
      {order.map((e) => {
        const rank = top.indexOf(e) + 1;
        const first = rank === 1;
        return (
          <li key={e.celebrityId} className={`animate-rise flex min-w-0 flex-col items-center ${first ? 'w-[36%]' : 'w-[30%]'}`} style={{ animationDelay: `${(rank - 1) * 0.08}s` }}>
            <Link to={`/celebrity/${e.slug || e.celebrityId}`} className="group block w-full">
              <span className={`pd-photo pd-photo-${rank} relative block aspect-[3/4] w-full overflow-hidden rounded-2xl bg-sand`}>
                <Portrait eager sizes="(min-width:640px) 180px, 34vw" src={e.image} name={e.name} className="transition duration-500 group-hover:scale-105" />
                {first && <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-gold text-white shadow sm:h-7 sm:w-7" aria-label="Rank 1"><Star className="h-3.5 w-3.5 fill-current" strokeWidth={1.8} aria-hidden="true" /></span>}
              </span>
              <span className="mt-2 block px-0.5 text-center">
                <span className={`line-clamp-2 block min-h-[2.4em] break-words font-bold leading-[1.2] text-ink ${first ? 'text-[13px] sm:text-[15px]' : 'text-[12px] sm:text-[13.5px]'}`}>{e.name}</span>
                <span className="mt-0.5 block truncate text-[11px] font-medium text-ink/65 tnum sm:text-[12.5px]">{e.votes > 0 ? `${e.votes.toLocaleString('en-IN')} votes` : 'No votes yet'}</span>
              </span>
            </Link>
            <span className={`pd-step pd-step-${rank} mt-2 grid w-full place-items-center rounded-t-xl ${STEP[rank]}`}>
              <span className="font-heading text-[24px] font-extrabold leading-none tnum sm:text-[32px]">{rank}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ----------------------------- countdown, badges ----------------------------- */

const pad = (n) => String(n).padStart(2, '0');

export function Countdown({ target, serverTime, label }) {
  const c = useCountdown(target, serverTime);

  const cell = (v, l) => (
    <div className="flex flex-1 flex-col items-center py-2.5">
      <span className="text-[34px] font-bold leading-none text-ink tnum">
        {pad(v)}
      </span>
      <span className="mt-1 text-[11px] text-ink/55">{l}</span>
    </div>
  );

  return (
    <div role="timer" aria-label={label}>
      {label && <p className="mb-2 text-sm font-medium text-ink/70">{label}</p>}
      <div className="flex divide-x divide-line card !rounded-2xl">
        {cell(c.days, 'days')}
        {cell(c.hours, 'hours')}
        {cell(c.minutes, 'min')}
        {cell(c.seconds, 'sec')}
      </div>
    </div>
  );
}

export function CampaignBadge({ campaign }) {
  const map = {
    active: ['bg-mint-soft text-mint', 'bg-mint', 'Voting open'],
    upcoming: ['bg-sand text-ink', 'bg-ink/50', 'Opens soon'],
    closed: ['bg-ink/[.07] text-ink/70', 'bg-ink/40', 'Voting closed'],
    finalized: ['bg-sand text-ink', 'bg-brand', 'Final results'],
  };

  const [cls, dot, text] = map[campaign?.status] || map.closed;

  return (
    <span className={`badge ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {text}
    </span>
  );
}

/* ----------------------------- form bits ----------------------------- */

const FALLBACK_STATES = [
  ['AP', 'Andhra Pradesh'],
  ['AR', 'Arunachal Pradesh'],
  ['AS', 'Assam'],
  ['BR', 'Bihar'],
  ['CG', 'Chhattisgarh'],
  ['GA', 'Goa'],
  ['GJ', 'Gujarat'],
  ['HR', 'Haryana'],
  ['HP', 'Himachal Pradesh'],
  ['JH', 'Jharkhand'],
  ['KA', 'Karnataka'],
  ['KL', 'Kerala'],
  ['MP', 'Madhya Pradesh'],
  ['MH', 'Maharashtra'],
  ['MN', 'Manipur'],
  ['ML', 'Meghalaya'],
  ['MZ', 'Mizoram'],
  ['NL', 'Nagaland'],
  ['OD', 'Odisha'],
  ['PB', 'Punjab'],
  ['RJ', 'Rajasthan'],
  ['SK', 'Sikkim'],
  ['TN', 'Tamil Nadu'],
  ['TS', 'Telangana'],
  ['TR', 'Tripura'],
  ['UP', 'Uttar Pradesh'],
  ['UK', 'Uttarakhand'],
  ['WB', 'West Bengal'],
  ['AN', 'Andaman and Nicobar Islands'],
  ['CH', 'Chandigarh'],
  ['DN', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['DL', 'Delhi'],
  ['JK', 'Jammu and Kashmir'],
  ['LA', 'Ladakh'],
  ['LD', 'Lakshadweep'],
  ['PY', 'Puducherry'],
].map(([code, name]) => ({ code, name }));

const UNION_TERRITORY_CODES = new Set(['AN', 'CH', 'DN', 'DL', 'JK', 'LA', 'LD', 'PY']);

export const StateSelect = ({
  states,
  value,
  onChange,
  id = 'state',
  allLabel,
  required,
  disabled = false,
}) => {
  // Keep the selector usable during slow metadata requests or temporary API outages.
  const choices = (Array.isArray(states) && states.length ? states : FALLBACK_STATES)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const stateChoices = choices.filter((s) => !UNION_TERRITORY_CODES.has(s.code));
  const territoryChoices = choices.filter((s) => UNION_TERRITORY_CODES.has(s.code));

  return (
    <div className="relative w-full">
      <select
        id={id}
        className="input min-h-[52px] appearance-none pr-11 text-left"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        aria-label="State or union territory"
      >
        <option value="">{allLabel || 'Choose your state / UT'}</option>
        <optgroup label="States">
          {stateChoices.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Union territories">
          {territoryChoices.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </optgroup>
      </select>

      <ChevronDown
        className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/55"
        aria-hidden="true"
      />
    </div>
  );
};

export const Field = ({ label, id, children, hint }) => (
  <div>
    <label htmlFor={id} className="label">
      {label}
    </label>
    {children}
    {hint && <p className="mt-1.5 text-[13px] text-ink/55">{hint}</p>}
  </div>
);

/** Sliding segmented control (two to four options). */
export function Segmented({ options, value, onChange, label, wide }) {
  const id = useId();

  return (
    <div
      role="tablist"
      aria-label={label}
      className="dock !grid"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map(([v, l]) => {
        const on = v === value;

        return (
          <button
            key={v}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(v)}
            className="dock-btn"

          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function Pagination({ page, pages, onChange }) {
  if (!pages || pages <= 1) return null;

  return (
    <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pagination">
      <button
        className="btn-ghost"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
        Previous
      </button>

      <span className="text-sm text-ink/65 tnum">
        {page} of {pages}
      </span>

      <button
        className="btn-ghost"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

const CAT_ICONS = {
  clapperboard: Clapperboard,
  mic: Mic,
  sparkles: Sparkles,
  trophy: Trophy,
  tv: Tv,
  laugh: Laugh,
  camera: Camera,
  star: Star,
};

/**
 * Category picker grid.
 * One column on very narrow screens, two on phones, three on tablets, four on laptops.
 */
export function CategoryGrid({
  items,
  active,
  onSelect,
  label = 'Categories',
  loading = false,
  sheet = false, // inside a modal the viewport width says nothing about the space available: stay at 2 columns
}) {
  const gridClass = sheet
    ? 'grid grid-cols-2 gap-2.5 max-[339px]:grid-cols-1'
    : 'grid grid-cols-2 gap-2.5 max-[359px]:grid-cols-1 sm:grid-cols-3 lg:grid-cols-4';

  if (loading || !items?.length) {
    return (
      <div className={gridClass}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton h-[60px]" />
        ))}
      </div>
    );
  }

  return (
    <div role="group" aria-label={label} className={gridClass}>
      {items.map((c) => {
        const on = c.slug === active;
        const Icon = CAT_ICONS[c.icon] || Star;

        return (
          <button
            key={c.slug}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(c.slug)}
            className={`flex min-h-[60px] min-w-0 items-center gap-2.5 rounded-2xl border px-3 py-2 text-left transition active:scale-[.98] ${
              on
                ? 'border-brand bg-brand/10'
                : 'border-ink/10 bg-ink/[.04] hover:border-ink/30'
            }`}
          >
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                on ? 'bg-brand text-on' : 'bg-ink/[.07] text-ink/70'
              }`}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold leading-tight text-ink [overflow-wrap:break-word] [text-wrap:balance]">
                {c.name}
              </span>

              {c.count != null && (
                <span className="mt-0.5 block text-[12px] text-ink/55 tnum">
                  {c.count} {c.count === 1 ? 'nominee' : 'nominees'}
                </span>
              )}
            </span>

            {c.done && (
              <Check
                className="h-4 w-4 shrink-0 text-brand"
                strokeWidth={3.5}
                aria-label="voted"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Category dock: one rounded track holding every category as an icon + name pill. Swipe sideways on a phone; the
 * active pill is filled and scrolled into view. Categories you have already voted in carry a tick.
 */
export function CategoryPicker({ items, active, onSelect, loading = false, className = '' }) {
  const rail = useRef(null);
  const [edge, setEdge] = useState({ l: false, r: false });

  const measure = () => {
    const r = rail.current; if (!r) return;
    setEdge({ l: r.scrollLeft > 4, r: r.scrollLeft + r.clientWidth < r.scrollWidth - 4 });
  };

  // Only move the rail when the chosen pill is (nearly) off screen, and then glide just far enough. Never snaps, never scrolls the page.
  useEffect(() => {
    const r = rail.current;
    const el = r?.querySelector('[aria-selected="true"]');
    if (!el) return;
    const pad = 12;
    if (el.offsetLeft < r.scrollLeft + pad) r.scrollTo({ left: Math.max(0, el.offsetLeft - pad), behavior: 'smooth' });
    else if (el.offsetLeft + el.offsetWidth > r.scrollLeft + r.clientWidth - pad) r.scrollTo({ left: el.offsetLeft + el.offsetWidth - r.clientWidth + pad, behavior: 'smooth' });
    const t = setTimeout(measure, 400);
    return () => clearTimeout(t);
  }, [active, items?.length]);
  useEffect(() => { measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }, [items?.length]);

  if (loading || !items?.length) return <div className={`skeleton h-[52px] !rounded-full ${className}`} aria-hidden="true" />;

  const nudge = (dir) => rail.current?.scrollBy({ left: dir * Math.max(140, rail.current.clientWidth * 0.55), behavior: 'smooth' });
  const arrow = 'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-sm ring-1 ring-line transition active:scale-90';

  return (
    <div className={`dock ${className}`}>
      {edge.l && <button type="button" tabIndex={-1} aria-label="Scroll categories left" onClick={() => nudge(-1)} className={arrow}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>}
      <div ref={rail} onScroll={measure} role="tablist" aria-label="Categories" className="hide-scroll flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain" style={{ touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' }}>
        {items.map((c) => (
          <button key={c.slug} type="button" role="tab" aria-selected={c.slug === active} onClick={() => onSelect(c.slug)} className="dock-btn">
            {c.icon && <CategoryIcon name={c.icon} className="h-4 w-4 shrink-0" />}
            <span>{c.name}</span>
            {c.done && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3.5} aria-label="voted" />}
          </button>
        ))}
      </div>
      {edge.r && <button type="button" tabIndex={-1} aria-label="Scroll categories right" onClick={() => nudge(1)} className={arrow}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>}
    </div>
  );
}

/** Male / Female / Others sub-groups inside a category. Groups nobody is listed in are hidden, so there are never dead ends. */
export const GENDER_LABEL = { male: 'Male', female: 'Female', other: 'Others' };
// Only icons already used elsewhere in the project (no new lucide exports); male/female use plain symbols.
const GENDER_ICON = {
  '': (p) => <Users2 {...p} />,
  male: (p) => <span {...p}>♂</span>,
  female: (p) => <span {...p}>♀</span>,
  other: (p) => <Sparkles {...p} />,
};
export function GenderTabs({ value = '', onChange, counts, label = 'Show', className = '' }) {
  const shown = ['male', 'female', 'other'].filter((g) => !counts || counts[g] > 0 || g === value);
  if (counts && shown.length < 2 && !value) return null; // one group only: nothing to filter
  const opts = [['', 'All'], ...shown.map((g) => [g, GENDER_LABEL[g]])];
  return (
    <div className={`flex min-w-0 max-w-full items-center gap-2.5 ${className}`}>
      <span className="nav-label hidden sm:inline">{label}</span>
      <div role="radiogroup" aria-label={label} className="dock hide-scroll min-w-0 !w-auto overflow-x-auto">
        {opts.map(([v, l]) => {
          const I = GENDER_ICON[v];
          const n = v ? counts?.[v] : counts ? shown.reduce((t, g) => t + (counts[g] || 0), 0) : null;
          return (
            <button key={v || 'all'} type="button" role="radio" aria-checked={value === v} className="dock-btn !min-h-[36px] !px-3" onClick={() => onChange(v)}>
              <I className="h-3.5 w-3.5 shrink-0 text-center text-[13px] leading-[14px] max-[380px]:hidden" aria-hidden="true" />
              <span>{l}</span>
              {n > 0 && <span className="dock-count max-[400px]:hidden">{n}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
