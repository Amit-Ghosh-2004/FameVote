import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Check, Home, Medal, Trophy, User } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useCountdown } from '../lib/hooks';
import SeoManager from '../lib/SeoManager';
import { ThemeToggle } from '../lib/theme';

const links = [['/', 'Home'], ['/vote', 'Vote'], ['/rankings', 'Rankings'], ['/winners', 'Winners']];

/** Wordmark: a solid brand tile with a tick, set in the display face. */
export const Logo = () => (
  <Link to="/" className="group flex items-center gap-2.5" aria-label="FameVote home">
    <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-on shadow-glow transition-transform duration-300 group-hover:-rotate-6">
      <Check className="h-5 w-5" strokeWidth={3.2} aria-hidden="true" />
    </span>
    <span className="font-heading text-[21px] font-extrabold leading-none text-ink">Fame<span className="serif-accent lg:!font-heading lg:!font-extrabold lg:!not-italic lg:!tracking-[-0.03em] lg:!text-ink">Vote</span></span>
  </Link>
);

/** "Voting closes in 12d 4h" as plain text. Shared by the header (desktop) and the home page. */
export function statusText(camp, c) {
  if (!camp) return '';
  if (camp.status === 'active') return `Voting closes in ${c.days > 0 ? `${c.days}d ${c.hours}h` : `${c.hours}h ${c.minutes}m`}`;
  if (camp.status === 'upcoming') return 'Voting opens soon';
  return 'Voting has closed';
}

function HeaderStatus({ camp, serverTime }) {
  const c = useCountdown(camp.status === 'upcoming' ? camp.startsAt : camp.endsAt, serverTime);
  const open = camp.status === 'active';
  return (
    <Link to="/how-it-works" className="hidden items-center gap-2 whitespace-nowrap rounded-full border border-line bg-ink/[.05] px-3 py-1.5 text-[12.5px] font-semibold text-ink/80 hover:text-ink lg:inline-flex">
      <span className={`h-2 w-2 rounded-full ${open ? 'animate-pulse bg-mint' : 'bg-ink/40'}`} aria-hidden="true" />{statusText(camp, c)}
    </Link>
  );
}

const TabItem = ({ to, Icon, label }) => (
  <NavLink to={to} end={to === '/'} className={({ isActive }) => `relative flex min-h-[54px] flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium transition-colors ${isActive ? 'text-ink' : 'text-ink/55'}`}>
    {({ isActive }) => (<>
      {isActive && <span className="absolute inset-x-1.5 inset-y-1 -z-10 rounded-2xl bg-ink/[.08]" aria-hidden="true" />}
      <Icon className="h-[21px] w-[21px]" strokeWidth={isActive ? 2.3 : 1.8} aria-hidden="true" />
      <span>{label}</span>
    </>)}
  </NavLink>
);

export default function Layout() {
  const { user, meta, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const camp = meta?.campaign;
  const authPage = ['/login', '/register', '/forgot-password', '/reset-password'].includes(loc.pathname);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);


  return (
    <div className="flex min-h-[100dvh] flex-col">
      <SeoManager />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[200] focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">Skip to content</a>
      {meta?.announcements?.[0] && <div className="bg-brand px-4 py-2 text-center text-[13px] font-medium text-on">{meta.announcements[0].message}</div>}

      <header className={`pt-safe sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-xl lg:border-0 lg:bg-transparent lg:backdrop-blur-none lg:px-6 lg:!pt-3 ${loc.pathname === '/' ? 'home-header' : ''}`}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:h-[4.5rem] sm:px-6 lg:h-[4.25rem] lg:max-w-6xl lg:rounded-full lg:border lg:border-line lg:bg-paper/80 lg:px-4 lg:shadow-glass lg:backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-6">
            <Logo />
            <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
              {links.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `rounded-full px-3.5 py-2 text-sm font-semibold transition ${isActive ? 'bg-ink/[.1] text-ink' : 'text-ink/65 hover:bg-ink/[.05] hover:text-ink'}`}>{label}</NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-1.5">
            {camp && <HeaderStatus camp={camp} serverTime={meta.serverTime} />}
            <ThemeToggle />
            {user ? (
              <>
                <Link to="/dashboard" aria-label="My account" className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-brand text-sm font-bold text-on">{user.avatar?.url ? <img src={user.avatar.url} alt="" className="h-full w-full object-cover object-top" /> : user.name?.[0]?.toUpperCase()}</Link>
                <button className="hidden min-h-[40px] px-3 text-sm font-bold text-ink/65 hover:text-ink lg:block" onClick={async () => { await logout(); nav('/'); }}>Log out</button>
              </>
            ) : (
              <Link to="/login" className="inline-flex min-h-[40px] items-center whitespace-nowrap rounded-full bg-ink px-5 text-sm font-bold text-paper hover:opacity-90">Log in</Link>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className={`border-t border-line ${authPage ? 'hidden' : ''}`}>
        <div className="container-x grid gap-8 py-8 sm:py-10 md:grid-cols-[1.4fr_1fr] lg:py-12">
          <div className="max-w-sm"><Logo /><p className="mt-3 text-sm leading-6 text-ink/65">One vote per category, every month. You get a receipt for each vote.</p>{meta?.sampleData && <p className="mt-3 text-xs text-ink/55">Preview: some accounts, votes and results are sample data.</p>}</div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm font-semibold text-ink/70">
            {[['/how-it-works', 'How it works'], ['/voting-rules', 'Voting rules'], ['/voting-integrity', 'Fair voting'], ['/verify-receipt', 'Check a receipt'], ['/nominate', 'Nominate someone'], ['/rankings', 'Rankings'], ['/winners', 'Winners'], ['/about', 'About'], ['/contact', 'Contact'], ['/privacy', 'Privacy'], ['/terms', 'Terms']].map(([to, l]) => <Link key={to} to={to} className="flex min-h-[40px] items-center hover:text-ink">{l}</Link>)}
          </div>
        </div>
        <p className="border-t border-line px-4 py-4 text-center text-xs text-ink/55 max-lg:pb-[calc(6.5rem+env(safe-area-inset-bottom))]">© {new Date().getFullYear()} FameVote · Independent fan-voting platform</p>
      </footer>

      <nav className={`pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pb-[calc(10px+env(safe-area-inset-bottom))] lg:hidden ${authPage ? 'hidden' : ''}`} aria-label="Primary">
        <ul className="glass pointer-events-auto relative mx-auto grid max-w-md grid-cols-5 items-center rounded-[28px] px-1.5 py-1 shadow-glass">
          <li><TabItem to="/" Icon={Home} label="Home" /></li>
          <li><TabItem to="/rankings" Icon={Medal} label="Ranks" /></li>
          <li className="flex justify-center">
            <NavLink to="/vote" aria-label="Vote" className="-mt-7 flex flex-col items-center">
              <span className="grid h-[56px] w-[56px] place-items-center rounded-full bg-brand text-on shadow-glow ring-4 ring-paper transition active:scale-90"><Check className="h-7 w-7" strokeWidth={3} aria-hidden="true" /></span>
              <span className="mt-0.5 text-[11px] font-semibold">Vote</span>
            </NavLink>
          </li>
          <li><TabItem to="/winners" Icon={Trophy} label="Winners" /></li>
          <li><TabItem to={user ? '/dashboard' : '/login'} Icon={User} label={user ? 'Me' : 'Log in'} /></li>
        </ul>
      </nav>
    </div>
  );
}
