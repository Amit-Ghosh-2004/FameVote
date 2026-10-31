import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { Check, RotateCcw, User, X } from 'lucide-react';
import { imgFit } from '../lib/api';
import { haptic } from '../lib/fx';

const THRESHOLD = 110;

function Card({ celeb, top, depth, voted, disabled, onVote, onSkip }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], [-10, 0, 10]);
  const voteOp = useTransform(x, [20, THRESHOLD], [0, 1]);
  const skipOp = useTransform(x, [-THRESHOLD, -20], [1, 0]);

  const settle = () => animate(x, 0, { type: 'spring', stiffness: 420, damping: 32 });
  const end = (_, info) => {
    if (info.offset.x > THRESHOLD && !disabled) { haptic(14); onVote(celeb); settle(); }
    else if (info.offset.x < -THRESHOLD) { haptic(8); animate(x, -480, { duration: 0.18 }).then(onSkip); }
    else settle();
  };

  return (
    <motion.div
      className="absolute inset-0 touch-pan-y select-none"
      style={top ? { x, rotate: reduce ? 0 : rotate, zIndex: 3 } : { zIndex: 3 - depth }}
      animate={top ? undefined : { scale: 1 - depth * 0.05, y: depth * 12 }}
      drag={top ? 'x' : false} dragElastic={0.9} dragConstraints={{ left: 0, right: 0 }} onDragEnd={top ? end : undefined}
      aria-hidden={!top}
    >
      <div className="relative h-full overflow-hidden rounded-[28px] bg-sand shadow-lift ring-1 ring-ink/10">
        {celeb.image ? (
          <img src={imgFit(celeb.image, 1000)} alt={celeb.name} loading="eager" decoding="async" draggable="false" className="absolute inset-0 block h-full w-full object-cover object-[50%_18%]" />
        ) : <div role="img" aria-label={celeb.name} className="absolute inset-0 grid place-items-center bg-sand text-4xl font-semibold text-ink/50">{celeb.name?.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[26%] bg-gradient-to-t from-black/75 via-black/30 to-transparent" aria-hidden="true" />
        {top && <>
          <motion.span style={{ opacity: voteOp }} className="absolute left-4 top-5 -rotate-6 rounded-lg border-2 border-white bg-brand px-3 py-0.5 text-[22px] font-bold tracking-wide text-on">VOTE</motion.span>
          <motion.span style={{ opacity: skipOp }} className="absolute right-4 top-5 rotate-6 rounded-lg border-2 border-white bg-black/60 px-3 py-0.5 text-[22px] font-bold tracking-wide text-white">SKIP</motion.span>
        </>}
        {voted && <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-on"><Check className="h-3.5 w-3.5" strokeWidth={3} />Your pick</span>}
        <div className="absolute inset-x-0 bottom-0 px-3.5 pb-3 text-white">
          <h3 className="truncate text-[clamp(17px,4.8vw,22px)] font-bold leading-tight">{celeb.name}</h3>
          <p className="truncate text-[12px] text-white/80">{[celeb.category?.name, celeb.region].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Swipe deck: drag a card right to vote, left to skip. The card fills the space between the filters and the buttons,
 * and the buttons sit in the thumb zone. Also works with arrow keys.
 */
export default function SwipeDeck({ items, votedId, disabled, onVote }) {
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [items]);
  const cur = items[i];
  const next = () => setI((n) => n + 1);

  useEffect(() => {
    const on = (e) => {
      if (/input|textarea|select/i.test(e.target.tagName) || document.querySelector('[role=dialog]')) return;
      if (e.key === 'ArrowLeft') next();
      if (e.key === 'ArrowRight' && cur && !disabled) onVote(cur);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [cur, disabled, onVote]);

  if (!cur) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 card px-6 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-brand/15 text-brand"><RotateCcw className="h-6 w-6" aria-hidden="true" /></span>
        <h3 className="text-xl font-bold">That was everyone</h3>
        <p className="max-w-xs text-[15px] text-ink/70">Start again, or switch to the grid to see all of them at once.</p>
        <button className="btn-primary" onClick={() => setI(0)}>Start again</button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-0.5 shrink-0 text-center text-[11.5px] text-ink/65" aria-live="polite">{i + 1} of {items.length} · swipe right to vote, left to skip</p>
      <div className="relative mx-auto min-h-[280px] w-full max-w-[400px] flex-1">
        <div className="absolute inset-x-0 bottom-2 top-0 flex justify-center">
          <div className="relative h-full w-auto max-w-full aspect-[4/5] sm:aspect-[3/4]">
          {[2, 1, 0].map((d) => items[i + d] && (
            <Card key={items[i + d].id} celeb={items[i + d]} top={d === 0} depth={d} voted={votedId === items[i + d].id} disabled={disabled} onVote={onVote} onSkip={next} />
          ))}
          </div>
        </div>
      </div>
      <div className="mx-auto flex shrink-0 items-center justify-center gap-6 pb-0.5 pt-0.5">
        <button onClick={next} aria-label={`Skip ${cur.name}`} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-ink/75 shadow-sm transition active:scale-90"><X className="h-7 w-7" strokeWidth={2.4} /></button>
        <button onClick={() => { haptic(14); onVote(cur); }} disabled={disabled} aria-label={`Vote for ${cur.name}`} className="grid h-[54px] w-[54px] place-items-center rounded-full bg-brand text-on shadow-glow transition active:scale-90 disabled:opacity-40"><Check className="h-9 w-9" strokeWidth={3.4} /></button>
        <Link to={`/celebrity/${cur.slug || cur.id}`} aria-label={`View ${cur.name}'s profile`} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-ink/75 shadow-sm transition active:scale-90"><User className="h-6 w-6" /></Link>
      </div>
    </div>
  );
}
