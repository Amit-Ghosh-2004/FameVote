import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { BarChart3, Check, Home, Trophy, User } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useCountdown } from '../lib/hooks';
import { titleForPath } from '../lib/title';
import { ThemeToggle } from '../lib/theme';

const links = [['/', 'Home'], ['/rankings', 'Rankings'], ['/vote', 'Vote'], ['/winners', 'Winners']];

/** Wordmark with a small ballot-tick mark. */
export const Logo = ({ light }) => (
  <Link to="/" className="flex items-center gap-2.5" aria-label="FameVote home">
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="8" fill="#FF6A3D" />
      <path d="M7.5 14.5l4.5 4.5 8.5-9.5" fill="none" stroke="#180A05" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <span className="font-heading text-[22px] font-extrabold leading-none text-ink" style={{ letterSpacing: '-0.045em' }}>FameVote</span>
  </Link>
);

function StatusPill({ camp, serverTime }) {
  const target = camp.status === 'upcoming' ? camp.startsAt : camp.endsAt;
  const c = useCountdown(target, serverTime);
  const open = camp.status === 'active';
  const text = open ? `${c.days > 0 ? `${c.days}d ${c.hours}h` : `${c.hours}h ${c.minutes}m`} left` : camp.status === 'upcoming' ? 'Opens soon' : 'Closed';
  return (
    <Link to="/how-it-works" className="hidden min-h-[40px] items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold text-ink/70 min-[430px]:inline-flex" aria-label={`Campaign status: ${text}`}>
      <span className={`h-2 w-2 rounded-full ${open ? 'bg-mint' : 'bg-ink/40'}`} aria-hidden="true" />{text}
    </Link>
  );
}

const TabItem = ({ to, Icon, label }) => (
  <NavLink to={to} end={to === '/'} className={({ isActive }) => `relative flex min-h-[58px] flex-col items-center justify-center gap-1 text-[11px] font-semibold ${isActive ? 'text-ink' : 'text-ink/50'}`}>
    {({ isActive }) => (<>{isActive && <span className="absolute inset-x-5 top-0 h-[3px] rounded-b-full bg-brand" aria-hidden="true" />}<Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.25 : 1.75} aria-hidden="true" />{label}</>)}
  </NavLink>
);

export default function Layout() {
  const { user, meta, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const camp = meta?.campaign;
  const immersive = /^\/celebrity\//.test(loc.pathname);
  const authPage = ['/login', '/register', '/forgot-password', '/reset-password'].includes(loc.pathname);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => { const t = titleForPath(loc.pathname); if (t !== undefined) document.title = t ? `${t} · FameVote` : 'FameVote - Your Vote. Their Fame.'; }, [loc.pathname]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[200] focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">Skip to content</a>
      {meta?.announcements?.[0] && <div className="bg-brand px-4 py-2 text-center text-[13px] font-semibold text-on">{meta.announcements[0].message}</div>}

      <header className={`pt-safe sticky top-0 z-40 border-b border-line/70 bg-paper/80 backdrop-blur-xl ${authPage ? 'auth-header' : ''}`}>
        <div className={`container-x flex items-center justify-between gap-3 ${authPage ? 'h-14 sm:h-16' : 'h-16'}`}>
          <Logo />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {links.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `relative px-3.5 py-2 text-sm font-semibold transition ${isActive ? 'text-ink after:absolute after:inset-x-3.5 after:-bottom-[13px] after:h-[3px] after:rounded-full after:bg-brand' : 'text-ink/60 hover:text-ink'}`}>{label}</NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {camp && <StatusPill camp={camp} serverTime={meta.serverTime} />}
            {user ? (
              <>
                <Link to="/dashboard" aria-label="My account" className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-ink font-heading text-sm font-extrabold text-paper">{user.avatar?.url ? <img src={user.avatar.url} alt="" className="h-full w-full object-cover" /> : user.name?.[0]?.toUpperCase()}</Link>
                <button className="hidden min-h-[40px] text-sm font-semibold text-ink/60 hover:text-ink lg:block" onClick={async () => { await logout(); nav('/'); }}>Log out</button>
              </>
            ) : (
              <Link to="/login" className="inline-flex min-h-[40px] items-center whitespace-nowrap rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Log in</Link>
            )}
          </div>
        </div>
      </header>

      <main id="main" className={`flex-1 ${authPage ? 'auth-main' : 'pb-[calc(88px+env(safe-area-inset-bottom))] lg:pb-14'}`}>
        <motion.div key={loc.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}>
          <Outlet />
        </motion.div>
      </main>

      <footer className={`border-t border-line bg-surface text-ink/65 ${authPage ? 'hidden' : immersive ? 'hidden lg:block' : ''}`}>
        <div className="container-x flex flex-col gap-6 py-9 pb-[calc(100px+env(safe-area-inset-bottom))] lg:flex-row lg:items-start lg:justify-between lg:pb-10">
          <div className="max-w-xs"><Logo /><p className="mt-3 text-sm">Monthly celebrity voting with transparent rankings, verified payments and a receipt for every vote.</p></div>
          {meta?.sampleData && <p className="max-w-xs text-xs text-ink/55 lg:order-last lg:self-end">FameVote is in preview: some accounts, votes and results shown here are sample data.</p>}
          <div className="grid grid-cols-2 gap-x-10 text-sm">
            {[['/how-it-works', 'How it works'], ['/voting-integrity', 'Voting integrity'], ['/verify-receipt', 'Verify a receipt'], ['/nominate', 'Nominate a celebrity'], ['/rankings', 'Rankings'], ['/winners', 'Winners']].map(([to, l]) => <Link key={to} to={to} className="flex min-h-[44px] items-center hover:text-ink">{l}</Link>)}
          </div>
        </div>
      </footer>

      <nav className={`fixed inset-x-0 bottom-0 z-50 border-t border-line/80 bg-paper/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden ${authPage ? 'hidden' : ''}`} aria-label="Primary">
        <ul className="mx-auto grid max-w-lg grid-cols-5 items-stretch">
          <li><TabItem to="/" Icon={Home} label="Home" /></li>
          <li><TabItem to="/rankings" Icon={BarChart3} label="Rankings" /></li>
          <li className="flex items-center justify-center">
            <NavLink to="/vote" className="flex flex-col items-center gap-1 py-1.5 text-[11px] font-bold text-brand" aria-label="Vote">
              <span className="grid h-9 w-12 place-items-center rounded-lg bg-brand text-on transition active:scale-95"><Check className="h-5 w-5" strokeWidth={3} aria-hidden="true" /></span>Vote
            </NavLink>
          </li>
          <li><TabItem to="/winners" Icon={Trophy} label="Winners" /></li>
          <li><TabItem to={user ? '/dashboard' : '/login'} Icon={User} label={user ? 'Me' : 'Log in'} /></li>
        </ul>
      </nav>
    </div>
  );
}
