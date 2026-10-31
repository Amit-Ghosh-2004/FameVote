import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';

const COLORS = ['#B0CA58', '#F4BE54', '#F5F1E0', '#426e0e', '#D5E6A0'];
/** One-shot confetti burst for the moment a vote is counted. Decorative, silent, and skipped for reduced motion. */
export default function Confetti({ count = 24, seed = 1 }) {
  const reduce = useReducedMotion();
  const bits = useMemo(() => Array.from({ length: count }, (_, i) => {
    const r = (n) => { const x = Math.sin((i + 1) * 12.9898 + n * 78.233 + seed) * 43758.5453; return x - Math.floor(x); };
    return { x: (r(1) - 0.5) * 260, y: -40 - r(2) * 90, fall: 140 + r(3) * 120, rot: (r(4) - 0.5) * 540, size: 5 + r(5) * 6, color: COLORS[i % COLORS.length], round: r(6) > 0.6, delay: r(7) * 0.15 };
  }), [count, seed]);
  if (reduce) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-0 overflow-visible" aria-hidden="true">
      {bits.map((b, i) => (
        <motion.span key={i} className="absolute left-1/2 top-0 block" style={{ width: b.size, height: b.round ? b.size : b.size * 0.5, background: b.color, borderRadius: b.round ? '9999px' : 2 }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }} animate={{ x: b.x, y: [0, b.y, b.fall], opacity: [1, 1, 0], rotate: b.rot }} transition={{ duration: 1.5, delay: b.delay, ease: 'easeOut', times: [0, 0.3, 1] }} />
      ))}
    </div>
  );
}
