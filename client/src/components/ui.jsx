import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AnimatePresence, animate, motion, useDragControls, useReducedMotion } from 'motion/react';
import { AlertTriangle, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Crown, Inbox, Laugh, Mic, Sparkles, Star, Trophy, Tv, X } from 'lucide-react';
import { img, imgSet, imgTiny } from '../lib/api';
import { useCountdown } from '../lib/hooks';

/* ----------------------------- delight ----------------------------- */

/** Number that eases to its new value (used for live vote counts). */
export function CountUp({ value, className }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    if (reduce || prev.current === value) {
      setShown(value);
      prev.current = value;
      return undefined;
    }

    const c = animate(prev.current, value, {
      duration: 0.8,
      ease: 'easeOut',
      onUpdate: (v) => setShown(Math.round(v)),
    });

    prev.current = value;
    return () => c.stop();
  }, [value, reduce]);

  return <span className={className}>{Number(shown).toLocaleString('en-IN')}</span>;
}

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
        <Skeleton className={`${className} !rounded-xl`} />
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
      className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface px-6 py-10 text-center"
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
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-ink/20 px-6 py-10 text-center">
      <Inbox
        className="h-7 w-7 text-ink/40"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <h3 className="mt-1 font-heading text-base font-bold">{title}</h3>
      {text && <p className="max-w-xs text-[15px] text-ink/65">{text}</p>}
      {action}
    </div>
  );
}

export const PageTitle = ({ title, sub, children }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0 max-w-2xl">
      <h1 className="font-heading text-[38px] font-extrabold leading-[1] text-ink sm:text-6xl">
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
      <h2 className="font-heading text-xl font-extrabold leading-tight">{title}</h2>
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

/** Fades and lifts a block in once as it scrolls into view. Skipped for reduced-motion users. */
export function Reveal({ children, className = '', delay = 0, as = 'div', ...rest }) {
  const reduce = useReducedMotion();
  const M = motion[as] || motion.div;

  if (reduce) {
    const T = as;
    return (
      <T className={className} {...rest}>
        {children}
      </T>
    );
  }

  return (
    <M
      className={className}
      {...rest}
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.55, delay, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </M>
  );
}

/* ----------------------------- sheet / modal ----------------------------- */

/** Bottom sheet on phones; centred dialog on larger screens. */
export function Modal({ open, onClose, title, children, wide, onExited }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  const controls = useDragControls();
  const reduce = useReducedMotion();

  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 639px)').matches
  );

  // Keep the latest callback without restarting the focus and scroll effects.
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Track the viewport so the opening animation matches the modal layout.
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobile(media.matches);

    update();
    media.addEventListener?.('change', update);

    return () => media.removeEventListener?.('change', update);
  }, []);

  // Manage keyboard focus and page scrolling while the modal is open.
  useEffect(() => {
    if (!open) return undefined;

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        closeRef.current();
      }

      if (e.key === 'Tab' && ref.current) {
        const focusable = ref.current.querySelectorAll(
          'button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
        );

        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';

    const focusTimer = setTimeout(() => {
      // preventScroll: focusing mid-slide made the page jump, which read as the sheet opening twice.
      // Prefer an explicit target; otherwise focus the dialog itself, not the close button (no stray focus ring).
      (ref.current?.querySelector('[data-autofocus],input,select,textarea') || ref.current)?.focus({ preventScroll: true });
    }, 60);

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [open]);

  // Render in body to avoid transformed page wrappers trapping the modal.
  return createPortal(
    <AnimatePresence onExitComplete={onExited}>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) closeRef.current?.();
          }}
        >
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={
              reduce
                ? { opacity: 0 }
                : isMobile
                  ? { y: '100%', opacity: 0.98 }
                  : { y: 12, opacity: 0, scale: 0.985 }
            }
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={
              reduce
                ? { opacity: 0 }
                : isMobile
                  ? { y: '100%', opacity: 0.98 }
                  : { y: 8, opacity: 0, scale: 0.99 }
            }
            transition={isMobile ? { type: 'spring', damping: 36, stiffness: 380, mass: 0.9 } : { duration: 0.18, ease: 'easeOut' }}
            tabIndex={-1}
            onPointerDown={(e) => e.stopPropagation()}
            drag={isMobile ? 'y' : false}
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 600) closeRef.current?.();
            }}
            className={`flex max-h-[92dvh] w-full flex-col outline-none rounded-t-3xl border border-b-0 border-line bg-surface shadow-sheet sm:rounded-3xl sm:border-b ${
              wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
            }`}
          >
            <div
              className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-2.5 sm:hidden"
              onPointerDown={(e) => controls.start(e)}
              aria-hidden="true"
            >
              <span className="h-1 w-10 rounded-full bg-ink/20" />
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 pb-3 pt-1 sm:pt-4">
              <h2 className="font-heading text-lg font-extrabold">{title}</h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 grid h-11 w-11 place-items-center rounded-full hover:bg-ink/5"
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="overflow-y-auto overscroll-contain px-5 pb-safe pt-4">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
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
        <span className="block font-heading text-[16px] font-bold leading-tight">
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

// Quiet, desaturated tones for photos that have not been uploaded yet.
const TONES = [
  'from-brand/45 to-sand',
  'from-amber/45 to-sand',
  'from-mint/40 to-sand',
  'from-[#E0457B]/40 to-sand',
  'from-[#8B5CF6]/35 to-sand',
];

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
      className={`h-full w-full object-cover ${className}`}
    />
  ) : (
    <div
      role="img"
      aria-label={name}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br ${
        TONES[Math.abs(hash(name)) % TONES.length]
      } ${className}`}
    >
      <span
        className="absolute inset-0 bg-[radial-gradient(60%_45%_at_50%_30%,rgb(var(--ink)/.14),transparent)]"
        aria-hidden="true"
      />
      <span
        className="relative font-heading font-extrabold text-ink/55"
        style={{ fontSize: 'clamp(20px, 34%, 56px)' }}
      >
        {initials}
      </span>
    </div>
  );
}

/** Portrait with caption; with onVote the card opens the vote sheet. */
export function CelebrityCard({
  celeb,
  rank,
  votes,
  onVote,
  voted,
  disabled,
  className = '',
}) {
  const inner = (
    <>
      <div
        className={`relative aspect-[4/5] overflow-hidden rounded-xl bg-sand ${
          voted ? 'ring-2 ring-brand ring-offset-2 ring-offset-paper' : ''
        }`}
      >
        <Portrait
          src={celeb.image}
          name={celeb.name}
          className="transition duration-500 group-hover:scale-[1.03]"
        />

        {rank != null && (
          <span className="absolute left-0 top-0 grid h-8 min-w-8 place-items-center rounded-br-lg bg-ink px-2 font-heading text-sm font-extrabold text-paper tnum">
            {rank}
          </span>
        )}

        {voted && (
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-brand py-1.5 text-xs font-bold text-on">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
            Your pick
          </span>
        )}
      </div>

      <span className="mt-2 block font-heading text-[16px] font-bold leading-tight">
        {celeb.name}
      </span>
      <p className="mt-0.5 truncate text-[13px] text-ink/55">
        {votes != null ? `${votes.toLocaleString('en-IN')} votes` : celeb.category?.name}
      </p>
    </>
  );

  const cls = `group block w-full text-left transition active:scale-[.985] ${
    disabled ? 'opacity-55' : ''
  } ${className}`;

  return onVote ? (
    <button
      type="button"
      className={cls}
      onClick={() => onVote(celeb)}
      aria-label={`${voted ? 'Your pick: ' : 'Vote for '}${celeb.name}`}
    >
      {inner}
    </button>
  ) : (
    <Link to={`/celebrity/${celeb.slug || celeb.id}`} className={cls}>
      {inner}
    </Link>
  );
}

/* ----------------------------- the top three ----------------------------- */

/** Leader gets a wide feature card; second and third sit side by side beneath it. */
const MEDAL = {
  1: 'ring-amber shadow-glow',
  2: 'ring-ink/30',
  3: 'ring-[#C98A5A]/80',
};

/** Top three on a podium. Works with 1-3 entries. */
export function Podium({ entries }) {
  const top = (entries || []).slice(0, 3);
  if (!top.length) return null;

  const order =
    top.length === 1 ? [top[0]] : top.length === 2 ? [top[1], top[0]] : [top[1], top[0], top[2]];

  const step = { 0: 'h-[76px]', 1: 'h-[54px]', 2: 'h-[40px]' };
  const delay = { 0: '.18s', 1: '0s', 2: '.09s' };

  return (
    <ol className="flex items-end justify-center gap-2.5" aria-label="Current top three">
      {order.map((e) => {
        const pos = top.indexOf(e);
        const first = pos === 0;

        return (
          <li
            key={e.celebrityId}
            className={`animate-rise ${first ? 'w-[37%]' : 'w-[30%]'}`}
            style={{ animationDelay: delay[pos] }}
          >
            <Link
              to={`/celebrity/${e.slug || e.celebrityId}`}
              className="group flex flex-col items-center text-center"
            >
              {first ? (
                <Crown
                  className="mb-1 h-6 w-6 text-amber drop-shadow-[0_0_10px_rgba(255,184,77,.7)]"
                  aria-hidden="true"
                />
              ) : (
                <span className="h-6" aria-hidden="true" />
              )}

              <span
                className={`relative block aspect-[3/4] w-full overflow-hidden rounded-2xl bg-sand ring-2 ${
                  MEDAL[e.rank] || MEDAL[pos + 1]
                }`}
              >
                <Portrait eager sizes="(min-width:1024px) 150px, 30vw" src={e.image} name={e.name} className="transition duration-500 group-hover:scale-105" />
              </span>

              <span
                className={`mt-2 line-clamp-2 w-full break-words font-heading font-bold leading-tight ${
                  first ? 'text-[15px]' : 'text-[13px]'
                }`}
              >
                {e.name}
              </span>

              <span className="mt-0.5 text-[12px] text-ink/60 tnum">
                {e.votes > 0 ? `${e.votes.toLocaleString('en-IN')} votes` : 'No votes yet'}
              </span>

              <span
                className={`mt-2 grid w-full place-items-start justify-items-center rounded-t-xl pt-1.5 font-heading text-[22px] font-extrabold leading-none tnum ${
                  step[pos]
                } ${
                  first
                    ? 'bg-gradient-to-b from-brand to-brand/55 text-on'
                    : 'border border-b-0 border-line bg-sand text-ink/70'
                }`}
              >
                {e.rank}
              </span>
            </Link>
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
      <span className="font-heading text-[34px] font-extrabold leading-none text-ink tnum">
        {pad(v)}
      </span>
      <span className="mt-1 text-[11px] text-ink/55">{l}</span>
    </div>
  );

  return (
    <div role="timer" aria-label={label}>
      {label && <p className="mb-2 text-sm font-medium text-ink/70">{label}</p>}
      <div className="flex divide-x divide-line rounded-2xl border border-line bg-surface">
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
    finalized: ['bg-brand-soft text-brand-dark', 'bg-brand', 'Final results'],
  };

  const [cls, dot, text] = map[campaign?.status] || map.closed;

  return (
    <span className={`badge ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {text}
    </span>
  );
}

/* ----------------------------- rankings ----------------------------- */

const Movement = ({ value }) => {
  if (value == null) return null;
  if (value === 0) return <span className="text-[11px] text-ink/40">no change</span>;

  return (
    <span className={`text-[11px] font-bold ${value > 0 ? 'text-mint' : 'text-brand'}`}>
      {value > 0 ? '▲' : '▼'} {Math.abs(value)}
    </span>
  );
};

export function RankingList({ entries, limit }) {
  const reduce = useReducedMotion();

  if (!entries?.length) {
    return (
      <EmptyState
        title="No rankings yet"
        text="Rankings appear as soon as valid votes are recorded."
      />
    );
  }

  const max = Math.max(1, ...entries.map((e) => e.votes));

  return (
    <div>
      <ol className="divide-y divide-line">
        {entries.map((e) => {
          const pct = e.votes ? Math.max(3, Math.round((e.votes / max) * 100)) : 0;
          const lead = e.rank === 1 && e.votes > 0;

          return (
            <motion.li
              key={e.celebrityId}
              layout={reduce ? false : 'position'}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            >
              <Link
                to={`/celebrity/${e.slug || e.celebrityId}`}
                className="flex min-h-[68px] items-center gap-3 py-3 active:bg-ink/[.03]"
              >
                <span
                  className={`w-8 shrink-0 font-heading text-[24px] font-extrabold leading-none tnum ${
                    lead ? 'text-brand' : 'text-ink'
                  }`}
                >
                  {e.rank}
                </span>

                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-sand">
                  <Portrait src={e.image} name={e.name} sizes="56px" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-[15px] font-semibold leading-tight">
                    {e.name}
                  </span>

                  <span className="mt-2 block h-[3px] overflow-hidden rounded-full bg-ink/10">
                    <motion.span
                      className={`block h-full rounded-full ${lead ? 'bg-brand' : 'bg-ink/60'}`}
                      initial={{ width: reduce ? `${pct}%` : 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
                    />
                  </span>
                </span>

                <span className="flex w-[68px] shrink-0 flex-col items-end">
                  <CountUp value={e.votes} className="text-[15px] font-bold tnum" />
                  <Movement value={e.movement} />
                </span>
              </Link>
            </motion.li>
          );
        })}
      </ol>

      {limit && (
        <p className="pt-3 text-xs text-ink/55">
          Top {limit} shown. Ties share a rank and are listed alphabetically.
        </p>
      )}
    </div>
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
export function Segmented({ options, value, onChange, label }) {
  const id = useId();

  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid rounded-xl border border-ink/15 bg-surface p-1"
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
            className={`relative min-h-[42px] rounded-lg px-2 text-sm font-semibold transition-colors ${
              on ? 'text-paper' : 'text-ink/60'
            }`}
          >
            {on && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-lg bg-ink"
                transition={{ type: 'spring', damping: 30, stiffness: 400 }}
              />
            )}
            <span className="relative">{l}</span>
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
            className={`flex min-h-[60px] min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition active:scale-[.98] ${
              on
                ? 'border-brand bg-brand-soft'
                : 'border-line bg-surface hover:border-ink/30'
            }`}
          >
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                on ? 'bg-brand text-on' : 'bg-sand text-ink/70'
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
 * One-line category control: previous / current / next.
 * The current category opens a sheet with all available categories.
 */
export function CategoryPicker({
  items,
  active,
  onSelect,
  loading = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  // Apply the choice only after the sheet has finished closing, so the page behind it changes once, not mid-animation.
  const pending = useRef(null);

  if (loading || !items?.length) {
    return <div className={`skeleton h-12 ${className}`} aria-hidden="true" />;
  }

  const idx = Math.max(0, items.findIndex((c) => c.slug === active));
  const cur = items[idx];
  const Icon = CAT_ICONS[cur.icon] || Star;

  const step = (direction) => {
    onSelect(items[(idx + direction + items.length) % items.length].slug);
  };

  const arrow =
    'grid h-12 w-11 shrink-0 place-items-center rounded-xl border border-line bg-surface/80 text-ink/80 transition active:scale-95';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        className={arrow}
        onClick={() => step(-1)}
        aria-label="Previous category"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex min-h-[48px] min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-brand/50 bg-brand-soft px-3 text-[15px] font-bold text-ink transition active:scale-[.99]"
      >
        <Icon className="h-[18px] w-[18px] shrink-0 text-brand" aria-hidden="true" />
        <span className="truncate">{cur.name}</span>
        <span className="shrink-0 text-[12px] font-medium text-ink/50 tnum">
          {idx + 1}/{items.length}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink/55" aria-hidden="true" />
      </button>

      <button
        type="button"
        className={arrow}
        onClick={() => step(1)}
        aria-label="Next category"
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        onExited={() => { const s = pending.current; pending.current = null; if (s && s !== active) onSelect(s); }}
        title="Choose a category"
      >
        <CategoryGrid
          sheet
          items={items}
          active={active}
          onSelect={(slug) => {
            pending.current = slug;
            setOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}

/** Male / Female / Others sub-groups inside a category. Groups nobody is listed in are hidden, so there are never dead ends. */
export const GENDER_LABEL = { male: 'Male', female: 'Female', other: 'Others' };
export function GenderTabs({ value = '', onChange, counts, label = 'Show', className = '' }) {
  const shown = ['male', 'female', 'other'].filter((g) => !counts || counts[g] > 0 || g === value);
  if (counts && shown.length < 2 && !value) return null; // one group only: nothing to filter
  const opts = [['', 'All'], ...shown.map((g) => [g, GENDER_LABEL[g]])];
  return (
    <div role="radiogroup" aria-label={label} className={`hide-scroll -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0 ${className}`}>
      {opts.map(([v, l]) => (
        <button key={v || 'all'} type="button" role="radio" aria-checked={value === v} className="chip !px-3.5" onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}
