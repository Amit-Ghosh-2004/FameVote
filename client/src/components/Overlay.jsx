import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AnimatePresence, animate, motion, useDragControls, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { EmptyState, Portrait } from './ui';

/*
  Everything that needs the animation library lives here, so the home, rankings and sign-in screens
  (which need none of it) do not download it. Pages that animate import from this file.
*/

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
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
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
            className={`flex max-h-[92dvh] w-full flex-col rounded-t-[28px] border border-b-0 border-line bg-surface shadow-sheet outline-none sm:rounded-[28px] sm:border-b ${
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
              <h2 className="text-[19px] font-bold">{title}</h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 grid h-11 w-11 place-items-center rounded-full bg-ink/[.06] hover:bg-ink/10"
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
                  className={`w-8 shrink-0 text-[24px] font-bold leading-none tnum ${
                    lead ? 'text-brand' : 'text-ink'
                  }`}
                >
                  {e.rank}
                </span>

                <span className="h-[60px] w-12 shrink-0 overflow-hidden rounded-xl bg-sand">
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

