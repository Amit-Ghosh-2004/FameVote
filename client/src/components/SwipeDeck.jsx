import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { Check, RotateCcw, User, X } from 'lucide-react';
import { Portrait } from './ui';
import { haptic } from '../lib/fx';

const THRESHOLD = 110;

function Card({ celeb, top, depth, voted, disabled, onVote, onSkip }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], [-12, 0, 12]);
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
      animate={top ? undefined : { scale: 1 - depth * 0.05, y: depth * 14 }}
      drag={top ? 'x' : false} dragElastic={0.9} dragConstraints={{ left: 0, right: 0 }} onDragEnd={top ? end : undefined}
      aria-hidden={!top}
    >
      <div className="relative h-full overflow-hidden rounded-3xl bg-surface shadow-lift">
        <Portrait src={celeb.image} name={celeb.name} eager sizes="(min-width:640px) 420px, 92vw" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/60 to-transparent" />
        {top && <>
          <motion.span style={{ opacity: voteOp }} className="absolute left-5 top-6 -rotate-12 rounded-xl border-[3px] border-white px-3 py-1 font-heading text-2xl font-extrabold text-white">VOTE</motion.span>
          <motion.span style={{ opacity: skipOp }} className="absolute right-5 top-6 rotate-12 rounded-xl border-[3px] border-white/80 px-3 py-1 font-heading text-2xl font-extrabold text-white/90">SKIP</motion.span>
        </>}
        {voted && <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-on"><Check className="h-3.5 w-3.5" strokeWidth={3} />Your pick</span>}
        <div className="absolute inset-x-0 bottom-0 p-5 text-white">
          <h3 className="font-heading text-[30px] font-extrabold leading-none">{celeb.name}</h3>
          <p className="mt-2 text-sm text-white/75">{[celeb.category?.name, celeb.region].filter(Boolean).join(' · ')}</p>
          {celeb.bio && <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-white/65">{celeb.bio}</p>}
        </div>
      </div>
    </motion.div>
  );
}

/** Tinder-style deck: drag right to vote, left to skip. Also works with the buttons and arrow keys. */
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
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface px-6 py-14 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-sand text-ink"><RotateCcw className="h-6 w-6" aria-hidden="true" /></span>
        <h3 className="font-heading text-lg font-extrabold">That was everyone</h3>
        <p className="max-w-xs text-[15px] text-ink/65">You have seen all the celebrities on this page. Go back to the start, or switch to the grid to see them all at once.</p>
        <button className="btn-primary" onClick={() => setI(0)}>Start again</button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative mx-auto aspect-[3/4] h-[max(230px,calc(100dvh-470px))] max-w-full" aria-live="polite">
        {[2, 1, 0].map((d) => items[i + d] && (
          <Card key={items[i + d].id} celeb={items[i + d]} top={d === 0} depth={d} voted={votedId === items[i + d].id} disabled={disabled} onVote={onVote} onSkip={next} />
        ))}
      </div>
      <div className="mx-auto mt-5 flex max-w-sm items-center justify-center gap-5">
        <button onClick={next} aria-label={`Skip ${cur.name}`} className="grid h-16 w-16 place-items-center rounded-full bg-surface text-ink/70 border border-ink/15 transition active:scale-90"><X className="h-7 w-7" /></button>
        <button onClick={() => { haptic(14); onVote(cur); }} disabled={disabled} aria-label={`Vote for ${cur.name}`} className="grid h-20 w-20 place-items-center rounded-full bg-brand text-on transition active:scale-90 disabled:opacity-40"><Check className="h-9 w-9" strokeWidth={3.2} /></button>
        <Link to={`/celebrity/${cur.slug || cur.id}`} aria-label={`View ${cur.name}'s profile`} className="grid h-16 w-16 place-items-center rounded-full bg-surface text-brand border border-ink/15 transition active:scale-90"><User className="h-6 w-6" /></Link>
      </div>
      <p className="mt-4 text-center text-[13px] text-ink/55">{i + 1} of {items.length} · swipe right to vote, left to skip</p>
    </div>
  );
}
