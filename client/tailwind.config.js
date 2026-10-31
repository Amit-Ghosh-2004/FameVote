/** @type {import('tailwindcss').Config} */
// FameVote look: near-black (dark) or cream paper (light), one lime brand colour and
// a champagne-gold accent. Type: Bricolage Grotesque headlines, Plus Jakarta Sans body, Fraunces italic accents.
// Colours are CSS variables so both themes share class names.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: v('ink'), paper: v('paper'), surface: v('surface'), sand: v('sand'), line: 'rgb(var(--line) / var(--line-a))', on: v('on'),
        brand: { DEFAULT: v('brand'), dark: v('brand-dark'), soft: v('brand-soft') },
        mint: { DEFAULT: v('mint'), soft: v('mint-soft') },
        stage: { DEFAULT: v('stage'), 2: v('stage-2') },
        gold: v('gold'), amber: v('gold'), danger: v('danger'),
        night: { 950: '#0a0a08', 900: '#0f0f0c', 800: '#18180f', 700: '#26261f' },
      },
      fontFamily: {
        heading: ['"Bricolage Grotesque"', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        body: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
        mono: ['"DM Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { '4xl': '2rem' },
      boxShadow: {
        sheet: '0 -20px 60px -24px rgba(0,0,0,.55)',
        lift: '0 18px 44px -20px rgba(0,0,0,.6)',
        glow: '0 10px 28px -10px rgb(var(--brand) / .6)',
        glass: '0 10px 40px -20px rgba(0,0,0,.5)',
      },
      keyframes: {
        rise: { '0%': { transform: 'translateY(14px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        stamp: { '0%': { transform: 'scale(1.6) rotate(-12deg)', opacity: '0' }, '60%': { transform: 'scale(.94) rotate(-6deg)', opacity: '1' }, '100%': { transform: 'scale(1) rotate(-6deg)', opacity: '1' } },
        pop: { '0%': { transform: 'scale(.6)', opacity: '0' }, '70%': { transform: 'scale(1.08)', opacity: '1' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        drift: { '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' }, '50%': { transform: 'translate3d(40px,-30px,0) scale(1.12)' } },
        sheen: { '0%': { backgroundPosition: '200% 0' }, '100%': { backgroundPosition: '-200% 0' } },
      },
      animation: { rise: 'rise .6s cubic-bezier(.2,.8,.2,1) both', stamp: 'stamp .45s .2s cubic-bezier(.2,.8,.2,1) both', pop: 'pop .5s cubic-bezier(.2,.8,.2,1) both', drift: 'drift 14s ease-in-out infinite', beam: 'none' },
    },
  },
  plugins: [],
};
