/** @type {import('tailwindcss').Config} */
// "Nightshow" palette: a near-black stage, warm cream type, one hot coral accent, amber for the leader.
// Colours are CSS variables so a section can flip to the light theme with the `.light-band` class.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: v('ink'), paper: v('paper'), surface: v('surface'), sand: v('sand'), line: v('line'), on: v('on'),
        brand: { DEFAULT: v('brand'), dark: v('brand-dark'), soft: v('brand-soft') },
        mint: { DEFAULT: v('mint'), soft: v('mint-soft') },
        amber: { DEFAULT: '#FFB84D' },
      },
      fontFamily: {
        heading: ['"Sora Variable"', 'Sora', 'system-ui', 'sans-serif'],
        body: ['"Geist Variable"', 'Geist', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        sheet: '0 -20px 60px -20px rgba(0,0,0,.8)',
        lift: '0 20px 50px -20px rgba(0,0,0,.8)',
        glow: '0 10px 40px -10px rgba(255,106,61,.65)',
      },
      keyframes: {
        rise: { '0%': { transform: 'translateY(16px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        stamp: { '0%': { transform: 'scale(1.7) rotate(-14deg)', opacity: '0' }, '55%': { transform: 'scale(.92) rotate(-7deg)', opacity: '1' }, '100%': { transform: 'scale(1) rotate(-7deg)', opacity: '1' } },
        drift: { '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' }, '50%': { transform: 'translate3d(-4%,3%,0) scale(1.08)' } },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
      },
      animation: { rise: 'rise .5s cubic-bezier(.2,.8,.2,1) both', stamp: 'stamp .45s .2s cubic-bezier(.2,.8,.2,1) both', marquee: 'marquee 38s linear infinite', drift: 'drift 14s ease-in-out infinite' },
    },
  },
  plugins: [],
};
